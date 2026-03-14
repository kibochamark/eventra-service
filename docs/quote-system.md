# Quote System — Developer Reference

## Overview

The quote system is the commercial engine of the event management platform. It allows staff to build
itemised quotes for clients, submit them for admin approval, and — on approval — automatically creates
an **Event** (the main asset bucket) and a **ServiceBucket** (the service commitment tracker) while
reserving the physical inventory.

---

## Key Concepts

### The Pricing Waterfall

Every quote total is computed in four deterministic steps. The steps are executed in order and
cannot be reordered.

```
Step A — Line Total (per item)
  RENTAL:  lineTotal = (quantity × rate × days) − lineDiscountAmount
  SALE:    lineTotal = (quantity × rate)         − lineDiscountAmount
  SERVICE: lineTotal = (quantity × rate)         − lineDiscountAmount
  Note: lineTotal is floored at 0 — a discount cannot make a line negative.

Step B — Event Subtotal
  subtotal = Σ lineTotal  (sum of all line totals)

Step C — Global Discount
  discountedTotal = subtotal × (1 − globalDiscount / 100)
  globalDiscount is stored as a percentage (e.g. 10 = 10%).

Step D — VAT  (only when quote.includeVat = true)
  vatAmount  = discountedTotal × (tenant.vatPercentage / 100)
  grandTotal = discountedTotal + vatAmount
```

All arithmetic uses `Prisma.Decimal` to avoid JavaScript floating-point drift.

### Price Locking

When a RENTAL or SALE item is added to a quote, the `asset.baseRentalRate` at that moment is
copied into `QuoteItem.rate`. **This value is never updated again.** Future changes to the asset's
base rate do not affect existing quote lines. This guarantees the client always pays what was
quoted.

Staff cannot set or modify `rate`. It is always system-assigned at item creation.

### Availability Checking

When a RENTAL or SALE item is added to a quote that has `eventStartDate` and `eventEndDate`, the
system checks whether enough units are free during that window:

```
alreadyReserved = SUM(quantity) from QuoteItems of APPROVED quotes
                  where assetId matches
                  AND quote.eventStartDate < our eventEndDate
                  AND quote.eventEndDate   > our eventStartDate

available = asset.unitsAvailable − alreadyReserved
isAvailable = (available >= requestedQuantity)
```

Two date ranges overlap when `start1 < end2 AND end1 > start2`. Back-to-back bookings
(end of one = start of next) are treated as non-overlapping.

If the quote has no event dates set, the availability check is skipped (DRAFT quotes do not need
dates until submission).

### The Two Buckets

When a quote is **approved**, two records are created:

| Record | What it holds |
|--------|---------------|
| `Event` (main bucket) | The event itself: name, dates, venue, status. All RENTAL/SALE items are tracked here via `StockMovement` (DISPATCH type). |
| `ServiceBucket` | A snapshot of all SERVICE-type items from the quote: description, quantity, rate, computed total. Tracks service commitments separate from physical inventory. |

These two records together give the company a full picture of what is physically going out and what
services are committed for each event.

---

## Role Restrictions

| Action | STAFF | ADMIN |
|--------|-------|-------|
| Create quote | ✅ | ✅ |
| Add RENTAL / SALE item | ✅ | ✅ |
| Add SERVICE item | ❌ | ✅ |
| Edit item `description`, `quantity`, `days` | ✅ | ✅ |
| Edit item `discountAmount` | ❌ | ✅ |
| Edit item `rate` | ❌ (price-locked) | ❌ (price-locked) |
| Edit quote `globalDiscount` | ❌ | ✅ |
| Edit quote `includeVat` | ❌ | ✅ |
| Submit for approval | ✅ | ✅ |
| Approve quote | ❌ | ✅ |
| Cancel quote | ❌ | ✅ |

Role restrictions for quote-level fields are enforced in `QuotesService.updateQuoteHeader()`.
Role restrictions for item-level fields are enforced in `QuotesService.updateItem()`.

---

## Quote Status Flow

```
DRAFT
  │
  ├─ submit ──► PENDING_APPROVAL
  │                │
  │                ├─ approve ──► APPROVED ──► INVOICED  (future)
  │                │
  │                └─ cancel ──► CANCELLED
  │
  └─ cancel ──► CANCELLED
```

Allowed transitions:
- `DRAFT → PENDING_APPROVAL` via `POST /quotes/:id/submit`
- `PENDING_APPROVAL → APPROVED` via `POST /quotes/:id/approve`
- `DRAFT → CANCELLED` via `POST /quotes/:id/cancel`
- `PENDING_APPROVAL → CANCELLED` via `POST /quotes/:id/cancel`

Approved quotes cannot be cancelled through this endpoint (requires manual DB intervention or a
future "reverse approval" feature).

---

## API Reference

