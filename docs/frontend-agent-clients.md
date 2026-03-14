# Frontend Agent Contract — Clients

> **Purpose:** Everything a frontend AI agent or engineer needs to build the Clients section and the client-picker inside the Quote builder. Read this before writing any UI code.

---

## The Mental Model

A **Client** is simply a contact record — the company or individual that hires from this event company. Every quote must be linked to a client, so the client must exist before a quote can be created.

Two things make clients interesting in the UI:

1. **Corporate vs. Individual** — corporate clients have a `contactPerson` field (the human you actually talk to at the company). Individuals don't need it.
2. **Soft delete protection** — a client with existing quotes cannot be deleted. You can only update their details. This preserves the historical record of all past business.

---

## Authentication

Every request must carry the session bearer token:

```
Authorization: Bearer <token>
```

`tenantId` is never sent by the frontend — the server reads it from the token and scopes all queries to the logged-in company automatically.

---

## Role Rules

| Action | ADMIN | STAFF |
|--------|:-----:|:-----:|
| Create a client | ✅ | ❌ |
| Search clients | ✅ | ✅ |
| List all clients | ✅ | ✅ |
| View a single client | ✅ | ✅ |
| Update a client | ✅ | ❌ |
| Delete a client | ✅ | ❌ |

**UI implication:** Staff can browse and search clients (e.g. to pick one when building a quote) but cannot create, edit, or delete them. Hide those controls from STAFF users entirely.

---

## Base URL

```
/api/v1/clients
```

---

## Endpoints

---

### 1. Create Client

```
POST /api/v1/clients
```

**Who:** ADMIN only

**What it does:** Registers a new client for the tenant.

**Request body (JSON):**
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

| Field | Type | Required | Rules |
|-------|------|:--------:|-------|
| `name` | string | ✅ | Non-empty |
| `isCorporate` | boolean | ❌ | Default `false`. When `true`, show `contactPerson` field in the form. |
| `email` | string | ❌ | Valid email format |
| `phone` | string | ❌ | Free-form string — no format enforcement server-side |
| `address` | string | ❌ | Full postal or physical address |
| `contactPerson` | string | ❌ | Primary contact at a corporate client |

**Success response — 201:**
```json
{
  "id": "cmml0td2e0000opp58bvmoaxj",
  "name": "Google Kenya",
  "isCorporate": true,
  "email": "events@google.co.ke",
  "phone": "+254700000000",
  "address": "Waiyaki Way, Westlands, Nairobi",
  "contactPerson": "Jane Doe",
  "tenantId": "cmmjg9wsc00003ip5vvr1gmmz",
  "createdAt": "2026-03-13T09:26:54.540Z",
  "updatedAt": "2026-03-13T09:26:54.540Z"
}
```

**Errors:**
| HTTP | Reason |
|------|--------|
| 400 | Validation failure (e.g. invalid email format) |
| 403 | Caller is STAFF |

**UX notes:**
- Show a **"+ New Client"** button only to ADMINs.
- Toggle visibility of the `contactPerson` field based on the `isCorporate` checkbox state — only show it when checked.
- After creation, you can either navigate to the new client's detail page or close the modal and refresh the list.

---

### 2. Search Clients by Name

```
GET /api/v1/clients/search?q=<query>
```

**Who:** ADMIN, STAFF

**What it does:** Case-insensitive partial name match. Returns up to **20** matching clients ordered alphabetically. This is the primary endpoint for the **client picker** in the Quote builder — call it as the user types.

**Query parameter:**

| Param | Type | Required | Notes |
|-------|------|:--------:|-------|
| `q` | string | ✅ | Non-empty. Minimum 1 character. |

**Example request:**
```
GET /api/v1/clients/search?q=google
```

**Success response — 200:**
```json
[
  {
    "id": "cmml0td2e0000opp58bvmoaxj",
    "name": "Google Kenya",
    "isCorporate": true,
    "email": "events@google.co.ke",
    "phone": "+254700000000",
    "contactPerson": "Jane Doe",
    "_count": { "quotes": 3 }
  }
]
```

> **Note:** `address` is not included in search results — only list-safe fields are returned. Fetch `GET /clients/:id` for the full record.

