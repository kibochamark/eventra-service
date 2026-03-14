# Frontend Agent Contract — Users Management

> **Purpose:** Everything a frontend AI agent or engineer needs to build the Users section of the admin dashboard. Read this top-to-bottom before writing any UI code.

---

## The Mental Model

Think of this module as a **staff directory with an on/off switch**.

- The **ADMIN** is the manager — they hire people (create), fire people (delete), flip the on/off switch (deactivate/activate), reset forgotten passwords, and change job titles (roles).
- **STAFF** members can only update their own name and email — nothing else.

There is no self-registration flow. Every user account is created by an ADMIN. Passwords are hashed by the auth layer (better-auth) — the frontend never needs to handle raw password storage.

---

## Authentication

Every request must include the session bearer token:

```
Authorization: Bearer <token>
```

The token comes from the login response. Every operation is automatically scoped to the logged-in admin's company (tenant). You never send `tenantId` — the server reads it from the token.

---

## Role Rules (enforce these in the UI)

| Action | ADMIN | STAFF |
|--------|:-----:|:-----:|
| Create a user | ✅ | ❌ |
| List all users | ✅ | ❌ |
| View any user profile | ✅ | ❌ |
| Update **own** name / email | ✅ | ✅ |
| Update **another user's** name / email | ✅ | ❌ — 403 |
| Change a user's role | ✅ | ❌ |
| Reset another user's password | ✅ | ❌ |
| Deactivate / Activate a user | ✅ | ❌ |
| Delete a user | ✅ | ❌ |

**UI implication:** Staff should see only their own profile page with an edit form for name/email. Admins see the full user management table.

---

## Base URL

```
/api/v1/users
```

---

## Endpoints

---

### 1. Create User

```
POST /api/v1/users
```

**Who:** ADMIN only

**What it does:** Creates a new staff member or admin account. The password is hashed by the server — never store or log it.

**Request body (JSON):**
```json
{
  "name": "Jane Muthoni",
  "email": "jane@acmeevents.co.ke",
  "password": "SecurePass123",
  "role": "STAFF"
}
```

| Field | Type | Required | Rules |
|-------|------|:--------:|-------|
| `name` | string | ✅ | Non-empty |
| `email` | string | ✅ | Valid email format |
| `password` | string | ✅ | Minimum 8 characters |
| `role` | `"ADMIN"` \| `"STAFF"` | ❌ | Defaults to `"STAFF"` if omitted |

**Success response — 201:**
```json
{
  "id": "cmmop0bf80001izp5y4brolon",
  "name": "Jane Muthoni",
  "email": "jane@acmeevents.co.ke",
  "role": "STAFF",
  "tenantId": "cmmjg9wsc00003ip5vvr1gmmz",
  "banned": false,
  "emailVerified": false,
  "createdAt": "2026-03-13T09:26:54.540Z",
  "updatedAt": "2026-03-13T09:26:54.540Z"
}
```

**Errors:**
| HTTP | Reason |
|------|--------|
| 400 | Email already taken |
| 400 | Password shorter than 8 characters |
| 403 | Caller is not ADMIN |

**UX notes:**
- Show a "Create User" button only to ADMINs.
- After success, append the new user to the list without a full page reload.
- Email duplication error should highlight the email field specifically.

---

### 2. List All Users

```
GET /api/v1/users
```

**Who:** ADMIN only

**What it does:** Returns every user in the tenant. Used to populate the user management table.

**Success response — 200:**
```json
[
  {
    "id": "cmmop0bf80001izp5y4brolon",
    "name": "Jane Muthoni",
    "email": "jane@acmeevents.co.ke",
    "role": "STAFF",
    "banned": false,
    "emailVerified": false,
    "createdAt": "2026-03-13T09:26:54.540Z",
    "updatedAt": "2026-03-13T09:26:54.540Z"
  },
  {
    "id": "cmmop0bf80002izp5abcdefgh",
    "name": "Brian Odhiambo",
    "email": "brian@acmeevents.co.ke",
    "role": "ADMIN",
    "banned": true,
    "emailVerified": true,
    "createdAt": "2026-02-01T08:00:00.000Z",
    "updatedAt": "2026-03-10T14:22:00.000Z"
  }
]
```

**Key fields to drive UI state:**

| Field | UI meaning |
|-------|------------|
| `role` | Show "Admin" or "Staff" badge |
| `banned` | Show red "Inactive" badge; disable login ability |
| `emailVerified` | Show unverified warning icon if `false` |