### Clients

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/clients` | ADMIN | Create a new client |
| GET | `/clients` | ADMIN, STAFF | List all clients with quote count |
| GET | `/clients/:id` | ADMIN, STAFF | Get client + last 10 quotes |
| PATCH | `/clients/:id` | ADMIN | Update client details |
| DELETE | `/clients/:id` | ADMIN | Delete client (fails if has quotes) |

### Quotes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/quotes` | ADMIN, STAFF | Create DRAFT quote |
| GET | `/quotes` | ADMIN, STAFF | List all quotes |
| GET | `/quotes/:id` | ADMIN, STAFF | Get quote with computed totals |
| PATCH | `/quotes/:id` | ADMIN | Update header (VAT, discount, dates) |
| POST | `/quotes/:id/items` | ADMIN, STAFF | Add line item |
| PATCH | `/quotes/:id/items/:itemId` | ADMIN, STAFF | Update line item (role-restricted) |
| DELETE | `/quotes/:id/items/:itemId` | ADMIN, STAFF | Remove line item |
| POST | `/quotes/:id/submit` | ADMIN, STAFF | Submit for approval |
| POST | `/quotes/:id/approve` | ADMIN | Approve + create event + service bucket |
| POST | `/quotes/:id/cancel` | ADMIN | Cancel quote |

---

## Function Reference

### `QuotesRepository`

**File:** `src/domain/quotes/quotes.repository.ts`

| Method | Inputs | Output | Notes |
|--------|--------|--------|-------|
| `generateQuoteNumber(tenantId)` | tenantId: string | `QT-{n}` string | Counts existing quotes → sequential number |
| `createQuote(tenantId, data)` | tenantId, clientId, dates?, notes? | Quote | Creates at DRAFT status |
| `findQuotesByTenant(tenantId)` | tenantId | Quote[] with client + _count | Lightweight list |
| `findQuoteById(id, tenantId)` | id, tenantId | Full Quote with items, client, tenant.vatPercentage | Used before any business logic |
| `updateQuoteHeader(id, tenantId, data)` | id, tenantId, patch object | Updated Quote | Partial update |
| `setQuoteStatus(id, tenantId, status, meta?)` | id, tenantId, QuoteStatus, { approvedAt, approvedBy } | Updated Quote | Status transition |
| `addQuoteItem(quoteId, data)` | quoteId, item fields | QuoteItem with asset | Rate is already price-locked by caller |
| `findQuoteItemById(itemId, quoteId)` | itemId, quoteId | QuoteItem or null | Scoped to the quote |
| `updateQuoteItem(itemId, quoteId, data)` | itemId, quoteId, patch | QuoteItem | Partial update |
| `removeQuoteItem(itemId, quoteId)` | itemId, quoteId | deleteMany result | Scoped delete |
| `findConflictingBookings(assetId, startDate, endDate, excludeQuoteId?)` | assetId, dates, optional excludeQuoteId | number (total reserved qty) | Only counts APPROVED quotes with overlapping dates |
| `findAssetById(assetId, tenantId)` | assetId, tenantId | Asset (id, name, baseRentalRate, unitsAvailable) | Thin read for price-lock and availability |
| `findClientById(clientId, tenantId)` | clientId, tenantId | Client (id, name) | Validation lookup |
| `createEvent(data)` | tenantId, quoteId, quoteNumber, startDate, endDate | Event | Called on approval |
| `createServiceBucket(eventId, quoteId, tenantId, items)` | eventId, quoteId, tenantId, ServiceBucketItem[] | ServiceBucket with items | Called on approval |
| `createDispatchMovement(data)` | assetId, eventId, quantity, userId, quoteNumber | StockMovement | One call per RENTAL/SALE item |
| `decrementAvailable(assetId, quantity)` | assetId, quantity | Updated Asset | Keeps unitsAvailable in sync |

---

### `QuotesService`

**File:** `src/domain/quotes/quotes.service.ts`

#### Pure Pricing Functions (no I/O)

These functions contain zero database calls and can be safely called inside queue jobs,
background workers, or tests without any setup.

| Function | Inputs | Output | Formula |
|----------|--------|--------|---------|
| `calcLineTotal(item)` | QuoteItem | Decimal | RENTAL: qty×rate×days − disc; else qty×rate − disc |
| `calcSubtotal(items[])` | QuoteItem[] | Decimal | Σ calcLineTotal |
| `calcDiscountedTotal(subtotal, globalDiscount)` | Decimal, Decimal | Decimal | subtotal × (1 − globalDiscount/100) |
| `calcVat(discountedTotal, vatPct)` | Decimal, Decimal | Decimal | discountedTotal × (vatPct/100) |
| `buildSummary(quote)` | FullQuote | QuoteSummary | Runs all four steps; returns string amounts |

The `QuoteSummary` shape returned:
```typescript
{
  subtotal:        string  // formatted to 2dp
  discountAmount:  string  // monetary value of global discount
  discountedTotal: string
  vatAmount:       string  // 0 if includeVat is false
  grandTotal:      string
}
```

#### Availability Check (queue-safe)

