/**
 * End-to-End Automated Verification Suite (Requirement L)
 * Tests every backend rule, DB trigger, permission boundary, accounting invariant,
 * ₹5,000 approval workflow, partial payments, fund transfers, salaries, monthly closing,
 * immutable audit logs, 5th-of-month scheduled reminders, reports, and SSE live sync.
 */
import Database from 'better-sqlite3';
import path from 'path';

const BASE = 'http://localhost:3000';
const DB_PATH = path.resolve(process.cwd(), 'data', 'sgn_committee.db');

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: TestResult[] = [];

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function test(name: string, fn: () => Promise<string | void>) {
  try {
    const detail = (await fn()) || 'OK';
    results.push({ name, passed: true, detail });
    console.log(`PASS | ${name} — ${detail}`);
  } catch (err: any) {
    results.push({ name, passed: false, detail: err?.message || String(err) });
    console.error(`FAIL | ${name} — ${err?.message || String(err)}`);
  }
}

async function api<T = any>(
  endpoint: string,
  options: { method?: string; token?: string; body?: any } = {}
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const res = await fetch(`${BASE}${endpoint}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

async function login(memberId: string, password: string, loginType: 'admin' | 'member') {
  const res = await api<{ token: string; user: any; error?: string }>('/api/auth/login', {
    method: 'POST',
    body: { memberId, password, loginType },
  });
  assert(res.status === 200 && res.data.token, `Login failed for ${memberId}: ${JSON.stringify(res.data)}`);
  return res.data;
}

async function run() {
  console.log('===================================================================');
  console.log('S.G.N COMMITTEE SYSTEM — AUTOMATED END-TO-END VERIFICATION SUITE');
  console.log('===================================================================');

  const db = new Database(DB_PATH);

  let primaryToken = '';
  let secondaryToken = '';
  let memberToken = '';

  // 1. Database Schema & Single Physical Bank + 10 Virtual Funds
  await test('1. Schema: All 14 canonical tables + single physical bank + 10 virtual funds', async () => {
    const tables = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>
    ).map((r) => r.name);

    const required = [
      'users',
      'members',
      'contributions',
      'funds',
      'transactions',
      'salaries',
      'approvals',
      'audit_logs',
      'monthly_closings',
      'bank_accounts',
      'payment_submissions',
      'notifications',
      'committee_members',
      'app_settings',
      'double_entry_lines',
    ];
    for (const tbl of required) {
      assert(tables.includes(tbl), `Missing required table: ${tbl}`);
    }

    const bankCount = (db.prepare(`SELECT COUNT(*) as c FROM bank_accounts`).get() as { c: number }).c;
    const fundCount = (db.prepare(`SELECT COUNT(*) as c FROM funds`).get() as { c: number }).c;
    assert(bankCount === 1, `Expected exactly 1 physical bank account, found ${bankCount}`);
    assert(fundCount === 10, `Expected 10 virtual funds, found ${fundCount}`);
    return `15 tables present, 1 physical bank, 10 virtual funds`;
  });

  // 2. Member ID + Password Auth, Bcrypt Hashing & Password Change
  await test('2. Auth: Member ID + Password login, bcrypt hashing (no plain-text), password change', async () => {
    const p = await login('ADMIN-01', 'Admin@123', 'admin');
    const s = await login('ADMIN-02', 'Admin@123', 'admin');
    const m = await login('M001', 'Member@123', 'member');
    primaryToken = p.token;
    secondaryToken = s.token;
    memberToken = m.token;

    assert(p.user.role === 'admin_main', 'ADMIN-01 must be admin_main');
    assert(s.user.role === 'admin_secondary', 'ADMIN-02 must be admin_secondary');
    assert(m.user.role === 'member', 'M001 must be member');

    // Wrong password rejected
    const bad = await api('/api/auth/login', {
      method: 'POST',
      body: { memberId: 'ADMIN-01', password: 'WrongPassword', loginType: 'admin' },
    });
    assert(bad.status === 401, `Expected 401 on wrong password, got ${bad.status}`);

    // Verify bcrypt hashes in DB (never plain-text)
    const users = db.prepare(`SELECT username, password_hash FROM users`).all() as Array<any>;
    for (const u of users) {
      assert(
        u.password_hash.startsWith('$2a$') || u.password_hash.startsWith('$2b$'),
        `User ${u.username} does not have a bcrypt hash`
      );
      assert(
        !u.password_hash.includes('Admin@123') && !u.password_hash.includes('Member@123'),
        `Plain-text password leak detected for ${u.username}`
      );
    }

    // Change password and restore
    const ch1 = await api('/api/auth/change-password', {
      method: 'POST',
      token: memberToken,
      body: { currentPassword: 'Member@123', newPassword: 'NewMember@999' },
    });
    assert(ch1.status === 200, 'Password change failed');
    const relogin = await login('M001', 'NewMember@999', 'member');
    memberToken = relogin.token;
    const ch2 = await api('/api/auth/change-password', {
      method: 'POST',
      token: memberToken,
      body: { currentPassword: 'NewMember@999', newPassword: 'Member@123' },
    });
    assert(ch2.status === 200, 'Password restore failed');
    return `${users.length} users verified bcrypt-hashed; login & password rotation passed`;
  });

  // 3. Role Permissions & Strict Max 2 Admins DB Trigger
  await test('3. RBAC: Member read-only (403 on writes) + DB trigger blocks 3rd admin', async () => {
    const readDash = await api('/api/dashboard', { token: memberToken });
    const readRep = await api('/api/reports', { token: memberToken });
    assert(readDash.status === 200 && readRep.status === 200, 'Member read endpoints must return 200');

    const writeChecks = [
      api('/api/members', { method: 'POST', token: memberToken, body: { fullName: 'Hack', phone: '999', village: 'X' } }),
      api('/api/transactions', {
        method: 'POST',
        token: memberToken,
        body: { type: 'expense', fundId: 'masjid_general', category: 'Other Expenses', partyName: 'X', amount: 100 },
      }),
      api('/api/settings', { method: 'PUT', token: memberToken, body: { dualApprovalLimit: 999999 } }),
      api('/api/closings/close', { method: 'POST', token: memberToken, body: { monthKey: '2026-01' } }),
      api('/api/scheduler/run-reminders', { method: 'POST', token: memberToken, body: {} }),
    ];
    const responses = await Promise.all(writeChecks);
    for (const r of responses) {
      assert(r.status === 403, `Member write must be 403, got ${r.status}`);
    }

    // Attempt inserting a 3rd admin directly into SQLite
    let triggerFired = false;
    try {
      db.prepare(
        `INSERT INTO users (id, username, password_hash, full_name, role, phone, is_active, created_at)
         VALUES ('usr_bad_admin', 'ADMIN-03', '$2a$08$fakehashvalue', 'Third Admin', 'admin_secondary', '000', 1, ?)`
      ).run(new Date().toISOString());
    } catch (e: any) {
      if (String(e?.message || '').includes('Maximum of two authorized administrators')) {
        triggerFired = true;
      }
    }
    assert(triggerFired, 'trg_max_two_admins trigger did not block 3rd administrator');
    return `5 member write endpoints blocked (403); 3rd admin blocked by SQLite trigger`;
  });

  // 4. Individual Monthly Amounts, Automatic Dues & Duplicate Prevention
  let testMemberId = '';
  let testMemberCode = '';
  let testPendingMonth = '';
  await test('4. Contributions: Individual ₹750 amount, auto dues generation, 0 duplicates on repeat', async () => {
    const now = new Date();
    const joinDate = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
    const created = await api<{ id: string; memberCode: string }>('/api/members', {
      method: 'POST',
      token: primaryToken,
      body: {
        fullName: 'Test Verification Member',
        phone: '+91 90000 12345',
        village: 'Ragdih Test Mohalla',
        monthlyAmount: 750,
        joiningDate: joinDate,
      },
    });
    assert(created.status === 201 && created.data.id, 'Failed to create custom-amount test member');
    testMemberId = created.data.id;
    testMemberCode = created.data.memberCode;

    const memRes = await api<{ members: any[] }>('/api/members', { token: primaryToken });
    const tm = memRes.data.members.find((m) => m.id === testMemberId);
    assert(tm && tm.monthlyAmount === 750, 'Custom monthly amount ₹750 not saved');
    assert(tm.pendingMonths.length >= 2, `Expected at least 2 auto-generated dues, got ${tm.pendingMonths.length}`);
    testPendingMonth = tm.pendingMonths[0];

    // Run generator again — must produce 0 duplicates!
    const dupRun = await api<{ generatedCount: number }>('/api/contributions/generate', {
      method: 'POST',
      token: primaryToken,
      body: {},
    });
    assert(dupRun.status === 200 && dupRun.data.generatedCount === 0, `Expected 0 duplicates, got ${dupRun.data.generatedCount}`);
    return `Created ${testMemberCode} (₹750/mo), ${tm.pendingMonths.length} dues generated, repeat run generated 0 duplicates`;
  });

  // 5. Partial Payment -> Full Payment Lifecycle
  await test('5. Partial Payments: ₹300 of ₹750 -> partial (rem ₹450) -> +₹450 -> paid (rem ₹0)', async () => {
    const p1 = await api('/api/members/' + testMemberId + '/contributions', {
      method: 'POST',
      token: primaryToken,
      body: {
        monthPayments: [{ monthKey: testPendingMonth, amount: 300 }],
        paymentMethod: 'Cash',
        fundId: 'masjid_general',
        notes: 'Partial installment 1',
      },
    });
    assert(p1.status === 201, `Partial payment 1 failed: ${JSON.stringify(p1.data)}`);

    let memRes = await api<{ members: any[] }>('/api/members', { token: primaryToken });
    let tm = memRes.data.members.find((m) => m.id === testMemberId);
    let mh = tm.monthHistory.find((x: any) => x.monthKey === testPendingMonth);
    assert(mh.status === 'partial' && mh.paid === 300 && mh.remaining === 450, `Expected partial 300/750, got ${JSON.stringify(mh)}`);

    const p2 = await api('/api/members/' + testMemberId + '/contributions', {
      method: 'POST',
      token: primaryToken,
      body: {
        monthPayments: [{ monthKey: testPendingMonth, amount: 450 }],
        paymentMethod: 'UPI',
        fundId: 'masjid_general',
        notes: 'Partial installment 2 (completion)',
      },
    });
    assert(p2.status === 201, `Partial payment 2 failed: ${JSON.stringify(p2.data)}`);

    memRes = await api<{ members: any[] }>('/api/members', { token: primaryToken });
    tm = memRes.data.members.find((m) => m.id === testMemberId);
    mh = tm.monthHistory.find((x: any) => x.monthKey === testPendingMonth);
    assert(mh.status === 'paid' && mh.paid === 750 && mh.remaining === 0, `Expected paid 750/750, got ${JSON.stringify(mh)}`);
    return `${testPendingMonth}: ₹300 partial (₹450 due) -> +₹450 paid in full`;
  });

  // 6. Double-Entry Trial Balance & Single Bank + Cash vs 10 Virtual Funds Reconciliation
  await test('6. Accounting Engine: Double-entry balanced (Dr === Cr) & Bank+Cash === 10 Virtual Funds', async () => {
    const rec = await api<{ reconciliation: any }>('/api/accounting/reconciliation', { token: primaryToken });
    assert(rec.status === 200, 'Reconciliation endpoint failed');
    const r = rec.data.reconciliation;
    assert(r.isBalanced && r.totalDebits === r.totalCredits, `Trial balance mismatch: Dr ${r.totalDebits} vs Cr ${r.totalCredits}`);
    assert(r.isReconciled && r.totalLiquidAssets === r.sumOfVirtualFunds, `Liquid assets ${r.totalLiquidAssets} !== Virtual funds ${r.sumOfVirtualFunds}`);
    return `Dr ₹${r.totalDebits} = Cr ₹${r.totalCredits}; Bank(₹${r.physicalBankBalance}) + Cash(₹${r.cashBalance}) = Funds(₹${r.sumOfVirtualFunds})`;
  });

  // 7. Internal Virtual Fund Transfer (Not Counted as New Income)
  await test('7. Fund Transfer: Internal transfer moves virtual balances without inflating income or bank+cash', async () => {
    const before = await api<{ funds: any[]; reconciliation: any }>('/api/funds', { token: primaryToken });
    const jumaBefore = before.data.funds.find((f) => f.id === 'juma');
    const masjidBefore = before.data.funds.find((f) => f.id === 'masjid_general');
    const liquidBefore = before.data.reconciliation.totalLiquidAssets;

    const tr = await api('/api/transactions', {
      method: 'POST',
      token: primaryToken,
      body: {
        type: 'transfer',
        fundId: 'juma',
        targetFundId: 'masjid_general',
        category: 'Inter-Fund Transfer',
        amount: 1500,
        partyName: 'Committee Resolution #T1',
        paymentMethod: 'Bank',
        description: 'Move Juma surplus to Masjid General virtual ledger',
      },
    });
    assert(tr.status === 201, `Transfer failed: ${JSON.stringify(tr.data)}`);

    const after = await api<{ funds: any[]; reconciliation: any }>('/api/funds', { token: primaryToken });
    const jumaAfter = after.data.funds.find((f) => f.id === 'juma');
    const masjidAfter = after.data.funds.find((f) => f.id === 'masjid_general');

    assert(jumaAfter.currentBalance === jumaBefore.currentBalance - 1500, 'Source fund did not decrease by 1500');
    assert(masjidAfter.currentBalance === masjidBefore.currentBalance + 1500, 'Target fund did not increase by 1500');
    assert(jumaAfter.totalIncome === jumaBefore.totalIncome && masjidAfter.totalIncome === masjidBefore.totalIncome, 'Transfer must not count as new income');
    assert(after.data.reconciliation.totalLiquidAssets === liquidBefore, 'Internal transfer must not change physical bank+cash');
    assert(after.data.reconciliation.isBalanced && after.data.reconciliation.isReconciled, 'Reconciliation broken after transfer');
    return `₹1,500 moved Juma -> Masjid; totalIncome & Bank+Cash unchanged; balanced & reconciled`;
  });

  // 8. ₹5,000 Dual-Admin Approval Limit & Creator Self-Approval Block
  let smallExpenseId = '';
  await test('8. Approval Workflow: ₹4,000 auto-approved; ₹6,500 pending; creator blocked (403); 2nd admin approves', async () => {
    const fundsBefore = (await api<{ funds: any[] }>('/api/funds', { token: primaryToken })).data.funds;
    const masjidBal0 = fundsBefore.find((f) => f.id === 'masjid_general').currentBalance;

    // 8a. ₹4,000 expense (<= ₹5,000) -> auto approved
    const small = await api<{ id: string; status: string; needsDualApproval: boolean }>('/api/transactions', {
      method: 'POST',
      token: primaryToken,
      body: {
        type: 'expense',
        fundId: 'masjid_general',
        category: 'Repairs & Maintenance',
        amount: 4000,
        partyName: 'Ragdih Hardware',
        paymentMethod: 'Cash',
        description: 'Under ₹5,000 routine repair',
      },
    });
    assert(small.status === 201 && small.data.status === 'approved' && !small.data.needsDualApproval, '₹4,000 expense should auto-approve');
    smallExpenseId = small.data.id;

    const masjidBal1 = (await api<{ funds: any[] }>('/api/funds', { token: primaryToken })).data.funds.find((f) => f.id === 'masjid_general').currentBalance;
    assert(masjidBal1 === masjidBal0 - 4000, 'Auto-approved ₹4,000 expense did not deduct from Masjid balance');

    // 8b. ₹6,500 expense (> ₹5,000) -> pending_approval, balance unchanged!
    const large = await api<{ id: string; status: string; needsDualApproval: boolean }>('/api/transactions', {
      method: 'POST',
      token: primaryToken,
      body: {
        type: 'expense',
        fundId: 'masjid_general',
        category: 'Construction Expenses',
        amount: 6500,
        partyName: 'Hazaribagh Steel Works',
        paymentMethod: 'Bank',
        description: 'Above ₹5,000 gate welding',
      },
    });
    assert(large.status === 201 && large.data.status === 'pending_approval' && large.data.needsDualApproval, '₹6,500 expense must require dual approval');

    const masjidBalPending = (await api<{ funds: any[] }>('/api/funds', { token: primaryToken })).data.funds.find((f) => f.id === 'masjid_general').currentBalance;
    assert(masjidBalPending === masjidBal1, 'Pending expense must NOT alter fund balance before approval');

    // 8c. Creator (ADMIN-01) attempts self-approval -> 403!
    const selfApprove = await api(`/api/transactions/${large.data.id}/approve`, {
      method: 'POST',
      token: primaryToken,
      body: { decision: 'approve', reason: 'Trying to self approve' },
    });
    assert(selfApprove.status === 403, `Creator self-approval must be 403, got ${selfApprove.status}`);

    // 8d. Secondary Admin (ADMIN-02) approves -> balance updates by -₹6,500!
    const secApprove = await api(`/api/transactions/${large.data.id}/approve`, {
      method: 'POST',
      token: secondaryToken,
      body: { decision: 'approve', reason: 'Verified invoice & work' },
    });
    assert(secApprove.status === 200, `Secondary Admin approval failed: ${JSON.stringify(secApprove.data)}`);

    const masjidBal2 = (await api<{ funds: any[] }>('/api/funds', { token: primaryToken })).data.funds.find((f) => f.id === 'masjid_general').currentBalance;
    assert(masjidBal2 === masjidBal1 - 6500, 'Approved ₹6,500 expense did not deduct from balance');

    // 8e. Rejection flow
    const rejectCandidate = await api<{ id: string }>('/api/transactions', {
      method: 'POST',
      token: primaryToken,
      body: {
        type: 'expense',
        fundId: 'masjid_general',
        category: 'Other Expenses',
        amount: 7200,
        partyName: 'Unverified Vendor',
        paymentMethod: 'Cash',
        description: 'Unapproved test quote',
      },
    });
    const rej = await api(`/api/transactions/${rejectCandidate.data.id}/approve`, {
      method: 'POST',
      token: secondaryToken,
      body: { decision: 'reject', reason: 'Quotation too high' },
    });
    assert(rej.status === 200, 'Rejection failed');
    const masjidBal3 = (await api<{ funds: any[] }>('/api/funds', { token: primaryToken })).data.funds.find((f) => f.id === 'masjid_general').currentBalance;
    assert(masjidBal3 === masjidBal2, 'Rejected expense must NOT change balance');

    return `₹4,000 auto-approved; ₹6,500 self-approval blocked (403) & approved by ADMIN-02; ₹7,200 rejected cleanly`;
  });

  // 9. Salary Calculation & Partial Salary Payment
  await test('9. Salaries: Partial salary payment updates paid, remaining & fund balance accurately', async () => {
    const salBefore = (await api<{ staff: any[] }>('/api/salaries', { token: primaryToken })).data.staff;
    const target = salBefore.find((s) => s.totalPending >= 2000) || salBefore[0];
    assert(target, 'No staff member found');
    const pendingMonth = target.pendingMonths[0] || new Date().toISOString().slice(0, 7);
    const paidBefore = target.totalPaid;
    const pendingBefore = target.totalPending;

    const payRes = await api('/api/salaries/pay', {
      method: 'POST',
      token: primaryToken,
      body: {
        staffId: target.id,
        monthKey: pendingMonth,
        amount: 2000,
        paymentMethod: 'Bank',
        reference: 'TEST-SAL-2000',
      },
    });
    assert(payRes.status === 201, `Salary payment failed: ${JSON.stringify(payRes.data)}`);

    const salAfter = (await api<{ staff: any[] }>('/api/salaries', { token: primaryToken })).data.staff;
    const updated = salAfter.find((s) => s.id === target.id);
    assert(updated.totalPaid === paidBefore + 2000, 'Staff totalPaid did not increase by ₹2,000');
    assert(updated.totalPending === Math.max(0, pendingBefore - 2000), 'Staff totalPending did not decrease by ₹2,000');
    return `${target.name}: paid ₹2,000 for ${pendingMonth}; pending ₹${pendingBefore} -> ₹${updated.totalPending}`;
  });

  // 10. Immutable Audit History & Reversal-Only Accounting
  await test('10. Audit & Reversals: Reversal preserves original & restores balance; audit_logs immutable in DB', async () => {
    const balBefore = (await api<{ funds: any[] }>('/api/funds', { token: primaryToken })).data.funds.find((f) => f.id === 'masjid_general').currentBalance;
    const rev = await api(`/api/transactions/${smallExpenseId}/reverse`, {
      method: 'POST',
      token: primaryToken,
      body: { reason: 'Duplicate hardware invoice — reversing cleanly' },
    });
    assert(rev.status === 200 && rev.data.reversalTxnNumber, `Reversal failed: ${JSON.stringify(rev.data)}`);

    const balAfter = (await api<{ funds: any[] }>('/api/funds', { token: primaryToken })).data.funds.find((f) => f.id === 'masjid_general').currentBalance;
    assert(balAfter === balBefore + 4000, 'Reversal did not restore ₹4,000 to Masjid balance');

    // Original record still exists with status='reversed'
    const orig = db.prepare(`SELECT status FROM transactions WHERE id = ?`).get(smallExpenseId) as any;
    assert(orig && orig.status === 'reversed', 'Original transaction was not preserved with status=reversed');

    // Verify SQLite immutability triggers on audit_logs
    const firstLog = db.prepare(`SELECT id FROM audit_logs LIMIT 1`).get() as { id: string };
    let updateBlocked = false;
    let deleteBlocked = false;
    try {
      db.prepare(`UPDATE audit_logs SET reason = 'tampered' WHERE id = ?`).run(firstLog.id);
    } catch (e: any) {
      if (String(e?.message || '').includes('Audit logs are immutable')) updateBlocked = true;
    }
    try {
      db.prepare(`DELETE FROM audit_logs WHERE id = ?`).run(firstLog.id);
    } catch (e: any) {
      if (String(e?.message || '').includes('Audit logs are immutable')) deleteBlocked = true;
    }
    assert(updateBlocked && deleteBlocked, 'audit_logs immutability triggers did not block UPDATE/DELETE');

    const rec = (await api<{ reconciliation: any }>('/api/accounting/reconciliation', { token: primaryToken })).data.reconciliation;
    assert(rec.isBalanced && rec.isReconciled, 'Double-entry reconciliation drifted after reversal');
    return `Original preserved, reversal ${rev.data.reversalTxnNumber} restored ₹4,000; UPDATE/DELETE on audit_logs blocked by DB triggers`;
  });

  // 11. Monthly Closing Lock & Primary-Admin-Only Reopen
  await test('11. Monthly Closing: Locked month blocks new txns (423); Secondary Admin blocked (403); Primary Admin reopens', async () => {
    const closeMonth = '2025-12';
    const cl = await api('/api/closings/close', {
      method: 'POST',
      token: primaryToken,
      body: { monthKey: closeMonth },
    });
    assert(cl.status === 200, `Closing failed: ${JSON.stringify(cl.data)}`);

    const blockedTxn = await api('/api/transactions', {
      method: 'POST',
      token: primaryToken,
      body: {
        date: `${closeMonth}-15`,
        type: 'income',
        fundId: 'masjid_general',
        category: 'General Donations',
        amount: 500,
        partyName: 'Late Entry Test',
        paymentMethod: 'Cash',
      },
    });
    assert(blockedTxn.status === 423, `Expected 423 Locked on closed month, got ${blockedTxn.status}`);

    const secReopen = await api('/api/closings/reopen', {
      method: 'POST',
      token: secondaryToken,
      body: { monthKey: closeMonth, reason: 'Secondary admin attempting reopen' },
    });
    assert(secReopen.status === 403, `Secondary Admin reopen must be 403, got ${secReopen.status}`);

    const priReopen = await api('/api/closings/reopen', {
      method: 'POST',
      token: primaryToken,
      body: { monthKey: closeMonth, reason: 'Primary Admin verified year-end audit adjustment' },
    });
    assert(priReopen.status === 200, `Primary Admin reopen failed: ${JSON.stringify(priReopen.data)}`);
    return `${closeMonth} locked (423 enforced), ADMIN-02 reopen blocked (403), ADMIN-01 reopened with audit log`;
  });

  // 12. 5th-of-Month Automatic Scheduled Reminders & Duplicate Prevention
  await test('12. Automatic 5th-of-Month Reminders: Sends unpaid alerts & blocks duplicate reminders in same month', async () => {
    const simDate = '2026-12-05T09:00:00.000Z';
    const run1 = await api<{ ok: boolean; result: any }>('/api/scheduler/run-reminders', {
      method: 'POST',
      token: primaryToken,
      body: { simulatedDate: simDate },
    });
    assert(run1.status === 200 && run1.data.ok, 'Scheduler run 1 failed');
    assert(run1.data.result.remindersSent > 0, `Expected >0 reminders on 5th, got ${JSON.stringify(run1.data.result)}`);

    const run2 = await api<{ ok: boolean; result: any }>('/api/scheduler/run-reminders', {
      method: 'POST',
      token: primaryToken,
      body: { simulatedDate: simDate },
    });
    assert(run2.status === 200 && run2.data.result.remindersSent === 0, `Expected 0 duplicate reminders on repeat run, got ${run2.data.result.remindersSent}`);
    assert(run2.data.result.skippedAlreadyReminded >= run1.data.result.remindersSent, 'Duplicate skip counter mismatch');
    return `Run 1 sent ${run1.data.result.remindersSent} unpaid reminders; Run 2 sent 0 (skipped ${run2.data.result.skippedAlreadyReminded} duplicates)`;
  });

  // 13. Reports (Monthly/Quarterly/Yearly) & Live SSE Sync
  await test('13. Reports & Live Sync: Monthly/Quarterly/Yearly reports + real-time SSE stream', async () => {
    for (const pt of ['monthly', 'quarterly', 'yearly']) {
      const rep = await api<{ report: any }>(`/api/reports?periodType=${pt}&year=2026`, { token: memberToken });
      assert(rep.status === 200 && rep.data.report.fundBalances.length === 10, `${pt} report invalid`);
    }

    const controller = new AbortController();
    const sseRes = await fetch(`${BASE}/api/events?token=${encodeURIComponent(memberToken)}`, {
      signal: controller.signal,
    });
    assert(sseRes.status === 200, `SSE failed with ${sseRes.status}`);
    const reader = sseRes.body!.getReader();
    const { value } = await reader.read();
    const chunk = new TextDecoder().decode(value);
    controller.abort();
    assert(chunk.includes('"eventType":"connected"'), `Unexpected SSE handshake: ${chunk}`);
    return `Monthly/Quarterly/Yearly reports verified (10 funds each); SSE live stream connected`;
  });

  // 14. Clean Reset back to pristine DEMO state for live user preview
  await test('14. Restore Clean Demo State for Live Application Preview', async () => {
    const reset = await api('/api/admin/data-mode', {
      method: 'POST',
      token: primaryToken,
      body: { mode: 'reset_demo' },
    });
    assert(reset.status === 200, `Demo restore failed: ${JSON.stringify(reset.data)}`);
    const newPrimary = await login('ADMIN-01', 'Admin@123', 'admin');
    const rec = (await api<{ reconciliation: any }>('/api/accounting/reconciliation', { token: newPrimary.token })).data.reconciliation;
    assert(rec.isBalanced && rec.isReconciled, 'Restored demo state is not balanced/reconciled');
    return `Clean demo state restored; Dr ₹${rec.totalDebits} = Cr ₹${rec.totalCredits}; Bank+Cash = 10 Virtual Funds (₹${rec.sumOfVirtualFunds})`;
  });

  db.close();

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log('===================================================================');
  console.log(`VERIFICATION SUMMARY: ${passed}/${results.length} PASSED, ${failed} FAILED`);
  console.log('===================================================================');
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