---

### 3. Get Single User

```
GET /api/v1/users/:userId
```

**Who:** ADMIN only

**What it does:** Returns a single user's full profile. Used for a user detail/edit drawer or page.

**Success response — 200:** Same shape as a single object from the list above.

**Errors:**
| HTTP | Reason |
|------|--------|
| 404 | User not found or belongs to a different tenant |

---

### 4. Update Name / Email

```
PATCH /api/v1/users/:userId
```

**Who:** ADMIN (any user) · STAFF (own record only — server enforces this)

**What it does:** Updates the user's display name and/or email. Both fields are optional — send only what changed.

**Request body (JSON):**
```json
{
  "name": "Jane W. Muthoni",
  "email": "jane.muthoni@acmeevents.co.ke"
}
```

| Field | Type | Required | Rules |
|-------|------|:--------:|-------|
| `name` | string | ❌ | Non-empty if provided |
| `email` | string | ❌ | Valid email format if provided |

**Success response — 200:** Updated user object.

**Errors:**
| HTTP | Reason |
|------|--------|
| 400 | New email is already taken by another user |
| 403 | STAFF trying to update someone else's profile |
| 404 | User not found |

**UX notes:**
- For STAFF: show a simple "Edit My Profile" form with only name and email fields.
- For ADMIN: show inline edit in the user table or a side drawer.
- Highlight the email field on a 400 duplicate email error.

---

### 5. Change Role

```
PATCH /api/v1/users/:userId/role
```

**Who:** ADMIN only

**What it does:** Promotes a STAFF member to ADMIN, or demotes an ADMIN to STAFF.

**Request body (JSON):**
```json
{
  "role": "ADMIN"
}
```

| Field | Type | Required | Values |
|-------|------|:--------:|--------|
| `role` | string | ✅ | `"ADMIN"` or `"STAFF"` |

**Success response — 200:** Updated user object with new role.

**Errors:**
| HTTP | Reason |
|------|--------|
| 400 | Invalid role value |
| 403 | Caller is not ADMIN |
| 404 | User not found |

**UX notes:**
- Render as a role dropdown in the user row/drawer.
- Consider a confirmation dialog — "Promote Jane to Admin?" — since this is a privileged change.
- Prevent an admin from changing their own role (guard this in the UI, as the API allows it).

---

### 6. Reset Password (Admin Force-Reset)

```
POST /api/v1/users/:userId/password
```

**Who:** ADMIN only

**What it does:** The admin sets a new password for any user without needing the old one. Useful when a staff member is locked out. The password is immediately hashed and stored — the user's existing sessions are not invalidated (they can keep working, but next login uses the new password).

**Request body (JSON):**
```json
{
  "newPassword": "NewSecure456"
}
```

| Field | Type | Required | Rules |
|-------|------|:--------:|-------|
| `newPassword` | string | ✅ | Minimum 8 characters |

**Success response — 200:**
```json
{
  "message": "Password updated successfully"
}
```

**Errors:**
| HTTP | Reason |
|------|--------|
| 400 | Password shorter than 8 characters |
| 403 | Caller is not ADMIN |
| 404 | User not found |

**UX notes:**
- Surface as a "Reset Password" button inside the user detail drawer, not in the main table.
- Use a modal with a password input + confirm password field (validate match client-side before sending).
- Show a success toast — "Password reset for Jane Muthoni."

---

### 7. Deactivate User

```
POST /api/v1/users/:userId/deactivate
```

**Who:** ADMIN only

**What it does:** Bans the user. The server sets `banned = true`. better-auth will reject any future login attempts and invalidate active sessions for this user. The account record is preserved — this is reversible.

**No request body.**

**Success response — 200:**
```json
{
  "id": "cmmop0bf80001izp5y4brolon",
  "name": "Jane Muthoni",
  "banned": true,
  ...
}
```

**Errors:**
| HTTP | Reason |
|------|--------|
| 403 | Caller is not ADMIN |
| 404 | User not found |

**UX notes:**
- Surface as a "Deactivate" button, visible only when `banned === false`.
- Show a confirmation: "Deactivating Jane will prevent her from logging in. Continue?"
- After success, flip the status badge to red "Inactive" and replace the button with "Activate".

---

### 8. Activate User

```
POST /api/v1/users/:userId/activate
```

**Who:** ADMIN only

