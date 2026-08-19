# VAMS Backend & Android - Summary of New Changes & Functional Verifications

All of the following features and bug fixes have been successfully implemented. They compile, build, and work correctly.

---

## 1. Database Schema Synchronization
* **`BREACHED` Status**: Added the new status value `BREACHED` to the `AlertStatus` enum in `prisma/schema.prisma`.
* **`UserDeviceToken` Model**: Added a dedicated `UserDeviceToken` model to store multiple device push tokens per user.
* **Database Migration**: Executed `npx prisma db push` to push the schema alterations to the Neon PostgreSQL database and regenerate the Prisma Client.

---

## 2. Webhook Ingestion & Duplicate Prevention
* **Anti-Duplication Guard**: 
  When a new alert event is received (`POST /alerts/event`), the system checks for any unresolved active alert (`status` is `OPEN`, `REOPENED`, or `IN_PROGRESS`) containing the exact same `vin` and `defectName` under that company.
  * **Behavior**: If found, it returns the existing alert instead of creating a duplicate.
* **Notification Isolation on Creation**:
  * **Assigned to User**: If the alert is directed to a specific named user, only that user receives a notification.
  * **Assigned to Role**: If the alert is directed to a role generally, all active users of that specific role are notified. No other roles receive notifications, toasts, or badge counts.

---

## 3. Concurrency-Safe Takeover
* **Atomic Transaction Execution**: 
  Takeover actions (`POST /alerts/:id/takeover`) are wrapped inside a database `prisma.$transaction`.
* **Optimistic Status Guard**: 
  Uses a conditional update checking `status: { in: [OPEN, REOPENED] }`. 
  * **Race Winner**: The first user to click successfully updates status to `IN_PROGRESS` and sets themselves as `assignedToUserId`.
  * **Race Loser**: Any simultaneous click returns a clean response indicating the alert was already claimed (e.g. `{ success: false, alreadyTaken: true, alreadyTakenBy: name }`) rather than causing a database error.
* **Timing Termination**: 
  Taking over an alert halts all active escalation timers by setting `nextEscalationAt = null`.

---

## 4. Role Isolation for Admin Dashboards
* **Operational Dashboard Scoping**:
  Admin users (`SUPER_ADMIN` and `COMPANY_ADMIN`) logging into the operational `VAMS System` dashboard are subject to the same strict role isolation as other users. They only see alerts and stats assigned directly to their own role or user account.
* **Universal Dashboard Exception**:
  Universal configuration monitoring dashboards can bypass this role isolation by passing the `allVisible=true` query parameter, ensuring all company telemetry is queryable.

---

## 5. Permissions & Reassignment Safeguards
* **Peer-to-Peer Reassignment**: 
  Non-admin users can only reassign alerts to peer users *holding the same role*. They must be the current holder of the alert to do so. This is logged in the timeline as `REASSIGNED_SAME_ROLE`.
* **Admin Manual Overrides**: 
  Cross-role manual reassignments are restricted to admin users and are logged in the timeline as `REASSIGNED_MANUAL_ADMIN`.
* **Resolution Restrictions**: 
  Only the assigned user (holder) or a member of the assigned role (if unclaimed) can resolve the alert.
* **Reopen Restrictions**: 
  Only the user who resolved the alert or a member of the same role can reopen it.
* **Step Preservation on Reopening**: 
  Reopening a resolved alert keeps the `escalationStep` value intact, ensuring the escalation chain does not restart from the beginning.

---

## 6. Escalation Chain & Breaching Engine
* **Configured Chain Tracking**:
  Escalation follows the ordered role list defined in the alert definition's `escalationChain` array. Handled roles formatted as `"ROLE:ROLE_NAME"`, `"ROLE_NAME"` (by enum validation), or specific user IDs.
* **DefaultSeverityChain Fallback**:
  If no custom chain is configured, it falls back to the database-configured `EscalationRule` table rules for that severity.
* **Target Unresolvability Breach**:
  If a custom chain target cannot be resolved (e.g. invalid name or deleted role), the alert is marked `BREACHED` and the timeline logs the error `SYSTEM BREACH: Escalation target could not be resolved`.
