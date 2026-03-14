# Event App Service — API Reference

## Overview

Multi-tenant event management backend built with NestJS, Prisma, and Neon PostgreSQL.
Authentication is handled by better-auth with Bearer token sessions.

**Multi-tenancy rule:** Every endpoint automatically scopes data to the authenticated user's tenant. A user from Company A can never read or modify Company B's data — this is enforced at the database query level on every request.

---

## Authentication

All endpoints require a valid Bearer token in the `Authorization` header:

```
Authorization: Bearer <session-token>
```

Tokens are obtained from better-auth on the frontend after login (`authClient.getSession()`).

---

## Roles

| Role  | Description |
|-------|-------------|
| ADMIN | Full access — can create, update, delete, and manage all resources |
| STAFF | Read access on assets/categories; can log stock movements |

---

# Phase 1 — Asset Registry & Inventory Dashboard

Covers: asset categories (with sub-categories), asset CRUD, metadata management, and stock movement logging.

---

## Categories

Categories organise assets (e.g. Tents → Canvas Tents, Stretch Tents).
They support one level of nesting via `parentId`.

### POST /assets/categories

Creates a root category or a sub-category.

**Roles:** ADMIN

**Request body:**
```json
{ "name": "Tents" }
```
```json
{ "name": "Stretch Tents", "parentId": "clx_root_category_id" }
```

**Response 201:**
```json
{
  "id": "clx...",
  "name": "Stretch Tents",
  "tenantId": "clx...",
  "parentId": "clx_root_category_id",
  "parent": { "id": "clx...", "name": "Tents" }
}
```

**Errors:**
- `400` — category name already exists for this tenant
- `400` — `parentId` does not belong to this tenant

---

### GET /assets/categories

Returns the full category tree for the tenant. Root categories include their sub-categories nested.

**Roles:** ADMIN, STAFF

**Response 200:**
```json
[
  {
    "id": "clx...",
    "name": "Furniture",
    "parentId": null,
    "subCategories": [
      {
        "id": "clx...",
        "name": "Chairs",
        "subCategories": [
          { "id": "clx...", "name": "Gold Chiavari Chairs", "subCategories": [] }
        ]
      }
    ]
  }
]
```

---

## Assets

Assets are the physical inventory items. Each tracks three buckets updated by stock movements.

| Bucket | Meaning |
|--------|---------|
| `unitsAvailable` | In the warehouse, ready to rent |
| `unitsOnSite` | Currently deployed at an event |
| `unitsInRepair` | Out of service at the repair workshop |

---

### POST /assets

**Roles:** ADMIN

`unitsAvailable` is automatically set to `totalStock` on creation.

**Request body:**
```json
{
  "name": "Chiavari Chair",
  "sku": "CHR-001",
  "categoryId": "clx...",
  "totalStock": 200,
  "baseRentalRate": 500,
  "metadata": { "color": "Gold", "material": "Resin", "stackable": true }
}
```

**Response 201:**
```json
{
  "id": "clx...",
  "name": "Chiavari Chair",
  "totalStock": 200,
  "unitsAvailable": 200,
  "unitsOnSite": 0,
  "unitsInRepair": 0,
  "baseRentalRate": 500,
  "metadata": { "color": "Gold", "material": "Resin", "stackable": true },
  "category": { "id": "clx...", "name": "Chairs", "parent": { "name": "Furniture" } }
}
```

---

### GET /assets

Inventory Dashboard view — all assets with current bucket counts.

**Roles:** ADMIN, STAFF

**Response 200:**
```json
[
  {
    "id": "clx...",
    "name": "Chiavari Chair",
    "totalStock": 200,
    "unitsAvailable": 140,
    "unitsOnSite": 50,
    "unitsInRepair": 10,
    "baseRentalRate": 500,
    "metadata": { "color": "Gold" },
    "category": { "id": "clx...", "name": "Chairs", "parent": { "name": "Furniture" } }
  }
]
```

---

### GET /assets/:id

Returns a single asset with its 20 most recent stock movements.

**Roles:** ADMIN, STAFF
**Errors:** `404` — not found or belongs to another tenant

---

### PATCH /assets/:id

Partially updates an asset. Only included fields are changed.
`totalStock` is excluded — use `POST /assets/:id/move` for stock changes.

**Roles:** ADMIN

**Request body** (all fields optional):
```json
{
  "name": "Gold Chiavari Chair",
  "baseRentalRate": 600,
  "categoryId": "clx_new_category_id"
}
```

---

### PATCH /assets/:id/metadata

Replaces the entire metadata object. This is a **replace**, not a merge — send the full desired state.

**Roles:** ADMIN

**Request body:**
```json
{
  "metadata": { "color": "Silver", "material": "Aluminium", "stackable": false }
}
```

**Response 200:**
```json
{
  "id": "clx...",
  "name": "Chiavari Chair",
  "metadata": { "color": "Silver", "material": "Aluminium", "stackable": false }
}
```

---

### DELETE /assets/:id

Permanently deletes an asset.

**Roles:** ADMIN
**Errors:** `404` — not found | `400` — referenced in one or more quotes

---

## Stock Movements

Every movement creates an immutable audit log entry and atomically updates the asset's buckets.

### POST /assets/:id/move

**Roles:** ADMIN, STAFF

| `type` | `unitsAvailable` | `unitsOnSite` | `unitsInRepair` | Notes |
|--------|:-:|:-:|:-:|-------|
| `DISPATCH` | − qty | + qty | — | Send to event |
| `RETURN` | + qty | − qty | — | Bring back from event |
| `REPAIR_IN` | − qty | — | + qty | Send to workshop |
| `REPAIR_OUT` | + qty | — | − qty | Back from workshop |
| `LOSS` | − qty | — | — | Permanently lost. `totalStock` unchanged. |

**Request body:**
```json
{
  "type": "DISPATCH",
  "quantity": 50,
  "eventId": "clx_event_id",
  "notes": "Google Gala 2026 setup"
}
```

**Response 201:**
```json
{
  "stockMovement": {
    "id": "clx...",
    "type": "DISPATCH",
    "quantity": 50,
    "assetId": "clx...",
    "userId": "clx...",
    "createdAt": "2026-02-25T10:30:00Z"
  },
  "updatedAsset": {
    "id": "clx...",
    "name": "Chiavari Chair",
    "unitsAvailable": 90,
    "unitsOnSite": 100,
    "unitsInRepair": 10
  }
}
```

**Errors:**
- `400` — movement would drive a bucket below zero (message includes current count)
- `404` — asset not found

---

## Error Responses

| Status | Meaning |
|--------|---------|
| 400 | Invalid body or business rule violation |
| 401 | Missing or invalid Bearer token |
| 403 | Authenticated but insufficient role |
| 404 | Resource not found or belongs to another tenant |

---

## Project Architecture

```
src/
├── domain/
│   ├── assets/
│   │   ├── assets.repository.ts   Prisma queries — tenantId in every WHERE clause
│   │   ├── assets.service.ts      Business logic, validation, error mapping
│   │   └── assets.module.ts       NestJS module wiring
│   └── users/
├── controllers/
│   ├── asset.controller.ts        HTTP routes, NestJS decorators
│   └── dto/asset.dto.ts           class-validator input schemas
├── common/
│   ├── guards/roles.guard.ts      Validates Bearer token, enforces @Roles()
│   └── decorators/roles.decorator.ts
├── prisma.service.ts              Global PrismaClient (Neon serverless)
└── auth.ts                        better-auth lazy singleton
```

**The Developer's Rule:** Every repository method includes `tenantId` in its `where` clause. This is the multi-tenant firewall and is never optional.
