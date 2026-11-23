# Security Specification — DPEM Outage Map Firestore Rules

## 1. Role Hierarchy & RBAC Invariants
1. **Super Admin (`derevyov@gmail.com`)**:
   - Verified JWT email `derevyov@gmail.com` (`email_verified == true`).
   - Full authority: can grant `editor` or `admin`, change roles, ban/unban ANY editor or admin, and **permanently delete** any `/userRoles/{targetUid}` record or `/accessRequests/{requestId}`.
   - Cannot be banned or deleted by any delegated admin.
2. **Delegated Admin (`userRoles/{uid}.role == 'admin' && status == 'active'`)**:
   - Can approve/reject `/accessRequests` and grant `editor` or `admin` (`grantedByUid == request.auth.uid`, immutable once set).
   - **Lineage-restricted banning**: Can ban/unban any `editor` OR an `admin` **whom they themselves added** (`existing().grantedByUid == request.auth.uid`).
   - Strictly forbidden from banning admins added by Super Admin or another admin, strictly forbidden from mutating `grantedByUid`, and strictly forbidden from deleting `/userRoles` documents.
3. **Editor (`userRoles/{uid}.role == 'editor' && status == 'active'`)**:
   - Can create/update/delete their own map edits (`/transfers`, `/overrides`, `/manualPoints`) and append to `/assignmentHistory`.
   - Cannot grant roles, approve requests, ban users, or read `/auditEvents`.
4. **Viewer (signed-in without active editor/admin role) & Banned (`status == 'banned'`)**:
   - Read-only access to public map collections + private `/userPrefs/{uid}`.
   - Non-banned viewers can submit a `pending` `/accessRequests/{reqId}` for `editor` or `admin` rights.
   - Banned users are immediately locked out of all map writes and new access requests.

## 2. Data Invariants
1. **Default Deny**: Any unmatched path is denied.
2. **PII Isolation**: `/userPrefs/{userId}` is strictly owner-only (`list` denied). `/userRoles` and `/accessRequests` store display names and optional public Telegram handles only (no private email/phone PII).
3. **Identity & Temporal Integrity**: Every write requires verified auth (`email_verified == true`), matching `authorUid`/`requesterUid`/`actorUid == request.auth.uid`, `createdAt == request.time` on create (immutable on update), and `updatedAt == request.time`.
4. **Geographic & Volumetric Bounding**: Coordinates bounded to Pivdennoukrainsk (`lat: 47.70..47.95`, `lng: 31.00..31.35`), bounded strings and arrays (`houses.size() <= 50`).
5. **Append-Only Audit & Terminal Locking**: `/assignmentHistory` and `/auditEvents` forbid `update`; `/accessRequests` only transitions from `pending` -> `approved` | `rejected` once.