* **Missing Config Breach**:
  If no default severity rules exist for that severity, the alert transitions to `BREACHED` with the timeline log: `SYSTEM BREACH: No DefaultSeverityChain configured for this severity`.
* **Hardcoded Falls Removal**:
  All hardcoded upward default escalation steps to the leftover `"superadmin"` / `SUPER_ADMIN` role have been disabled.
* **Periodic Job Filter**:
  Excluded `BREACHED` status alerts from the periodic check query to prevent processing them repeatedly.

---

## 7. Multi-Device Push Notifications (FCM)
* **Device Token Storage**: 
  Stores multiple push tokens per user (`UserDeviceToken` model). When updating/registering tokens, they are added to this model dynamically.
* **FCM Push Fan-Out**: 
  Updated the background BullMQ `sendPush` task in `NotificationsProcessor` to fetch all active tokens associated with the target user and dispatch high-priority data-only messages to all devices simultaneously.
* **Stale Token Cleanup**: 
  If FCM returns a `NotRegistered` error for a specific token, it is automatically removed from the database to keep storage clean.
* **Logout Deactivation**: 
  Implemented a new `POST /auth/logout` API. The Android client app fetches its current FCM token and calls this API upon explicit logout to remove that device's token, preventing push leakage after sign-out.

---

## 8. Android Session Persistence
* **Keystore Corruption Guard**: 
  Separated the fallback preferences filename (`"vams_preferences_standard"`) from the primary encrypted preferences filename (`"vams_preferences"`).
* **Decryption Error Recovery**: 
  Implemented robust keystore exception handling in `VamsPrefs.init`. If `EncryptedSharedPreferences.create` fails (which can happen when background notifications start while the device is locked/backgrounded), the code cleans the KeyStore entry and recreation is attempted cleanly, falling back to a separate standard preferences file only as a last resort. This guarantees that your session data remains fully intact across force-quits and restarts.

---

## 9. Company Login & Human-Readable Code Pre-filling
* **Company Code Display**:
  Updated the `CompanyLoginScreen` in the Android app to pre-fill the `COMPANY CODE / ID` field using `VamsPrefs.getCompanyName()`. This ensures the user is presented with their human-readable company name/code (e.g. `Tata`) instead of a confusing raw database UUID string.
* **Registration Code Pre-filling**:
  Updated the navigation to the User Registration screen in `MainActivity.kt` to pre-fill the company ID input with the company name rather than the UUID, preventing raw UUIDs from appearing anywhere in the user flows.

---

## 10. Read-Only GET Endpoint Safety
* **Idempotent `/companies/:id`**:
  Modified `findOne` in `CompaniesService` (NestJS core backend) to throw a `404 NotFoundException('Company not found')` instead of auto-creating a new company record if the queried name/ID doesn't exist. This prevents GET queries from spawning dummy/corrupt records in the database.

---

## 11. Multi-Tenant User Isolation & Client Checks
* **Extended User Model**:
  Added optional `companyCode` and `companyName` fields to the client-side `User` model (`Models.kt`) to capture tenant information returned by the `/auth/login` payload.
* **Robust Client-Side Verification**:
  Updated the company isolation logic in `LoginViewModel.kt` to verify that the logged-in user's `companyId` matches the validated company UUID, OR that their returned `companyCode`/`companyName` matches the validated company name/code case-insensitively, securing the application's multi-tenant isolation boundaries.

---

## 12. VAMS Admin Dashboard: Tenant Login & Data Isolation
* **Dynamic Login Support**:
  Verified the web login page of the Admin Dashboard. Tenant Portal login dynamically accepts Company Code, Email, and Password.
* **Strict Tenant Scoping**:
  Confirmed that all dashboard queries (alerts list, analytics, defect configurations, settings, and broadcasts) automatically filter by the user's `companyId` extracted from the JWT token, preventing access to other companies' data.
* **Admin Visibility**:
  Modified `alerts.service.ts` inside `vams-admin-backend` to include `COMPANY_ADMIN` role users in the users and performance list, allowing tenant admins to monitor and list administrative users alongside standard workers.

---

## 13. Database Clean State
* **Truncated Tables**:
  Cleared all database tables (companies, users, alerts, etc.) using a script, leaving a clean environment ready for fresh multi-tenant registrations.