**Errors:**
| HTTP | Reason |
|------|--------|
| 400 | `q` is missing or empty |

**UX pattern — debounced combobox:**
```
User types "goo"
  → debounce 300ms
  → GET /api/v1/clients/search?q=goo
  → render dropdown of results

User selects "Google Kenya"
  → store { id, name } in quote form state
  → clear dropdown
```

- Debounce input by **300ms** to avoid flooding the server on every keystroke.
- Show `_count.quotes` as a subtle hint: "3 quotes" — helps staff confirm they're picking the right client.
- If the results are empty, show an inline **"Create new client"** shortcut (ADMIN only) that opens the create modal pre-filled with the typed name.

---

### 3. List All Clients

```
GET /api/v1/clients
```

**Who:** ADMIN, STAFF

**What it does:** Returns all clients for the tenant, sorted A→Z by name, with their total quote count. Used for the Clients directory/table view.

**Success response — 200:**
```json
[
  {
    "id": "cmml0td2e0000opp58bvmoaxj",
    "name": "Google Kenya",
    "isCorporate": true,
    "email": "events@google.co.ke",
    "phone": "+254700000000",
    "contactPerson": "Jane Doe",
    "createdAt": "2026-03-10T19:46:20.200Z",
    "_count": { "quotes": 3 }
  },
  {
    "id": "cmml0ur9h0001opp5us9qq3w5",
    "name": "Safaricom PLC",
    "isCorporate": true,
    "email": "events@safaricom.co.ke",
    "phone": "+254722000000",
    "contactPerson": "Brian Odhiambo",
    "createdAt": "2026-02-01T08:00:00.000Z",
    "_count": { "quotes": 12 }
  }
]
```

> **Note:** `address` is excluded from the list for performance — only included in the single-client response.

**Key fields to drive UI:**

| Field | UI use |
|-------|--------|
| `isCorporate` | Show "Corporate" or "Individual" badge |
| `_count.quotes` | Show quote count chip in the table row |
| `contactPerson` | Show only when `isCorporate` is `true` |

---

### 4. Get Single Client

```
GET /api/v1/clients/:id
```

**Who:** ADMIN, STAFF

**What it does:** Returns the client's full profile including their 10 most recent quotes (id, quote number, status only — not full quote detail). Used for the client detail/profile page.

**Success response — 200:**
```json
{
  "id": "cmml0td2e0000opp58bvmoaxj",
  "name": "Google Kenya",
  "isCorporate": true,
  "email": "events@google.co.ke",
  "phone": "+254700000000",
  "address": "Waiyaki Way, Westlands, Nairobi",
  "contactPerson": "Jane Doe",
  "tenantId": "cmmjg9wsc00003ip5vvr1gmmz",
  "createdAt": "2026-03-10T19:46:20.200Z",
  "updatedAt": "2026-03-13T09:26:54.540Z",
  "quotes": [
    { "id": "clx...", "quoteNumber": "QT-1003", "status": "APPROVED" },
    { "id": "clx...", "quoteNumber": "QT-1001", "status": "CANCELLED" }
  ]
}
```

**Quote statuses you may see:**

| Status | Meaning | Badge colour |
|--------|---------|:------------:|
| `DRAFT` | Being built | Grey |
| `PENDING_APPROVAL` | Waiting for admin review | Yellow |
| `APPROVED` | Approved, event is live | Green |
| `INVOICED` | Invoice raised | Blue |
| `CANCELLED` | Voided | Red |

**Errors:**
| HTTP | Reason |
|------|--------|
| 404 | Client not found or belongs to a different tenant |

---

### 5. Update Client

```
PATCH /api/v1/clients/:id
```

**Who:** ADMIN only

**What it does:** Partially updates any client field. Only send the fields you want to change.

**Request body (JSON):** Any subset of the create fields:
```json
{
  "phone": "+254711999888",
  "contactPerson": "Mary Wanjiku"
}
```

| Field | Type | Required | Rules |
|-------|------|:--------:|-------|
| `name` | string | ❌ | Non-empty if provided |
| `isCorporate` | boolean | ❌ | |
| `email` | string | ❌ | Valid email if provided |
| `phone` | string | ❌ | |
| `address` | string | ❌ | |
| `contactPerson` | string | ❌ | |

