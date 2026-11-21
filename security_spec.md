# Security Specification — S.G.N Committee Noori Jama Masjid & Madarsa Anwarool Uloom

## 1. Data Invariants

1. **Default-Deny Catch-All**: Every path not explicitly matched is denied (`allow read, write: if false;` as the first rule block).
2. **Verified Authentication Gate**: All reads and writes require a signed-in user with a verified email (`request.auth != null && request.auth.token.email_verified == true`).
3. **Strict Two-Admin Governance**:
   - Primary Admin bootstrapped by verified email `izharahmad46@gmail.com`.
   - Secondary Admin explicitly registered in `/admins/{uid}` (`slot == 2`, `role == 'admin_secondary'`) ONLY by the Primary Admin.
   - Regular members (`role == 'member'`) have **STRICT READ-ONLY** access to financial ledgers (`funds`, `transactions`, `contributions`, `members`, `salaries`, `approvals`, `audit_logs`, `monthly_closings`, `bank_accounts`, `notifications`, `committee_members`, `app_settings`).
4. **No Self-Privilege Escalation**:
   - Users creating `/users/{userId}` can ONLY create their own profile (`request.auth.uid == userId`) with `role == 'member'`, and can NEVER mutate `role` on update.
   - Users can NEVER write to `/admins/{uid}` unless they are the Primary Admin.
5. **Dual-Admin Approval Workflow (> ₹5,000)**:
   - `/approvals/{approvalId}` creation requires `isAdmin()`, `status == 'pending'`, and `createdByUid == request.auth.uid`.
   - Decision update (`approved` or `rejected`) requires `isAdmin()`, `existing().status == 'pending'` (terminal state lock), `existing().createdByUid != request.auth.uid` (creator CANNOT approve/reject own transaction), and strict `affectedKeys().hasOnly(...)`.
6. **Immutable Financial Audit Trail**:
   - `/audit_logs/{logId}` is strictly append-only (`allow update, delete: if false;`).
7. **Monthly Closing Lock Integrity**:
   - Locked `/monthly_closings/{monthKey}` (`existing().isLocked == true`) cannot be silently unlocked by a secondary admin; reopening requires Primary Admin (`isPrimaryAdmin()`) with a non-empty `reopenReason` (`size() >= 5 && size() <= 400`).
8. **PII Isolation**:
   - `/users/{userId}` restricts `get` to `isOwner(userId) || isPrimaryAdmin()` and blocks blanket `list` by regular users.
   - `/members/{memberId}` stores only `phoneMasked` (never raw private phone numbers).
9. **Payment Submission State Machine**:
   - Verified members may submit their own payment proof (`submittedByUid == request.auth.uid`, `status == 'pending_verification'`), and only Admins can verify/reject it (terminal state lock once `verified` or `rejected`).
10. **Strict Shape, Bounds & Timestamp Integrity**:
    - Every `create` and `update` invokes standalone `isValid[Entity](data)` validators with `.hasAll(...)`, `.hasOnly(...)`, `.size()` bounds on every string, numeric range checks, and `request.time` timestamp enforcement.

---

## 2. The Dirty Dozen — Adversarial Attack Payloads

| # | Attack Vector | Target Path | Exact Exploit Payload / Action | Expected Result |
|---|---|---|---|---|
| 1 | Unauthenticated Ledger Scraping | `/transactions/txn_1` | `get()` with `auth = null` | DENY |
| 2 | Member Self-Elevation on Signup | `/users/uid_m1` | `create({ uid: 'uid_m1', email: 'm1@test.com', displayName: 'M1', role: 'admin_main', createdAt: now, updatedAt: now })` as `uid_m1` | DENY |
| 3 | Shadow Field Injection (Role Escalation on Update) | `/users/uid_m1` | `update({ displayName: 'M1', role: 'admin_secondary', updatedAt: now })` as `uid_m1` | DENY |
| 4 | Unverified Email Admin Spoofing | `/funds/fund_masjid` | `create(...)` with `auth.token.email = 'izharahmad46@gmail.com'` and `auth.token.email_verified = false` | DENY |
| 5 | Read-Only Member Forging Transaction | `/transactions/txn_fake` | `create({ amount: 50000, type: 'expense', ... })` as regular verified member | DENY |
| 6 | Creator Self-Approval of >₹5,000 Expense | `/approvals/app_1` | `update({ status: 'approved', decidedByUid: 'admin1', decidedByName: 'Admin 1', decisionReason: 'ok', updatedAt: now })` where `existing.createdByUid == 'admin1'` | DENY |
| 7 | Terminal State Reversal on Finalized Approval | `/approvals/app_done` | `update({ status: 'rejected', ... })` where `existing.status == 'approved'` | DENY |
| 8 | Audit Log Tampering / Deletion | `/audit_logs/log_1` | `update({ reason: 'erased' })` or `delete()` even as Primary Admin | DENY |
| 9 | PII Blanket Listing of Users | `/users` | `list()` as regular verified member | DENY |
| 10 | Negative / Poisoned Financial Amount | `/transactions/txn_neg` | `create({ amount: -1000, ... })` even as Primary Admin | DENY |
| 11 | Storage DoS Oversized String Payload | `/notifications/notif_dos` | `create({ message: 'A'.repeat(5000), ... })` even as Primary Admin | DENY |
| 12 | Secondary Admin Unlocking Closed Month Without Reason | `/monthly_closings/2026-01` | `update({ isLocked: false, reopenReason: '', updatedAt: now })` as Secondary Admin | DENY |
