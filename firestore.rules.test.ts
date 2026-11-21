/**
 * Phase 0 Adversarial & Authorized Rules Unit Test Specification
 * Target: firestore.rules for S.G.N Committee Noori Jama Masjid & Madarsa Anwarool Uloom
 *
 * Run against Firebase Local Emulator Suite when testing locally:
 *   firebase emulators:exec --only firestore "npx tsx firestore.rules.test.ts"
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  actor: 'anonymous' | 'member' | 'unverified_admin' | 'admin_main' | 'admin_secondary';
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  expected: 'ALLOW' | 'DENY';
  rationale: string;
}

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Deny unauthenticated read of transactions',
    actor: 'anonymous',
    operation: 'get',
    path: '/transactions/txn_demo_1',
    expected: 'DENY',
    rationale: 'Financial ledgers require verified authenticated committee access.',
  },
  {
    id: 2,
    name: 'Deny member self-elevation to admin_main on profile creation',
    actor: 'member',
    operation: 'create',
    path: '/users/member_uid_1',
    expected: 'DENY',
    rationale: 'Users creating /users/{uid} must strictly assign role == "member".',
  },
  {
    id: 3,
    name: 'Deny shadow role mutation on user profile update',
    actor: 'member',
    operation: 'update',
    path: '/users/member_uid_1',
    expected: 'DENY',
    rationale: 'Update affectedKeys only permits displayName and updatedAt; role is immutable.',
  },
  {
    id: 4,
    name: 'Deny unverified email admin spoofing',
    actor: 'unverified_admin',
    operation: 'create',
    path: '/funds/fund_masjid',
    expected: 'DENY',
    rationale: 'isPrimaryAdmin() requires request.auth.token.email_verified == true.',
  },
  {
    id: 5,
    name: 'Deny read-only member writing financial transaction',
    actor: 'member',
    operation: 'create',
    path: '/transactions/txn_forged',
    expected: 'DENY',
    rationale: 'Committee members have strict read-only access to all financial ledgers.',
  },
  {
    id: 6,
    name: 'Deny creator self-approval of >₹5,000 expense',
    actor: 'admin_main',
    operation: 'update',
    path: '/approvals/app_created_by_main',
    expected: 'DENY',
    rationale: 'existing().createdByUid != request.auth.uid blocks self-approval.',
  },
  {
    id: 7,
    name: 'Deny mutating finalized approval status (terminal state lock)',
    actor: 'admin_secondary',
    operation: 'update',
    path: '/approvals/app_already_approved',
    expected: 'DENY',
    rationale: 'Once status != "pending", approval record is permanently locked.',
  },
  {
    id: 8,
    name: 'Deny updating or deleting immutable audit_logs even by Primary Admin',
    actor: 'admin_main',
    operation: 'delete',
    path: '/audit_logs/log_1',
    expected: 'DENY',
    rationale: 'Audit logs are strictly append-only (allow update, delete: if false).',
  },
  {
    id: 9,
    name: 'Deny regular member listing all user PII profiles',
    actor: 'member',
    operation: 'list',
    path: '/users',
    expected: 'DENY',
    rationale: 'PII isolation prohibits blanket listing of /users by non-admins.',
  },
  {
    id: 10,
    name: 'Deny negative or zero financial transaction amount',
    actor: 'admin_main',
    operation: 'create',
    path: '/transactions/txn_neg',
    expected: 'DENY',
    rationale: 'isValidTransaction enforces amount > 0 && amount <= 100000000.',
  },
  {
    id: 11,
    name: 'Deny oversized notification string payload (Storage DoS)',
    actor: 'admin_main',
    operation: 'create',
    path: '/notifications/notif_dos',
    expected: 'DENY',
    rationale: 'isValidNotification enforces message.size() <= 1000.',
  },
  {
    id: 12,
    name: 'Deny secondary admin unlocking a locked monthly closing',
    actor: 'admin_secondary',
    operation: 'update',
    path: '/monthly_closings/2026-01',
    expected: 'DENY',
    rationale: 'Reopening a locked month requires Primary Admin and a valid reopenReason.',
  },
];

export const AUTHORIZED_TESTS: SecurityTestCase[] = [
  {
    id: 101,
    name: 'Allow verified member read-only access to fund ledgers',
    actor: 'member',
    operation: 'get',
    path: '/funds/fund_masjid',
    expected: 'ALLOW',
    rationale: 'All verified committee members have full transparency read access.',
  },
  {
    id: 102,
    name: 'Allow secondary admin to approve pending request created by primary admin',
    actor: 'admin_secondary',
    operation: 'update',
    path: '/approvals/app_created_by_main',
    expected: 'ALLOW',
    rationale: 'Distinct authorized admin deciding a pending approval satisfies dual-control.',
  },
  {
    id: 103,
    name: 'Allow primary admin to append immutable audit log entry',
    actor: 'admin_main',
    operation: 'create',
    path: '/audit_logs/log_new',
    expected: 'ALLOW',
    rationale: 'Admins may append schema-validated audit records.',
  },
];