```
checkAvailability(assetId, tenantId, quantity, startDate, endDate, excludeQuoteId?)
→ { isAvailable: boolean, available: number, requested: number }
```

Steps:
1. Load asset (validates it belongs to tenant)
2. Call `findConflictingBookings` to get total already-reserved units in the date window
3. Compute `available = asset.unitsAvailable − alreadyReserved`
4. Return comparison result

#### Business Methods

| Method | Guard | What it does |
|--------|-------|-------------|
| `createQuote(tenantId, data)` | validates clientId | generateQuoteNumber → createQuote |
| `getQuotes(tenantId)` | — | findQuotesByTenant |
| `getQuoteById(id, tenantId)` | 404 if not found | findQuoteById → buildSummary → return with totals |
| `updateQuoteHeader(id, tenantId, role, data)` | ADMIN-only, DRAFT/PENDING only | validates client → updateQuoteHeader |
| `addItem(quoteId, tenantId, role, itemData)` | DRAFT only | price-lock → availability check → addQuoteItem |
| `updateItem(quoteId, itemId, tenantId, role, data)` | DRAFT only, role-filtered | builds allowed patch → updateQuoteItem |
| `removeItem(quoteId, itemId, tenantId)` | DRAFT only | removeQuoteItem |
| `submitForApproval(quoteId, tenantId)` | DRAFT only, ≥1 item | setQuoteStatus PENDING_APPROVAL |
| `approveQuote(quoteId, tenantId, userId)` | PENDING_APPROVAL only, dates required | createEvent → createDispatchMovement per item → decrementAvailable → createServiceBucket → setQuoteStatus APPROVED |
| `cancelQuote(quoteId, tenantId)` | DRAFT or PENDING only | setQuoteStatus CANCELLED |

---

## Approval Flow — Sequence Diagram

```
Admin                  QuotesService           QuotesRepository          Database
  │                         │                        │                      │
  │── POST /quotes/:id/approve ──►                   │                      │
  │                         │── findQuoteById ───────►                      │
  │                         │◄─ Full Quote (with items, tenant) ────────────│
  │                         │                        │                      │
  │                         │── createEvent ─────────►                      │
  │                         │◄─ Event { id } ─────────────────────────────────│
  │                         │                        │                      │
  │     [for each RENTAL/SALE item]                  │                      │
  │                         │── createDispatchMovement ►                    │
  │                         │── decrementAvailable ──►                      │
  │                         │                        │                      │
  │     [if SERVICE items exist]                     │                      │
  │                         │── createServiceBucket ─►                      │
  │                         │                        │                      │
  │                         │── setQuoteStatus(APPROVED) ►                  │
  │                         │◄─ Updated Quote ─────────────────────────────────│
  │                         │                        │                      │
  │◄── { quote, event } ────│                        │                      │
```

---

## Data Model Summary

```
Tenant
  ├── Client[]          → clients of this event company
  ├── Quote[]
  │     ├── QuoteItem[] → line items (RENTAL/SALE/SERVICE)
  │     ├── Event[]     → created on approval (main asset bucket)
  │     └── ServiceBucket → created on approval (service commitment tracker)
  │           └── ServiceBucketItem[]
  └── Event[]
        ├── StockMovement[] (DISPATCH on approval, RETURN when assets come back)
        └── ServiceBucket
```

### Key Fields

**Quote**
- `quoteNumber` — auto-generated per tenant (QT-1001, QT-1002, …)
- `status` — DRAFT → PENDING_APPROVAL → APPROVED → INVOICED / CANCELLED
- `globalDiscount` — percentage (0–100), applied to event subtotal
- `includeVat` — if true, tenant.vatPercentage is applied to discountedTotal
- `eventStartDate / eventEndDate` — required before approval; used for conflict detection
- `approvedAt / approvedBy` — stamped on approval

**QuoteItem**
- `type` — RENTAL (daily rate), SALE (one-off), SERVICE (fixed fee)
- `rate` — price-locked at item creation; never editable
- `days` — only meaningful for RENTAL items
- `discountAmount` — per-line flat discount; ADMIN-only

**Event** (main bucket)
- `status` — UPCOMING → ACTIVE → COMPLETED / CANCELLED
- Linked to the approved Quote via `quotes[]`
- `stockMovements` — DISPATCH movements created on approval

**ServiceBucket**
- One per Event (one-to-one)
- `items` — snapshotted at approval time; not linked back to QuoteItems
- Serves as a human-readable commitment record for services

---

## Common Error Codes

| HTTP | Scenario |
|------|----------|
| 400 | Quote not in DRAFT when adding/editing items |
| 400 | Quote not in PENDING_APPROVAL when approving |
| 400 | Event dates missing when approving |
| 400 | Asset not available for requested quantity + dates |
| 400 | Submitting a quote with zero items |
| 400 | Deleting a client that has quotes |
| 403 | STAFF trying to set discountAmount or globalDiscount |
| 403 | STAFF trying to add a SERVICE item |
| 404 | Quote / Client / Asset / Item not found (or belongs to another tenant) |