**Success response — 200:** Full updated client object (same shape as create response, without nested quotes).

**Errors:**
| HTTP | Reason |
|------|--------|
| 400 | Validation failure |
| 403 | Caller is STAFF |
| 404 | Client not found |

**UX notes:**
- Use an inline edit form or a side drawer — not a full page navigation.
- Only send the changed fields, not the entire object.
- If the admin unchecks `isCorporate`, also clear `contactPerson` client-side before submitting.

---

### 6. Delete Client

```
DELETE /api/v1/clients/:id
```

**Who:** ADMIN only

**What it does:** Permanently deletes the client record. **Fails if the client has any quotes** (past or present) — use update to correct details instead.

**No request body.**

**Success response — 200:**
```json
{
  "message": "Client deleted successfully"
}
```

**Errors:**
| HTTP | Reason |
|------|--------|
| 400 | Client has existing quotes — cannot delete |
| 403 | Caller is STAFF |
| 404 | Client not found |

**UX notes:**
- Show the **Delete** button only inside the client detail page, not in the table list row — too destructive for quick access.
- Always show a confirmation: **"Permanently delete Google Kenya? This cannot be undone."**
- If the server returns `400`, show a specific message: **"This client has existing quotes and cannot be deleted. Update their details instead."**
- After successful delete, navigate back to the clients list.

---

## Client Object — Full Shape Reference

```json
{
  "id": "cmml0td2e0000opp58bvmoaxj",
  "name": "Google Kenya",
  "isCorporate": true,
  "email": "events@google.co.ke",
  "phone": "+254700000000",
  "address": "Waiyaki Way, Westlands, Nairobi",
  "contactPerson": "Jane Doe",
  "tenantId": "cmmjg9wsc00003ip5vvr1gmmz",
  "createdAt": "2026-03-10T19:46:20.200Z",
  "updatedAt": "2026-03-13T09:26:54.540Z"
}
```

> `address` only appears in the single-client response (`GET /clients/:id`) — not in list or search results.

---

## Recommended Page Layout

```
/dashboard/clients                        → ADMIN + STAFF (read); ADMIN (write)
  ├── Search bar (live search via /search?q=)
  ├── [+ New Client] button               → ADMIN only, opens create modal
  └── Client table
        ├── Columns: Name, Type badge, Email, Phone, Quote count, Actions
        └── Row click → /dashboard/clients/:id

/dashboard/clients/:id
  ├── Profile card (all fields including address)
  ├── Recent quotes list (last 10, with status badges + link to quote)
  ├── [Edit] button                        → ADMIN only, opens edit drawer
  └── [Delete] button (bottom, red)        → ADMIN only, with confirmation
```

---

## Common Fetch Pattern

```javascript
async function clientsApi(path, method = 'GET', body = null) {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? 'Request failed');
  }

  return res.json();
}

// Usage examples
const results = await clientsApi('/clients/search?q=google');   // search
const all     = await clientsApi('/clients');                    // list
const one     = await clientsApi('/clients/cmml0td2e...');      // single
const created = await clientsApi('/clients', 'POST', {          // create
  name: 'Google Kenya',
  isCorporate: true,
  email: 'events@google.co.ke',
});
const updated = await clientsApi('/clients/cmml0td2e...', 'PATCH', {  // update
  phone: '+254711999888',
});
await clientsApi('/clients/cmml0td2e...', 'DELETE');             // delete
```

---

## Error Handling Cheat Sheet

```javascript
try {
  await clientsApi('/clients', 'POST', body);
} catch (err) {
  if (err.message.includes('existing quotes')) {
    showToast('This client has quotes and cannot be deleted.', 'error');
  } else if (err.status === 403) {
    showToast('Only admins can perform this action.', 'error');
  } else if (err.status === 404) {
    showToast('Client not found.', 'error');
  } else {
    showToast(err.message, 'error');
  }
}
```

---

## Corporate vs. Individual — Form Logic

```javascript
// Show/hide contactPerson based on isCorporate toggle
const showContactPerson = form.isCorporate === true;

// When switching isCorporate from true → false, clear the field
function onIsCorporateChange(checked) {
  form.isCorporate = checked;
  if (!checked) form.contactPerson = '';
}
```