**What it does:** Clears the ban. The user can log in again immediately. Existing sessions are not automatically restored — they will need to log in fresh.

**No request body.**

**Success response — 200:**
```json
{
  "id": "cmmop0bf80001izp5y4brolon",
  "name": "Jane Muthoni",
  "banned": false,
  ...
}
```

**Errors:**
| HTTP | Reason |
|------|--------|
| 403 | Caller is not ADMIN |
| 404 | User not found |

**UX notes:**
- Surface as an "Activate" button, visible only when `banned === true`.
- No confirmation dialog needed — activating is reversible and harmless.
- After success, flip badge to green "Active" and replace the button with "Deactivate".

---

### 9. Delete User

```
DELETE /api/v1/users/:userId
```

**Who:** ADMIN only

**What it does:** Permanently removes the user and all their sessions from the database. This is **irreversible**.

**No request body.**

**Success response — 200:**
```json
{
  "message": "User deleted successfully"
}
```

**Errors:**
| HTTP | Reason |
|------|--------|
| 403 | Caller is not ADMIN |
| 404 | User not found |

**UX notes:**
- Surface as a "Delete" button inside the user detail drawer, not in the main table row (too destructive).
- Always show a confirmation dialog with the user's name: "Permanently delete Jane Muthoni? This cannot be undone."
- After success, remove the user from the list and navigate back to the users table.
- Consider using "Deactivate" as the primary action and burying "Delete" — deactivation is safer and reversible.

---

## User Object — Full Shape Reference

Every endpoint that returns a user returns this shape:

```json
{
  "id": "cmmop0bf80001izp5y4brolon",
  "name": "Jane Muthoni",
  "email": "jane@acmeevents.co.ke",
  "role": "STAFF",
  "tenantId": "cmmjg9wsc00003ip5vvr1gmmz",
  "banned": false,
  "emailVerified": false,
  "createdAt": "2026-03-13T09:26:54.540Z",
  "updatedAt": "2026-03-13T09:26:54.540Z"
}
```

---

## Recommended Page Layout

```
/dashboard/users                   → Admin only
  ├── User table (name, email, role badge, status badge, actions)
  │     ├── [Create User] button   → opens modal
  │     └── Row click              → opens side drawer
  │
  └── Side drawer (per user)
        ├── Display: name, email, role, status, joined date
        ├── [Edit Info] form       → PATCH /users/:id
        ├── [Change Role] dropdown → PATCH /users/:id/role
        ├── [Reset Password]       → POST /users/:id/password
        ├── [Deactivate/Activate]  → POST /users/:id/deactivate | activate
        └── [Delete] (bottom, red) → DELETE /users/:id

/dashboard/profile                 → ADMIN + STAFF
  └── Edit own name / email        → PATCH /users/:ownId
```

---

## Status Badge Logic

```javascript
// Drive the status badge from the `banned` field
const status = user.banned ? "Inactive" : "Active";
const badgeColor = user.banned ? "red" : "green";

// Drive the action button from the same field
const primaryAction = user.banned ? "Activate" : "Deactivate";
const primaryEndpoint = user.banned
  ? `/api/v1/users/${user.id}/activate`
  : `/api/v1/users/${user.id}/deactivate`;
```

---

## Common Fetch Pattern

```javascript
// All users API calls follow this pattern
async function usersApi(path, method = 'GET', body = null) {
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

// Examples
const users       = await usersApi('/users');
const user        = await usersApi(`/users/${id}`);
const created     = await usersApi('/users', 'POST', { name, email, password, role });
const updated     = await usersApi(`/users/${id}`, 'PATCH', { name, email });
const roleChanged = await usersApi(`/users/${id}/role`, 'PATCH', { role: 'ADMIN' });
const pwReset     = await usersApi(`/users/${id}/password`, 'POST', { newPassword });
const deactivated = await usersApi(`/users/${id}/deactivate`, 'POST');
const activated   = await usersApi(`/users/${id}/activate`, 'POST');
const deleted     = await usersApi(`/users/${id}`, 'DELETE');
```

---

## Error Handling Cheat Sheet

```javascript
try {
  await usersApi('/users', 'POST', body);
} catch (err) {
  if (err.message.includes('already exists')) {
    setFieldError('email', 'This email is already in use');
  } else if (err.status === 403) {
    showToast('You do not have permission to do this', 'error');
  } else if (err.status === 404) {
    showToast('User not found', 'error');
  } else {
    showToast(err.message, 'error');
  }
}
```
