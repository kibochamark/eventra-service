# Eventra Service — Complete API Reference & System Guide

> **Who this is for:** Frontend engineers and AI agents consuming this API.
> **How to read it:** Start with *What This Service Is*, then skim *Core Concepts*, then jump to whichever API section you need.

---

## Table of Contents

1. [What This Service Is](#1-what-this-service-is)
2. [The Business Model in Plain English](#2-the-business-model-in-plain-english)
3. [Authentication & Multi-Tenancy](#3-authentication--multi-tenancy)
4. [Roles & Permissions](#4-roles--permissions)
5. [Core Concepts](#5-core-concepts)
6. [Business Flows](#6-business-flows)
7. [API Reference — Clients](#7-api-reference--clients)
8. [API Reference — Assets & Inventory](#8-api-reference--assets--inventory)
9. [API Reference — Quotes](#9-api-reference--quotes)
10. [API Reference — File Uploads](#10-api-reference--file-uploads)
11. [Data Models](#11-data-models)
12. [Error Reference](#12-error-reference)
13. [Environment Variables](#13-environment-variables)

---

## 1. What This Service Is

Imagine a company that owns hundreds of event items — gold chairs, silk table runners, LED lighting rigs, giant tents — and rents them out for weddings, corporate galas, and private parties. This service is the backend brain that runs that company.

It handles four things:

1. **Inventory** — knowing exactly how many of each item the company owns, how many are currently at an event, and how many are in the repair workshop.
2. **Quotations** — building a priced list of items and services for a client event, getting it approved, and automatically reserving the physical stock.
3. **Clients** — a contact book of the companies and individuals who hire from this company.
4. **Photos** — visual proof for staff: what does a "Gold Tiffany Chair" look like? What damage does this chair have? Is this payment confirmed?

This is a **multi-tenant SaaS** — meaning many different event rental companies each use the same service, but their data is completely isolated from each other.

---

## 2. The Business Model in Plain English

Here is the full lifecycle of a typical event booking:

```
1. A client (e.g. "Google Kenya") contacts the company.
2. A staff member creates a Client record if one doesn't exist.
3. Staff builds a Quote — a list of items and services with prices.
4. Staff submits the quote for admin review.
5. Admin approves the quote.
   → The system automatically:
      a. Creates an Event (the main container for this booking)
      b. Reserves the physical items (DISPATCH stock movements)
      c. Creates a Service Bucket (a record of all non-physical services like transport)
6. The event happens. Staff return items after the event (RETURN stock movements).
7. If any items are damaged, staff log a REPAIR_IN movement and attach condition photos.
8. When repairs are done, staff log REPAIR_OUT and the item becomes available again.
9. The client pays. Staff upload an M-Pesa receipt or bank slip to the quote as payment proof.
```

---

## 3. Authentication & Multi-Tenancy

### How authentication works

This service uses **better-auth** for session management. Every request that needs authentication must carry a valid session cookie or token. The auth library populates `req.user` automatically.

The `req.user` object contains:
```json
{
  "id": "user-cuid",
  "tenantId": "tenant-cuid",
  "role": "ADMIN" | "STAFF"
}
```

**Every database query is automatically scoped to `tenantId`.** There is no way for one company's staff to see another company's data. The `tenantId` always comes from the authenticated session — it is never trusted from request bodies or URL parameters.

### What this means for the frontend

- After login, your session is tied to one tenant automatically.
- You never need to send `tenantId` in requests — the server reads it from your session.
- If you get a 404 on a resource you know exists, it almost always means it belongs to a different tenant.

---

## 4. Roles & Permissions

There are exactly two roles: **ADMIN** and **STAFF**.

Think of ADMIN as the manager and STAFF as the warehouse/sales team. Staff can do day-to-day work but cannot change financial settings or approve things.

| Action | STAFF | ADMIN |
|--------|:-----:|:-----:|
| View assets, clients, quotes | ✅ | ✅ |
| Create assets, categories | ❌ | ✅ |
| Create clients | ✅ | ✅ |
| Build quotes (add RENTAL/SALE items) | ✅ | ✅ |
| Add SERVICE items to quotes | ❌ | ✅ |
| Set per-item discounts | ❌ | ✅ |
| Set quote global discount / VAT | ❌ | ✅ |
| Submit quote for approval | ✅ | ✅ |
| Approve a quote | ❌ | ✅ |
| Cancel a quote | ❌ | ✅ |
| Log stock movements (dispatch, return, repair) | ✅ | ✅ |
| Upload condition photos on movement | ✅ | ✅ |
| Delete condition photos | ❌ | ✅ |
| Upload payment proof | ✅ | ✅ |
| Delete payment proof | ❌ | ✅ |
| Manage users | ❌ | ✅ |
| Manage tenant settings | ❌ | ✅ |

---

## 5. Core Concepts

### 5.1 The Three Inventory Buckets

Every asset (physical item) has its total stock split across exactly three buckets at all times:

```
totalStock = unitsAvailable + unitsOnSite + unitsInRepair
```

| Bucket | Meaning |
|--------|---------|
| `unitsAvailable` | Sitting in the warehouse, ready to rent |
| `unitsOnSite` | Currently at a client's event |
| `unitsInRepair` | In the workshop being fixed |

When stock moves between buckets, a `StockMovement` record is created as an audit trail. The buckets are updated atomically in the same database transaction.

**Stock movement types and their bucket effects:**

| Movement Type | Available | On Site | In Repair | When to use |
|---------------|:---------:|:-------:|:---------:|-------------|
| `DISPATCH` | ↓ | ↑ | — | Items leaving for an event |
| `RETURN` | ↑ | ↓ | — | Items coming back after an event |
| `REPAIR_IN` | ↓ | — | ↑ | Item found damaged, sent to workshop |
| `REPAIR_OUT` | ↑ | — | ↓ | Item fixed, back in warehouse |
| `LOSS` | ↓ | — | — | Item permanently lost or destroyed |

### 5.2 The Pricing Waterfall

Every quote total is computed in four steps, always in this order:

```
Step 1 — Line Total (per item)
  RENTAL:  (quantity × rate × days) − lineDiscount
  SALE:    (quantity × rate)        − lineDiscount
  SERVICE: (quantity × rate)        − lineDiscount
  ↳ A line can never go below 0 due to discount.

Step 2 — Subtotal
  Sum of all line totals.

Step 3 — Global Discount
  discountedTotal = subtotal × (1 − globalDiscount / 100)
  globalDiscount is a percentage, e.g. 10 means 10%.

Step 4 — VAT (only if quote.includeVat = true)
  vatAmount  = discountedTotal × (tenant.vatPercentage / 100)
  grandTotal = discountedTotal + vatAmount
```

All arithmetic is done with `Prisma.Decimal` — there is no floating-point rounding in this system.

### 5.3 Price Locking

When a RENTAL or SALE item is added to a quote, the asset's `baseRentalRate` is **copied** into the quote item's `rate` field. This copy is never changed again. Future price changes to the asset do not affect existing quotes. The client always pays exactly what was quoted.

**Nobody** — not ADMIN, not STAFF — can edit `rate` after it is set.

### 5.4 Availability Checking

When you add an item to a quote that has event dates, the system checks for conflicts with other approved quotes:

```
alreadyReserved = total quantity from approved quotes
                  for the same asset
                  where date ranges overlap

overlap condition: start1 < end2 AND end1 > start2
(back-to-back bookings are NOT counted as conflicting)

available = asset.unitsAvailable − alreadyReserved
isAvailable = (available >= requestedQuantity)
```

If a quote has no event dates set yet, the check is skipped.

### 5.5 What Happens on Quote Approval

Approving a quote triggers a chain reaction inside a single database transaction:

1. **Event is created** — name, dates, venue pulled from the quote.
2. **DISPATCH movements are created** — one per RENTAL/SALE item. Stock leaves the warehouse.
3. **`unitsAvailable` is decremented** — buckets updated immediately.
4. **Service Bucket is created** — a snapshot of all SERVICE items for the operations team.
5. **Quote status set to APPROVED** — stamped with admin ID and timestamp.

After this, the quote cannot be changed or cancelled through normal endpoints.

### 5.6 Asset Categories

Assets are organized in a two-level tree:

```
Chairs (root category)
  └── Gold Tiffany Chairs (sub-category)
  └── White Banquet Chairs (sub-category)
Tents (root category)
  └── 10x10 Canopy Tents
```

Each category can have one optional image (a banner/icon). Sub-categories can have their own image independent of the parent.

---

## 6. Business Flows

### 6.1 Creating and Booking a Client Event

```
[STAFF] POST /clients              → create client (if new)
[STAFF] POST /quotes               → create DRAFT quote, link to client + event dates
[STAFF] POST /quotes/:id/items     → add chairs (RENTAL), catering setup (SERVICE)
[STAFF] POST /quotes/:id/submit    → move quote to PENDING_APPROVAL

[ADMIN] GET  /quotes/:id           → review quote with computed totals
[ADMIN] POST /quotes/:id/approve   → approve
         ↳ System creates: Event + StockMovements + ServiceBucket

[STAFF] GET  /assets/:id           → confirm stock levels before dispatch
[STAFF] POST /assets/:id/move      → DISPATCH movement when items leave warehouse
                                      (can attach condition photos here too)

... event happens ...

[STAFF] POST /assets/:id/move      → RETURN movement when items come back
[STAFF] POST /assets/:id/move      → REPAIR_IN if anything is damaged
                                      (attach damage photos via 'images' field)

[STAFF] POST /quotes/:id/payment-proof → upload M-Pesa receipt
[ADMIN] GET  /quotes/:id               → see full quote with payment proofs
```

### 6.2 Logging a Damaged Item

When a staff member notices a damaged item after an event:

```
POST /assets/:id/move
Content-Type: multipart/form-data

Fields:
  type     = REPAIR_IN
  quantity = 2
  notes    = "Legs bent during Google Gala setup"
  images   = [photo1.jpg, photo2.jpg]    ← optional, up to many files

Response includes:
  stockMovement.id   ← save this to reference the photos later
  updatedAsset       ← new bucket counts
```

The photos are stored in Cloudinary and linked to the `StockMovement` record. When an engineer views `GET /assets/:id`, the response includes the last 20 stock movements each with their `images` array.

### 6.3 Confirming Payment

After the client pays via M-Pesa or bank transfer:

```
POST /quotes/:id/payment-proof
Content-Type: multipart/form-data

Fields:
  images = [receipt.jpg]    ← one or more files, field name must be "images"

Response: array of uploaded proofs
  [{ imageUrl: "https://res.cloudinary.com/...", publicId: "eventra-service-uploads/..." }]
```

The proofs appear in `GET /quotes/:id` under the `paymentProofs` array.

---

## 7. API Reference — Clients

Base path: `/clients`

---

### `POST /clients`

Creates a new client.

**Auth:** ADMIN, STAFF

**Body (JSON):**
```json
{
  "name": "Google Kenya",
  "isCorporate": true,
  "email": "events@google.co.ke",
  "phone": "+254700000000",
  "address": "Waiyaki Way, Westlands, Nairobi",
  "contactPerson": "Jane Doe"
}
```

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `name` | string | ✅ | Company or individual name |
| `isCorporate` | boolean | ❌ | Default `false`. Corporate clients show a contact person field. |
| `email` | string | ❌ | |
| `phone` | string | ❌ | |
| `address` | string | ❌ | Full postal/physical address |
| `contactPerson` | string | ❌ | Primary contact at a corporate client |

**Response:** Created client object.

---

### `GET /clients`

Lists all clients for the tenant with a count of their quotes.

**Auth:** ADMIN, STAFF

**Response:**
```json
[
  {
    "id": "clx...",
    "name": "Google Kenya",
    "isCorporate": true,
    "email": "events@google.co.ke",
    "phone": "+254700000000",
    "address": "...",
    "contactPerson": "Jane Doe",
    "_count": { "quotes": 3 }
  }
]
```

---

### `GET /clients/:id`

Returns one client with their last 10 quotes (lightweight, no line items).

**Auth:** ADMIN, STAFF

**Response:** Client object with nested `quotes` array.

---

### `PATCH /clients/:id`

Updates any client field. Only provided fields are changed.

**Auth:** ADMIN

**Body:** Same fields as `POST /clients`, all optional.

---

### `DELETE /clients/:id`

Permanently deletes a client.

**Auth:** ADMIN

**Fails with 400** if the client has any quotes (past or present). You cannot delete a client with history.

---

## 8. API Reference — Assets & Inventory

Base path: `/assets`

---

### `POST /assets/categories`

Creates a root category or a sub-category. Optionally accepts a banner image.

**Auth:** ADMIN

**Content-Type:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `name` | string | ✅ | e.g. "Chairs" or "Gold Tiffany Chairs" |
| `parentId` | string | ❌ | If provided, creates a sub-category under this parent |
| `image` | file | ❌ | Single image file. Stored in Cloudinary. |

**Response:** Created category with parent info.

---

### `GET /assets/categories`

Returns the full category tree for the tenant.

**Auth:** ADMIN, STAFF

**Response:**
```json
[
  {
    "id": "clx...",
    "name": "Chairs",
    "imageUrl": "https://res.cloudinary.com/...",
    "subCategories": [
      {
        "id": "clx...",
        "name": "Gold Tiffany Chairs",
        "imageUrl": null,
        "subCategories": []
      }
    ]
  }
]
```

---

### `DELETE /assets/categories/:id`

Deletes a category and its Cloudinary image.

**Auth:** ADMIN

**Fails with 400** if the category has assets or sub-categories linked to it. Move or delete those first.

---

### `POST /assets`

Registers a new asset. On creation, `unitsAvailable` is automatically set to `totalStock`.

**Auth:** ADMIN

**Content-Type:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `name` | string | ✅ | e.g. "Gold Tiffany Chair" |
| `categoryId` | string | ✅ | Must belong to this tenant |
| `totalStock` | integer | ✅ | Total physical units owned |
| `baseRentalRate` | integer | ✅ | Rate in smallest currency unit (e.g. KES cents). Stored as Int. |
| `sku` | string | ❌ | Optional stock-keeping unit code |
| `metadata` | JSON object | ❌ | Flexible attributes: `{ "color": "Gold", "material": "Resin" }` |
| `images` | file(s) | ❌ | One or more image files. Field name must be `images`. |

**Response:** Created asset with category info and images.

> **Note on `baseRentalRate`:** Store it as an integer in the smallest unit (e.g. if the rate is KES 500, send `500`). The frontend is responsible for formatting display.

---

### `GET /assets`

Lists all assets with current bucket counts and category info. This is the Inventory Dashboard view.

**Auth:** ADMIN, STAFF

**Response:**
```json
[
  {
    "id": "clx...",
    "name": "Gold Tiffany Chair",
    "sku": "CHR-GOLD-001",
    "totalStock": 100,
    "unitsAvailable": 75,
    "unitsOnSite": 20,
    "unitsInRepair": 5,
    "baseRentalRate": 500,
    "metadata": { "color": "Gold", "material": "Resin" },
    "category": { "id": "...", "name": "Gold Tiffany Chairs", "parent": { "id": "...", "name": "Chairs" } },
    "images": [
      { "id": "...", "imageUrl": "https://res.cloudinary.com/...", "publicId": "...", "createdAt": "..." }
    ]
  }
]
```

---

### `GET /assets/:id`

Returns one asset with full detail: category, images, and the 20 most recent stock movements (each with their condition photos).

**Auth:** ADMIN, STAFF

**Response includes:**
```json
{
  "stockMovements": [
    {
      "id": "...",
      "type": "REPAIR_IN",
      "quantity": 2,
      "notes": "Legs bent during Google Gala",
      "createdAt": "...",
      "images": [
        { "id": "...", "imageUrl": "https://res.cloudinary.com/...", "publicId": "..." }
      ]
    }
  ]
}
```

---

### `PATCH /assets/:id`

Updates asset fields. `totalStock` is **excluded** — stock quantity changes happen only through `/move`.

**Auth:** ADMIN

**Body (JSON):** Any subset of `name`, `sku`, `categoryId`, `metadata`, `baseRentalRate`.

---

### `PATCH /assets/:id/metadata`

Replaces the entire metadata object. This is a **full replace**, not a merge — send the complete new state.

**Auth:** ADMIN

**Body (JSON):**
```json
{
  "metadata": { "color": "Gold", "material": "Resin", "size": "Standard" }
}
```

---

### `POST /assets/:id/move`

Logs a stock movement and atomically updates the three inventory buckets. Optionally attach condition photos (e.g., for `REPAIR_IN` damage documentation).

**Auth:** ADMIN, STAFF

**Content-Type:** `multipart/form-data` (use JSON if no photos)

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `type` | enum | ✅ | `DISPATCH`, `RETURN`, `REPAIR_IN`, `REPAIR_OUT`, `LOSS` |
| `quantity` | integer ≥ 1 | ✅ | Number of units to move |
| `eventId` | string | ❌ | Link to an Event (recommended for DISPATCH/RETURN) |
| `notes` | string | ❌ | Free text. e.g. "Legs bent during Google Gala" |
| `images` | file(s) | ❌ | Condition photos. Field name must be `images`. |

**Response:**
```json
{
  "stockMovement": {
    "id": "clx...",
    "type": "REPAIR_IN",
    "quantity": 2,
    "notes": "Legs bent",
    "createdAt": "..."
  },
  "updatedAsset": {
    "id": "clx...",
    "name": "Gold Tiffany Chair",
    "unitsAvailable": 73,
    "unitsOnSite": 20,
    "unitsInRepair": 7
  }
}
```

**Validation rules:**
- `DISPATCH`: requires `unitsAvailable >= quantity`
- `RETURN`: requires `unitsOnSite >= quantity`
- `REPAIR_IN`: requires `unitsAvailable >= quantity`
- `REPAIR_OUT`: requires `unitsInRepair >= quantity`
- `LOSS`: requires `unitsAvailable >= quantity`

---

### `DELETE /assets/:id`

Permanently deletes an asset and all its Cloudinary images.

**Auth:** ADMIN

**Fails with 400** if the asset is referenced in any quote. Remove or void those quotes first.

---

### `POST /assets/:id/images`

Uploads one or more images and attaches them to the asset (the "reference photos" staff use to identify items on the truck).

**Auth:** ADMIN

**Content-Type:** `multipart/form-data`

| Field | Type | Required |
|-------|------|:--------:|
| `images` | file(s) | ✅ |

**Response:** Array of uploaded image objects.

---

### `DELETE /assets/:id/images/:imageId`

Removes a single asset image from both the database and Cloudinary.

**Auth:** ADMIN

**Response:** `{ "message": "Image deleted successfully" }`

---

### `DELETE /assets/:id/movements/:imageId`

Removes a single condition photo that was attached to a stock movement.

**Auth:** ADMIN

**Response:** `{ "message": "Condition photo deleted successfully" }`

---

## 9. API Reference — Quotes

Base path: `/quotes`

---

### `POST /quotes`

Creates a new DRAFT quote for a client.

**Auth:** ADMIN, STAFF

**Body (JSON):**
```json
{
  "clientId": "clx...",
  "eventStartDate": "2025-08-15T00:00:00.000Z",
  "eventEndDate": "2025-08-16T00:00:00.000Z",
  "notes": "Setup by 6am, breakdown by 10pm"
}
```

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `clientId` | string | ✅ | Must belong to this tenant |
| `eventStartDate` | ISO date string | ❌ | Required before approval. Used for availability checking. |
| `eventEndDate` | ISO date string | ❌ | Required before approval. |
| `notes` | string | ❌ | Free text for internal notes |

**Response:** Created quote with auto-generated `quoteNumber` (e.g. `QT-1001`).

---

### `GET /quotes`

Lists all quotes for the tenant with client info and item count.

**Auth:** ADMIN, STAFF

**Response:**
```json
[
  {
    "id": "clx...",
    "quoteNumber": "QT-1001",
    "status": "APPROVED",
    "includeVat": true,
    "globalDiscount": "10.00",
    "eventStartDate": "2025-08-15T00:00:00.000Z",
    "eventEndDate": "2025-08-16T00:00:00.000Z",
    "client": { "id": "...", "name": "Google Kenya" },
    "_count": { "items": 5 }
  }
]
```

---

### `GET /quotes/:id`

Returns a full quote with all line items, computed financial totals, event links, service bucket, and payment proofs.

**Auth:** ADMIN, STAFF

**Response includes computed totals:**
```json
{
  "id": "clx...",
  "quoteNumber": "QT-1001",
  "status": "APPROVED",
  "items": [
    {
      "id": "...",
      "type": "RENTAL",
      "description": "Gold Tiffany Chair",
      "quantity": 200,
      "rate": "500.00",
      "days": 2,
      "discountAmount": "0.00",
      "asset": { "id": "...", "name": "Gold Tiffany Chair", "sku": "CHR-GOLD-001" }
    }
  ],
  "paymentProofs": [
    { "id": "...", "imageUrl": "https://res.cloudinary.com/...", "createdAt": "..." }
  ],
  "events": [{ "id": "...", "name": "Google Kenya Gala 2025", "status": "UPCOMING" }],
  "serviceBucket": {
    "id": "...",
    "items": [
      { "description": "Transport", "quantity": 1, "rate": "15000.00", "total": "15000.00" }
    ]
  },
  "summary": {
    "subtotal": "215000.00",
    "discountAmount": "21500.00",
    "discountedTotal": "193500.00",
    "vatAmount": "30960.00",
    "grandTotal": "224460.00"
  }
}
```

---

### `PATCH /quotes/:id`

Updates quote header settings. Quote must be in `DRAFT` or `PENDING_APPROVAL` status.

**Auth:** ADMIN

**Body (JSON):** Any subset of:
```json
{
  "globalDiscount": 10,
  "includeVat": true,
  "clientId": "clx...",
  "eventStartDate": "2025-08-15T00:00:00.000Z",
  "eventEndDate": "2025-08-16T00:00:00.000Z",
  "notes": "Updated notes"
}
```

---

### `POST /quotes/:id/items`

Adds a line item to a **DRAFT** quote.

**Auth:** ADMIN, STAFF (SERVICE items: ADMIN only)

**Body (JSON):**

For RENTAL or SALE items:
```json
{
  "type": "RENTAL",
  "description": "Gold Tiffany Chair",
  "assetId": "clx...",
  "quantity": 200,
  "days": 2
}
```

For SERVICE items:
```json
{
  "type": "SERVICE",
  "description": "Transport & Setup",
  "rate": 15000,
  "quantity": 1,
  "days": 1
}
```

| Field | Type | Required | Notes |
|-------|------|:--------:|-------|
| `type` | `RENTAL` \| `SALE` \| `SERVICE` | ✅ | |
| `description` | string | ✅ | Label shown on quote |
| `assetId` | string | For RENTAL/SALE | Rate is auto-set from asset. Cannot be provided. |
| `rate` | number | For SERVICE | Fixed price. Not required for RENTAL/SALE (price-locked from asset). |
| `quantity` | integer ≥ 1 | ✅ | |
| `days` | integer ≥ 1 | ❌ | Only meaningful for RENTAL. Default 1. |

---

### `PATCH /quotes/:id/items/:itemId`

Updates a line item on a **DRAFT** quote.

**Auth:** ADMIN, STAFF

**Role differences:**
- STAFF can change: `description`, `quantity`, `days`
- ADMIN can also change: `discountAmount`
- Nobody can change: `rate` (price-locked forever)

**Body (JSON):**
```json
{
  "quantity": 250,
  "days": 3,
  "discountAmount": 5000
}
```

---

### `DELETE /quotes/:id/items/:itemId`

Removes a line item from a **DRAFT** quote.

**Auth:** ADMIN, STAFF

---

### `POST /quotes/:id/submit`

Moves the quote from `DRAFT` → `PENDING_APPROVAL`.

**Auth:** ADMIN, STAFF

**Requirements:** Quote must have at least one line item.

---

### `POST /quotes/:id/approve`

Approves the quote. Triggers the full booking chain (see [What Happens on Quote Approval](#55-what-happens-on-quote-approval)).

**Auth:** ADMIN

**Requirements:**
- Quote must be in `PENDING_APPROVAL` status.
- Quote must have `eventStartDate` and `eventEndDate` set.

**Response:**
```json
{
  "quote": { "...approved quote..." },
  "event": { "id": "...", "name": "Google Kenya Gala 2025", "status": "UPCOMING" }
}
```

---

### `POST /quotes/:id/cancel`

Cancels a quote. Only works on `DRAFT` or `PENDING_APPROVAL` quotes.

**Auth:** ADMIN

---

### `POST /quotes/:id/payment-proof`

Uploads one or more payment proof images (M-Pesa receipts, bank transfer slips, etc.) and attaches them to the quote.

**Auth:** ADMIN, STAFF

**Content-Type:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `images` | file(s) | ✅ | One or more image files. Field name must be `images`. |

**Response:**
```json
[
  {
    "imageUrl": "https://res.cloudinary.com/...",
    "publicId": "eventra-service-uploads/1748000000-receipt"
  }
]
```

**Rejected if:** Quote status is `CANCELLED`.

---

### `DELETE /quotes/:id/payment-proof/:proofId`

Removes a payment proof image from the quote and from Cloudinary.

**Auth:** ADMIN

**Response:** `{ "message": "Payment proof deleted successfully" }`

---

## 10. API Reference — File Uploads

All file upload endpoints follow the same pattern. Here is a summary:

| Endpoint | Field name | Max files | Cloudinary folder | Who |
|----------|-----------|:---------:|-------------------|-----|
| `POST /assets/categories` | `image` | 1 | `eventra-service-uploads` | ADMIN |
| `POST /assets` | `images` | many | `eventra-service-uploads` | ADMIN |
| `POST /assets/:id/images` | `images` | many | `eventra-service-uploads` | ADMIN |
| `POST /assets/:id/move` | `images` | many | `eventra-service-uploads` | ADMIN, STAFF |
| `POST /quotes/:id/payment-proof` | `images` | many | `eventra-service-uploads` | ADMIN, STAFF |

### Upload rules

- All uploads use `multipart/form-data`.
- The field name **must match exactly** (e.g. `images`, not `image` or `file`).
- Files are streamed directly to Cloudinary — they are never written to disk.
- If the Cloudinary upload succeeds but the database write fails, the Cloudinary files are deleted automatically (rollback).
- Each image stored in the DB has two fields:
  - `imageUrl` — the public display URL (`https://res.cloudinary.com/...`)
  - `publicId` — the Cloudinary identifier used for deletion

### How to upload with `fetch`

```javascript
const form = new FormData();
form.append('images', fileInput.files[0]);
form.append('images', fileInput.files[1]); // multiple files

await fetch('/assets/:id/images', {
  method: 'POST',
  body: form,
  // DO NOT set Content-Type manually — browser sets it with the boundary
  credentials: 'include', // for session cookie
});
```

---

## 11. Data Models

### Tenant

The owner of an event rental company. Each Tenant is one SaaS customer.

| Field | Type | Description |
|-------|------|-------------|
| `id` | cuid | Primary key |
| `companyName` | string (unique) | Company name |
| `isVatRegistered` | boolean | Whether VAT applies |
| `vatPercentage` | float | Default 16.0 (East Africa standard) |

---

### User

A staff member or admin belonging to a Tenant.

| Field | Type | Description |
|-------|------|-------------|
| `id` | cuid | Primary key |
| `name` | string | Display name |
| `email` | string (unique) | Login email |
| `role` | `ADMIN` \| `STAFF` | |
| `tenantId` | cuid | FK → Tenant |

---

### Client

A company or individual who hires from the Tenant.

| Field | Type | Description |
|-------|------|-------------|
| `id` | cuid | |
| `name` | string | |
| `isCorporate` | boolean | |
| `email` | string? | |
| `phone` | string? | |
| `address` | text? | |
| `contactPerson` | string? | Primary contact at corporate clients |
| `tenantId` | cuid | FK → Tenant |

---

### Category

A hierarchical grouping for assets (up to 2 levels deep).

| Field | Type | Description |
|-------|------|-------------|
| `id` | cuid | |
| `name` | string | Unique per tenant |
| `parentId` | cuid? | FK → Category (null = root) |
| `imageUrl` | string? | Cloudinary display URL |
| `imagePublicId` | string? | Cloudinary public_id for deletion |
| `tenantId` | cuid | |

---

### Asset

A physical rental item owned by the Tenant.

| Field | Type | Description |
|-------|------|-------------|
| `id` | cuid | |
| `name` | string | e.g. "Gold Tiffany Chair" |
| `sku` | string? | Optional stock-keeping unit |
| `categoryId` | cuid | FK → Category |
| `metadata` | JSON | Flexible attributes: `{ color, material, size, ... }` |
| `totalStock` | int | Total physical units |
| `baseRentalRate` | int | Per-unit rate in smallest currency unit |
| `unitsAvailable` | int | Warehouse bucket |
| `unitsOnSite` | int | Event bucket |
| `unitsInRepair` | int | Workshop bucket |
| `tenantId` | cuid | |

**Invariant:** `totalStock = unitsAvailable + unitsOnSite + unitsInRepair`
*(except during a `LOSS` movement, after which totalStock is no longer meaningful as a sum)*

---

### AssetImage

Reference photos of an asset (so staff know what to load on the truck).

| Field | Type | Description |
|-------|------|-------------|
| `id` | cuid | |
| `assetId` | cuid | FK → Asset (cascades on delete) |
| `imageUrl` | string | Cloudinary display URL |
| `publicId` | string | Cloudinary identifier |

---

### StockMovement

An immutable audit log entry for every inventory change.

| Field | Type | Description |
|-------|------|-------------|
| `id` | cuid | |
| `assetId` | cuid | FK → Asset |
| `type` | `MovementType` | DISPATCH, RETURN, REPAIR_IN, REPAIR_OUT, LOSS |
| `quantity` | int | Units moved |
| `eventId` | cuid? | FK → Event (for DISPATCH/RETURN) |
| `notes` | string? | Free text |
| `userId` | cuid | Who logged the movement |

---

### StockMovementImage

Condition photos attached to a stock movement (e.g. damage photos for `REPAIR_IN`).

| Field | Type | Description |
|-------|------|-------------|
| `id` | cuid | |
| `stockMovementId` | cuid | FK → StockMovement (cascades on delete) |
| `imageUrl` | string | Cloudinary display URL |
| `publicId` | string | Cloudinary identifier |

---

### Quote

A priced proposal for a client event. The commercial core of the system.

| Field | Type | Description |
|-------|------|-------------|
| `id` | cuid | |
| `quoteNumber` | string (unique) | Auto-generated: `QT-1001`, `QT-1002`, … |
| `status` | `QuoteStatus` | DRAFT → PENDING_APPROVAL → APPROVED → INVOICED / CANCELLED |
| `includeVat` | boolean | Whether to add VAT to the total |
| `globalDiscount` | decimal | Percentage discount on the subtotal (e.g. `10` = 10%) |
| `eventStartDate` | datetime? | Required before approval |
| `eventEndDate` | datetime? | Required before approval |
| `notes` | text? | Internal notes |
| `approvedAt` | datetime? | Set on approval |
| `approvedBy` | cuid? | User ID of approving admin |
| `clientId` | cuid | FK → Client |
| `tenantId` | cuid | |

---

### QuoteItem

A single line on a quote.

| Field | Type | Description |
|-------|------|-------------|
| `id` | cuid | |
| `quoteId` | cuid | FK → Quote |
| `type` | `ItemType` | RENTAL, SALE, SERVICE |
| `description` | string | Label on the quote |
| `assetId` | cuid? | FK → Asset (null for SERVICE items) |
| `quantity` | int | |
| `rate` | decimal | Price-locked at creation |
| `days` | int | Only used for RENTAL calculation |
| `discountAmount` | decimal | Per-line flat discount (ADMIN-only) |

**Line total formula:**
- RENTAL: `(quantity × rate × days) − discountAmount`
- SALE / SERVICE: `(quantity × rate) − discountAmount`

---

### QuotePaymentProof

Payment evidence attached to a quote (M-Pesa receipts, bank slips).

| Field | Type | Description |
|-------|------|-------------|
| `id` | cuid | |
| `quoteId` | cuid | FK → Quote (cascades on delete) |
| `imageUrl` | string | Cloudinary display URL |
| `publicId` | string | Cloudinary identifier |

---

### Event

Created automatically when a quote is approved. The main container for an active booking.

| Field | Type | Description |
|-------|------|-------------|
| `id` | cuid | |
| `name` | string | Auto-named from quote number |
| `venue` | string? | |
| `startDate` | datetime | From the approved quote |
| `endDate` | datetime | From the approved quote |
| `status` | `EventStatus` | UPCOMING → ACTIVE → COMPLETED / CANCELLED |
| `tenantId` | cuid | |

---

### ServiceBucket + ServiceBucketItem

Created on quote approval. A snapshot of all SERVICE-type quote items, used by the operations team to track service commitments (transport, setup crews, etc.).

**ServiceBucket:** One per Event. Links Event ↔ Quote.

**ServiceBucketItem:**

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Snapshotted from QuoteItem |
| `quantity` | int | Snapshotted |
| `rate` | decimal | Snapshotted |
| `total` | decimal | Pre-computed: `quantity × rate` |

*ServiceBucketItems are snapshots — they are not linked back to QuoteItems. Changes to the original quote after approval do not affect them.*

---

### BusinessConfig

Per-tenant global settings.

| Field | Type | Description |
|-------|------|-------------|
| `defaultVat` | decimal | Default 16.0 |
| `currency` | string | Default "KES" |
| `termsAndConditions` | text? | Printed on quotes/invoices |

---

## 12. Error Reference

All errors follow this shape:

```json
{
  "statusCode": 400,
  "message": "Human-readable description",
  "error": "Bad Request"
}
```

| HTTP | Condition |
|------|-----------|
| `400` | Quote not in DRAFT when adding/editing/removing items |
| `400` | Quote not in PENDING_APPROVAL when approving |
| `400` | Missing event dates when approving a quote |
| `400` | Asset not available for requested quantity + date range |
| `400` | Submitting a quote with zero line items |
| `400` | Deleting a client that has quotes |
| `400` | Deleting a category that has assets or sub-categories |
| `400` | Deleting an asset that is in a quote |
| `400` | Stock movement would make a bucket go below 0 |
| `400` | Uploading payment proof to a CANCELLED quote |
| `403` | STAFF trying to set `discountAmount` or `globalDiscount` |
| `403` | STAFF trying to add a SERVICE item |
| `403` | STAFF trying to approve or cancel a quote |
| `404` | Any resource not found OR belonging to a different tenant |

> **About 404s:** The system never distinguishes "not found" from "belongs to another tenant" — both return 404. This is intentional to prevent tenant enumeration attacks.

---

## 13. Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (Neon serverless) |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary account cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| `BETTER_AUTH_SECRET` | Secret key for better-auth session signing |

All variables must be set before starting the server. The app will fail to start if Cloudinary is not configured (it initializes on module load).

---

*Last updated: reflects StockMovementImage and QuotePaymentProof additions. See `prisma/schema.prisma` for the authoritative data model.*
