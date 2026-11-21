import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  db,
  initSchema,
  seedInitialDemoData,
  generateTxnNumber,
  addAuditLog,
  addNotification,
  postDoubleEntryForTransaction,
  syncContributionsDuesForAllMembers,
  getAppSettings,
  getCurrentMonthKey,
  getTodayISO,
  shiftMonthKey,
  computeFunds,
  computeBankAccounts,
  computeCashBalance,
  computeDoubleEntryTrialBalance,
  computeMembers,
  computeStaffSalaries,
  createDatabaseBackup,
  listBackups,
  SINGLE_BANK_ID,
  UPLOADS_DIR,
  generateReceiptNumber,
} from './server/db.ts';
import { runMonthlyAutomationJob, startMonthlyScheduler } from './server/scheduler.ts';

initSchema();
seedInitialDemoData(false);

const app = express();
app.use(express.json({ limit: '8mb' }));

// ---------- REAL-TIME SSE BROADCAST ----------
const sseClients = new Set<express.Response>();
function broadcastUpdate(eventType: string): void {
  const payload = `data: ${JSON.stringify({ eventType, ts: Date.now() })}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

// Start real 5th-of-month scheduler
startMonthlyScheduler(broadcastUpdate);

// ---------- AUTH MIDDLEWARE ----------
interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  role: 'admin_main' | 'admin_secondary' | 'member';
  memberId: string | null;
  phone: string;
  twoFactorEnabled: boolean;
  isActive: boolean;
  token: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

function getTokenFromRequest(req: express.Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const qToken = typeof req.query.token === 'string' ? req.query.token : null;
  return qToken;
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const token = getTokenFromRequest(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const row = db
    .prepare(
      `SELECT s.token, s.expires_at, u.id, u.username, u.full_name, u.role, u.member_id, u.phone, u.two_factor_enabled, u.is_active
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as any;

  if (!row || !row.is_active) {
    res.status(401).json({ error: 'Invalid or expired session.' });
    return;
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
    res.status(401).json({ error: 'Session expired. Please sign in again.' });
    return;
  }

  req.user = {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    memberId: row.member_id,
    phone: row.phone,
    twoFactorEnabled: Boolean(row.two_factor_enabled),
    isActive: Boolean(row.is_active),
    token: row.token,
  };
  next();
}

function isAdminRole(role?: string): boolean {
  return role === 'admin_main' || role === 'admin_secondary';
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!req.user || !isAdminRole(req.user.role)) {
    res.status(403).json({
      error: 'Forbidden: Members have strictly READ-ONLY access. Only Primary or Secondary Administrators can modify records.',
    });
    return;
  }
  next();
}

function isMonthLocked(monthKey: string): boolean {
  const row = db.prepare(`SELECT is_locked FROM monthly_closings WHERE month_key = ?`).get(monthKey) as
    | { is_locked: number }
    | undefined;
  return Boolean(row && row.is_locked === 1);
}

// ---------- SSE STREAM ----------
app.get('/api/events', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ eventType: 'connected', ts: Date.now() })}\n\n`);
  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
  });
});

// ---------- PUBLIC BRAND INFO ----------
app.get('/api/public/info', (_req, res) => {
  const settings = getAppSettings();
  res.json({
    committeeName: settings.committeeName,
    committeeAddress: settings.committeeAddress,
    isDemoDataActive: settings.isDemoDataActive,
    dualApprovalLimit: settings.dualApprovalLimit,
    reminderDayOfMonth: settings.reminderDayOfMonth,
  });
});

// ---------- AUTHENTICATION (MEMBER ID + PASSWORD) ----------
app.post('/api/auth/login', (req, res) => {
  const { username, memberId, password, loginType, otpCode } = req.body || {};
  const rawId = String(username || memberId || '').trim();
  if (!rawId || !password) {
    res.status(400).json({ error: 'Member ID and password are required.' });
    return;
  }

  // Normalize convenient aliases admin1 -> ADMIN-01, admin2 -> ADMIN-02
  const normalizedId =
    rawId.toLowerCase() === 'admin1'
      ? 'ADMIN-01'
      : rawId.toLowerCase() === 'admin2'
      ? 'ADMIN-02'
      : rawId;

  const user = db
    .prepare(`SELECT * FROM users WHERE LOWER(username) = LOWER(?)`)
    .get(normalizedId) as any;

  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1');
  const ua = String(req.headers['user-agent'] || 'Unknown Device').slice(0, 180);

  if (!user || !user.is_active || !bcrypt.compareSync(String(password), user.password_hash)) {
    db.prepare(
      `INSERT INTO login_activity (id, user_id, username, full_name, role, status, ip, user_agent, timestamp)
       VALUES (?, ?, ?, ?, ?, 'failed', ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      user?.id || null,
      normalizedId,
      user?.full_name || 'Unknown',
      user?.role || 'member',
      ip,
      ua,
      new Date().toISOString()
    );
    res.status(401).json({ error: 'Invalid Member ID or password.' });
    return;
  }

  if (loginType === 'admin' && !isAdminRole(user.role)) {
    res.status(403).json({ error: 'This Member ID belongs to a Read-Only Member. Please use the Member Login tab.' });
    return;
  }
  if (loginType === 'member' && isAdminRole(user.role)) {
    res.status(403).json({ error: 'This ID belongs to an Administrator. Please use the Admin Login tab.' });
    return;
  }
  if (!isAdminRole(user.role) && !getAppSettings().memberLoginEnabled) {
    res.status(403).json({
      error: 'Member portal login is temporarily paused by the Committee Administrator. Please contact Sadar/Secretary.',
    });
    return;
  }

  if (isAdminRole(user.role) && user.two_factor_enabled) {
    if (!otpCode) {
      res.status(200).json({
        requiresTwoFactor: true,
        message: 'Enter your 6-digit Administrator 2FA verification code (Demo OTP: 123456).',
      });
      return;
    }
    if (String(otpCode).trim() !== String(user.two_factor_secret || '123456')) {
      res.status(401).json({ error: 'Invalid 2FA verification code.' });
      return;
    }
  }

  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  db.prepare(
    `INSERT INTO sessions (token, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(token, user.id, now.toISOString(), expires.toISOString(), ip, ua);

  db.prepare(
    `INSERT INTO login_activity (id, user_id, username, full_name, role, status, ip, user_agent, timestamp)
     VALUES (?, ?, ?, ?, ?, 'success', ?, ?, ?)`
  ).run(crypto.randomUUID(), user.id, user.username, user.full_name, user.role, ip, ua, now.toISOString());

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
      memberId: user.member_id,
      phone: user.phone,
      twoFactorEnabled: Boolean(user.two_factor_enabled),
      isActive: Boolean(user.is_active),
    },
  });
});

// ---------- FIREBASE GOOGLE AUTHENTICATION (VERIFIED VIA IDENTITY TOOLKIT) ----------
app.post('/api/auth/firebase-login', async (req, res) => {
  const { idToken } = req.body || {};
  if (!idToken || typeof idToken !== 'string') {
    res.status(400).json({ error: 'Firebase ID token is required.' });
    return;
  }

  let firebaseApiKey = '';
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    firebaseApiKey = String(cfg.apiKey || '');
  } catch {
    res.status(500).json({ error: 'Firebase configuration file not found on server.' });
    return;
  }

  if (!firebaseApiKey) {
    res.status(500).json({ error: 'Firebase API key missing in configuration.' });
    return;
  }

  let verifiedAccount: { localId: string; email?: string; emailVerified?: boolean; displayName?: string } | null = null;
  try {
    const lookupRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseApiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    const lookupJson = (await lookupRes.json()) as any;
    if (!lookupRes.ok || !Array.isArray(lookupJson?.users) || lookupJson.users.length === 0) {
      res.status(401).json({ error: 'Invalid or expired Firebase authentication token.' });
      return;
    }
    verifiedAccount = lookupJson.users[0];
  } catch {
    res.status(502).json({ error: 'Unable to verify Firebase token with Google Authentication servers.' });
    return;
  }

  const email = String(verifiedAccount?.email || '').trim().toLowerCase();
  const emailVerified = Boolean(verifiedAccount?.emailVerified);
  if (!email || !emailVerified) {
    res.status(403).json({ error: 'A verified Google email address is required to access the committee portal.' });
    return;
  }

  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1');
  const ua = String(req.headers['user-agent'] || 'Unknown Device').slice(0, 180);

  // Bootstrapped Primary Admin email maps to Primary Admin account; other verified Google users get Read-Only Member access
  let user: any = null;
  if (email === 'izharahmad46@gmail.com') {
    user = db.prepare(`SELECT * FROM users WHERE role = 'admin_main' AND is_active = 1 LIMIT 1`).get();
  } else {
    const fbUsername = `G-${verifiedAccount!.localId.slice(0, 10).toUpperCase()}`;
    user = db.prepare(`SELECT * FROM users WHERE username = ?`).get(fbUsername);
    if (!user) {
      const uid = `usr_fb_${verifiedAccount!.localId.slice(0, 20)}`;
      const fullName = String(verifiedAccount?.displayName || email.split('@')[0]).slice(0, 100);
      const randomPassHash = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10);
      db.prepare(
        `INSERT INTO users (id, username, password_hash, full_name, role, member_id, phone, two_factor_enabled, is_active, created_at)
         VALUES (?, ?, ?, ?, 'member', NULL, '', 0, 1, ?)`
      ).run(uid, fbUsername, randomPassHash, fullName, new Date().toISOString());
      user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(uid);
    }
  }

  if (!user || !user.is_active) {
    res.status(403).json({ error: 'Account is inactive or unavailable.' });
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  db.prepare(
    `INSERT INTO sessions (token, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(token, user.id, now.toISOString(), expires.toISOString(), ip, ua);

  db.prepare(
    `INSERT INTO login_activity (id, user_id, username, full_name, role, status, ip, user_agent, timestamp)
     VALUES (?, ?, ?, ?, ?, 'success', ?, ?, ?)`
  ).run(crypto.randomUUID(), user.id, user.username, user.full_name, user.role, ip, `${ua} [Firebase]`, now.toISOString());

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
      memberId: user.member_id,
      phone: user.phone,
      twoFactorEnabled: Boolean(user.two_factor_enabled),
      isActive: Boolean(user.is_active),
    },
  });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || String(newPassword).length < 6) {
    res.status(400).json({ error: 'Current password and a new password (min 6 characters) are required.' });
    return;
  }
  const userRow = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user!.id) as any;
  if (!userRow || !bcrypt.compareSync(String(currentPassword), userRow.password_hash)) {
    res.status(401).json({ error: 'Current password is incorrect.' });
    return;
  }
  const newHash = bcrypt.hashSync(String(newPassword), 10);
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(newHash, req.user!.id);
  res.json({ ok: true });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  db.prepare(`DELETE FROM sessions WHERE token = ?`).run(req.user!.token);
  db.prepare(
    `INSERT INTO login_activity (id, user_id, username, full_name, role, status, ip, user_agent, timestamp)
     VALUES (?, ?, ?, ?, ?, 'logout', ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    req.user!.id,
    req.user!.username,
    req.user!.fullName,
    req.user!.role,
    String(req.socket.remoteAddress || ''),
    String(req.headers['user-agent'] || '').slice(0, 180),
    new Date().toISOString()
  );
  res.json({ ok: true });
});

app.post('/api/auth/2fa', requireAuth, requireAdmin, (req, res) => {
  const { enabled } = req.body || {};
  db.prepare(`UPDATE users SET two_factor_enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, req.user!.id);
  addAuditLog({
    adminId: req.user!.id,
    adminName: req.user!.fullName,
    action: enabled ? 'ADMIN_2FA_ENABLED' : 'ADMIN_2FA_DISABLED',
    entityType: 'user',
    entityId: req.user!.id,
    afterData: { twoFactorEnabled: Boolean(enabled) },
    reason: 'Administrator security setting updated',
  });
  res.json({ ok: true, twoFactorEnabled: Boolean(enabled) });
});

app.get('/api/security/activity', requireAuth, (req, res) => {
  const isAdmin = isAdminRole(req.user!.role);
  const logs = isAdmin
    ? db.prepare(`SELECT * FROM login_activity ORDER BY timestamp DESC LIMIT 60`).all()
    : db
        .prepare(`SELECT * FROM login_activity WHERE user_id = ? ORDER BY timestamp DESC LIMIT 20`)
        .all(req.user!.id);

  const sessions = db
    .prepare(
      `SELECT s.token, s.created_at, s.expires_at, s.ip, s.user_agent, u.username, u.full_name, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE ${isAdmin ? '1=1' : 's.user_id = ?'}
       ORDER BY s.created_at DESC`
    )
    .all(...(isAdmin ? [] : [req.user!.id])) as Array<any>;

  const admins = db
    .prepare(`SELECT id, username, full_name, role, phone, two_factor_enabled, is_active FROM users WHERE role IN ('admin_main', 'admin_secondary')`)
    .all() as Array<any>;

  res.json({
    loginActivity: (logs as Array<any>).map((l) => ({
      id: l.id,
      userId: l.user_id,
      username: l.username,
      fullName: l.full_name,
      role: l.role,
      status: l.status,
      ip: l.ip,
      userAgent: l.user_agent,
      timestamp: l.timestamp,
    })),
    activeSessions: sessions.map((s) => ({
      tokenPreview: `${s.token.slice(0, 8)}...`,
      isCurrent: s.token === req.user!.token,
      username: s.username,
      fullName: s.full_name,
      role: s.role,
      ip: s.ip,
      userAgent: s.user_agent,
      createdAt: s.created_at,
      expiresAt: s.expires_at,
    })),
    admins: admins.map((a) => ({
      id: a.id,
      username: a.username,
      fullName: a.full_name,
      role: a.role,
      phone: a.phone,
      twoFactorEnabled: Boolean(a.two_factor_enabled),
      isActive: Boolean(a.is_active),
    })),
    backups: isAdmin ? listBackups() : [],
  });
});

// ---------- DASHBOARD SUMMARY ----------
app.get('/api/dashboard', requireAuth, (req, res) => {
  const curMonth = getCurrentMonthKey();
  const funds = computeFunds();
  const banks = computeBankAccounts();
  const cashBalance = computeCashBalance();
  const reconciliation = computeDoubleEntryTrialBalance();
  const settings = getAppSettings();
  const maskPhones = !isAdminRole(req.user!.role) && settings.hideMemberPhonesForMembers;
  const members = computeMembers(maskPhones);
  const staff = computeStaffSalaries();

  const totalBankBalance = banks.reduce((sum, b) => sum + b.currentBalance, 0);
  const totalBalance = totalBankBalance + cashBalance;

  const approvedTxns = db
    .prepare(`SELECT * FROM transactions WHERE status = 'approved'`)
    .all() as Array<any>;

  const monthlyIncome = approvedTxns
    .filter((t) => t.month_key === curMonth && t.type === 'income')
    .reduce((s, t) => s + Number(t.amount), 0);

  const monthlyExpense = approvedTxns
    .filter((t) => t.month_key === curMonth && t.type === 'expense')
    .reduce((s, t) => s + Number(t.amount), 0);

  const monthlyContributionsReceived = approvedTxns
    .filter((t) => t.month_key === curMonth && t.type === 'income' && t.member_id)
    .reduce((s, t) => s + Number(t.amount), 0);

  const totalContributionsReceived = members.reduce((s, m) => s + m.totalPaid, 0);
  const totalOutstandingContributions = members.reduce((s, m) => s + m.outstandingAmount, 0);
  const outstandingMemberCount = members.filter((m) => m.outstandingAmount > 0 && m.status === 'active').length;
  const totalPendingSalaries = staff.reduce((s, st) => s + st.totalPending, 0);

  const fundBal = (id: string) => funds.find((f) => f.id === id)?.currentBalance || 0;

  const pendingApprovalsCount = (
    db.prepare(`SELECT COUNT(*) as c FROM approvals WHERE status = 'pending'`).get() as { c: number }
  ).c;

  const pendingVerificationsCount = (
    db.prepare(`SELECT COUNT(*) as c FROM payment_submissions WHERE status = 'pending_verification'`).get() as { c: number }
  ).c;

  const monthlyChart = [];
  for (let i = 5; i >= 0; i--) {
    const mk = shiftMonthKey(curMonth, -i);
    const inc = approvedTxns
      .filter((t) => t.month_key === mk && t.type === 'income')
      .reduce((s, t) => s + Number(t.amount), 0);
    const exp = approvedTxns
      .filter((t) => t.month_key === mk && t.type === 'expense')
      .reduce((s, t) => s + Number(t.amount), 0);
    const d = new Date(`${mk}-01T00:00:00Z`);
    const label = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    monthlyChart.push({ monthKey: mk, label, income: inc, expense: exp });
  }

  res.json({
    summary: {
      totalBankBalance,
      totalCashBalance: cashBalance,
      totalBalance,
      monthlyIncome,
      monthlyExpense,
      monthlyContributionsReceived,
      totalContributionsReceived,
      totalOutstandingContributions,
      outstandingMemberCount,
      totalPendingSalaries,
      masjidBalance: fundBal('masjid_general'),
      madrasaBalance: fundBal('madrasa_general'),
      ramadanBalance: fundBal('ramadan'),
      zakatBalance: fundBal('zakat'),
      fitraBalance: fundBal('fitra'),
      sadqaBalance: fundBal('sadqa'),
      rabiUlAwwalBalance: fundBal('rabi_ul_awwal'),
      jumaBalance: fundBal('juma'),
      pendingApprovalsCount,
      pendingVerificationsCount,
      monthlyChart,
      currentMonthKey: curMonth,
      reconciliation,
    },
    funds,
    settings,
  });
});

// ---------- FUNDS & DOUBLE-ENTRY RECONCILIATION ----------
app.get('/api/funds', requireAuth, (_req, res) => {
  res.json({
    funds: computeFunds(),
    reconciliation: computeDoubleEntryTrialBalance(),
  });
});

app.post('/api/funds', requireAuth, requireAdmin, (req, res) => {
  const { code, nameEn, nameHi, nameUr, description, scope, isRestricted, restrictedRule } = req.body || {};
  const cleanNameEn = String(nameEn || '').trim().slice(0, 120);
  if (!cleanNameEn) {
    res.status(400).json({ error: 'Fund name (English) is required.' });
    return;
  }
  const cleanCode = String(code || cleanNameEn)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '')
    .slice(0, 24);
  if (!cleanCode || cleanCode.length < 2) {
    res.status(400).json({ error: 'Valid fund code (2–24 letters/digits) is required.' });
    return;
  }
  const existingCode = db.prepare(`SELECT id FROM funds WHERE UPPER(code) = ?`).get(cleanCode);
  if (existingCode) {
    res.status(409).json({ error: `Fund code "${cleanCode}" already exists. Please choose a unique code.` });
    return;
  }

  const validScope = ['masjid', 'madrasa', 'restricted', 'general'].includes(scope) ? scope : 'general';
  const id = `fund_${cleanCode.toLowerCase()}_${crypto.randomUUID().slice(0, 4)}`;
  const maxOrderRow = db.prepare(`SELECT COALESCE(MAX(sort_order), 10) as m FROM funds`).get() as { m: number };
  const cleanDesc = String(description || restrictedRule || '').trim().slice(0, 400);
  const cleanRule = String(restrictedRule || cleanDesc).trim().slice(0, 300);

  db.prepare(
    `INSERT INTO funds (id, code, name_en, name_hi, name_ur, description, scope, is_restricted, restricted_rule, opening_balance, sort_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1)`
  ).run(
    id,
    cleanCode,
    cleanNameEn,
    String(nameHi || cleanNameEn).trim().slice(0, 120),
    String(nameUr || cleanNameEn).trim().slice(0, 120),
    cleanDesc,
    validScope,
    isRestricted ? 1 : 0,
    cleanRule,
    Number(maxOrderRow.m) + 1
  );

  addAuditLog({
    adminId: req.user!.id,
    adminName: req.user!.fullName,
    action: 'FUND_CREATED',
    entityType: 'funds',
    entityId: id,
    afterData: {
      id,
      code: cleanCode,
      nameEn: cleanNameEn,
      scope: validScope,
      isRestricted: Boolean(isRestricted),
      description: cleanDesc,
      isActive: true,
    },
    reason: 'New virtual fund ledger created via Admin Control Panel',
  });

  broadcastUpdate('funds');
  res.status(201).json({ ok: true, id, code: cleanCode, funds: computeFunds() });
});

app.put('/api/funds/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare(`SELECT * FROM funds WHERE id = ?`).get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Fund ledger not found.' });
    return;
  }
  const { nameEn, nameHi, nameUr, description, scope, isRestricted, restrictedRule, isActive, reason } = req.body || {};
  const nextNameEn = nameEn !== undefined ? String(nameEn).trim().slice(0, 120) : existing.name_en;
  if (!nextNameEn) {
    res.status(400).json({ error: 'Fund name cannot be empty.' });
    return;
  }
  const nextNameHi = nameHi !== undefined ? String(nameHi).trim().slice(0, 120) : existing.name_hi;
  const nextNameUr = nameUr !== undefined ? String(nameUr).trim().slice(0, 120) : existing.name_ur;
  const nextDesc = description !== undefined ? String(description).trim().slice(0, 400) : existing.description || existing.restricted_rule || '';
  const nextRule = restrictedRule !== undefined ? String(restrictedRule).trim().slice(0, 300) : existing.restricted_rule;
  const nextScope = scope && ['masjid', 'madrasa', 'restricted', 'general'].includes(scope) ? scope : existing.scope;
  const nextRestricted = isRestricted !== undefined ? (isRestricted ? 1 : 0) : existing.is_restricted;
  const nextActive = isActive !== undefined ? (isActive ? 1 : 0) : existing.is_active ?? 1;

  db.prepare(
    `UPDATE funds
     SET name_en = ?, name_hi = ?, name_ur = ?, description = ?, scope = ?, is_restricted = ?, restricted_rule = ?, is_active = ?
     WHERE id = ?`
  ).run(nextNameEn, nextNameHi, nextNameUr, nextDesc, nextScope, nextRestricted, nextRule, nextActive, id);

  addAuditLog({
    adminId: req.user!.id,
    adminName: req.user!.fullName,
    action: nextActive !== (existing.is_active ?? 1) ? (nextActive ? 'FUND_ACTIVATED' : 'FUND_DEACTIVATED') : 'FUND_UPDATED',
    entityType: 'funds',
    entityId: id,
    beforeData: {
      nameEn: existing.name_en,
      description: existing.description || existing.restricted_rule,
      isRestricted: Boolean(existing.is_restricted),
      isActive: Boolean(existing.is_active ?? 1),
    },
    afterData: {
      nameEn: nextNameEn,
      description: nextDesc,
      isRestricted: Boolean(nextRestricted),
      isActive: Boolean(nextActive),
    },
    reason: String(reason || 'Fund details or status updated via Admin Control Panel').slice(0, 400),
  });

  broadcastUpdate('funds');
  res.json({ ok: true, funds: computeFunds() });
});

app.get('/api/accounting/reconciliation', requireAuth, (_req, res) => {
  const recentLines = db
    .prepare(`SELECT * FROM double_entry_lines ORDER BY created_at DESC LIMIT 80`)
    .all();
  res.json({
    reconciliation: computeDoubleEntryTrialBalance(),
    recentJournalLines: recentLines,
  });
});

// ---------- ADMIN CONTROL PANEL OVERVIEW & ROLE MANAGEMENT (STRICT ADMIN-ONLY) ----------
app.get('/api/admin/overview', requireAuth, requireAdmin, (_req, res) => {
  const curMonth = getCurrentMonthKey();
  const members = computeMembers(false);
  const funds = computeFunds();
  const banks = computeBankAccounts();
  const cashBalance = computeCashBalance();
  const reconciliation = computeDoubleEntryTrialBalance();

  const allApproved = db
    .prepare(`SELECT type, amount, month_key FROM transactions WHERE status = 'approved'`)
    .all() as Array<{ type: string; amount: number; month_key: string }>;

  let totalIncome = 0;
  let totalExpenses = 0;
  let monthlyCollection = 0;
  let monthlyExpenses = 0;
  for (const t of allApproved) {
    const amt = Number(t.amount);
    if (t.type === 'income') {
      totalIncome += amt;
      if (t.month_key === curMonth) monthlyCollection += amt;
    } else if (t.type === 'expense') {
      totalExpenses += amt;
      if (t.month_key === curMonth) monthlyExpenses += amt;
    }
  }

  const pendingApprovals = db
    .prepare(`SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as total FROM transactions WHERE status = 'pending_approval'`)
    .get() as { c: number; total: number };

  const pendingSubs = db
    .prepare(`SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as total FROM payment_submissions WHERE status = 'pending_verification'`)
    .get() as { c: number; total: number };

  const adminUsers = db
    .prepare(`SELECT id, username, full_name, role, member_id, phone, two_factor_enabled, is_active, created_at FROM users WHERE role IN ('admin_main', 'admin_secondary') ORDER BY role ASC`)
    .all() as Array<any>;

  const activeMembers = members.filter((m) => m.status === 'active').length;
  const inactiveMembers = members.filter((m) => m.status === 'inactive').length;
  const totalOutstandingDues = members.reduce((s, m) => s + m.outstandingAmount, 0);

  res.json({
    overview: {
      currentMonthKey: curMonth,
      totalMembers: members.length,
      activeMembers,
      inactiveMembers,
      totalIncome,
      totalExpenses,
      availableBalance: banks.reduce((s, b) => s + b.currentBalance, 0) + cashBalance,
      bankBalance: banks.reduce((s, b) => s + b.currentBalance, 0),
      cashBalance,
      monthlyCollection,
      monthlyExpenses,
      pendingPaymentsCount: Number(pendingSubs.c || 0),
      pendingPaymentsAmount: Number(pendingSubs.total || 0),
      totalOutstandingDues,
      pendingApprovalsCount: Number(pendingApprovals.c || 0),
      pendingApprovalsAmount: Number(pendingApprovals.total || 0),
      fundWiseBalances: funds,
      authorizedAdminsCount: adminUsers.length,
      maxAdminsAllowed: 2,
      reconciliation,
    },
  });
});

app.get('/api/admin/roles', requireAuth, requireAdmin, (_req, res) => {
  const admins = db
    .prepare(
      `SELECT id, username, full_name, role, member_id, phone, two_factor_enabled, is_active, created_at
       FROM users
       WHERE role IN ('admin_main', 'admin_secondary')
       ORDER BY CASE WHEN role = 'admin_main' THEN 1 ELSE 2 END ASC`
    )
    .all() as Array<any>;

  const memberUsers = db
    .prepare(
      `SELECT u.id, u.username, u.full_name, u.role, u.member_id, u.phone, u.is_active, u.created_at, m.status as member_status
       FROM users u
       LEFT JOIN members m ON m.id = u.member_id
       WHERE u.role = 'member'
       ORDER BY u.username ASC`
    )
    .all() as Array<any>;

  res.json({
    admins: admins.map((a) => ({
      id: a.id,
      username: a.username,
      fullName: a.full_name,
      role: a.role,
      memberId: a.member_id,
      phone: a.phone,
      twoFactorEnabled: Boolean(a.two_factor_enabled),
      isActive: Boolean(a.is_active),
      createdAt: a.created_at,
    })),
    memberAccounts: memberUsers.map((u) => ({
      id: u.id,
      username: u.username,
      fullName: u.full_name,
      role: u.role,
      memberId: u.member_id,
      phone: u.phone,
      isActive: Boolean(u.is_active),
      memberStatus: u.member_status || 'active',
      createdAt: u.created_at,
    })),
    maxAdmins: 2,
    canAddSecondaryAdmin: admins.length < 2,
  });
});

app.post('/api/admin/roles/promote', requireAuth, requireAdmin, (req, res) => {
  if (req.user!.role !== 'admin_main') {
    res.status(403).json({
      error: 'Only the Primary Administrator (Super Admin) is authorized to appoint a Secondary Administrator.',
    });
    return;
  }

  const { userId, memberId, reason } = req.body || {};
  const adminCount = (
    db.prepare(`SELECT COUNT(*) as c FROM users WHERE role IN ('admin_main', 'admin_secondary')`).get() as { c: number }
  ).c;

  if (adminCount >= 2) {
    res.status(409).json({
      error: 'Maximum of 2 authorized administrators already exists. Revoke the current Secondary Admin first before appointing another.',
    });
    return;
  }

  const targetUser = userId
    ? (db.prepare(`SELECT * FROM users WHERE id = ?`).get(String(userId)) as any)
    : memberId
    ? (db.prepare(`SELECT * FROM users WHERE member_id = ?`).get(String(memberId)) as any)
    : null;

  if (!targetUser) {
    res.status(404).json({ error: 'Selected member account was not found.' });
    return;
  }
  if (targetUser.role !== 'member') {
    res.status(400).json({ error: 'Selected user is already an administrator.' });
    return;
  }
  if (!targetUser.is_active) {
    res.status(400).json({ error: 'Cannot promote an inactive/revoked user to Secondary Administrator.' });
    return;
  }

  try {
    db.prepare(`UPDATE users SET role = 'admin_secondary', is_active = 1 WHERE id = ?`).run(targetUser.id);
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(targetUser.id);
  } catch (err: any) {
    res.status(409).json({ error: err?.message || 'Maximum administrator limit reached.' });
    return;
  }

  addAuditLog({
    adminId: req.user!.id,
    adminName: req.user!.fullName,
    action: 'ADMIN_ROLE_PROMOTED',
    entityType: 'users',
    entityId: targetUser.id,
    beforeData: { username: targetUser.username, fullName: targetUser.full_name, role: targetUser.role },
    afterData: { username: targetUser.username, fullName: targetUser.full_name, role: 'admin_secondary' },
    reason: String(reason || 'Promoted to Secondary Administrator by Super Admin').slice(0, 400),
  });

  broadcastUpdate('all');
  res.json({ ok: true, userId: targetUser.id, username: targetUser.username, role: 'admin_secondary' });
});

app.post('/api/admin/roles/revoke', requireAuth, requireAdmin, (req, res) => {
  if (req.user!.role !== 'admin_main') {
    res.status(403).json({
      error: 'Only the Primary Administrator (Super Admin) can revoke Secondary Administrator privileges.',
    });
    return;
  }

  const { userId, reason } = req.body || {};
  const targetUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(String(userId || '')) as any;
  if (!targetUser) {
    res.status(404).json({ error: 'Administrator account not found.' });
    return;
  }
  if (targetUser.role === 'admin_main' || targetUser.id === req.user!.id) {
    res.status(400).json({ error: 'Primary Administrator (Super Admin) role cannot be revoked.' });
    return;
  }
  if (targetUser.role !== 'admin_secondary') {
    res.status(400).json({ error: 'Selected account is not a Secondary Administrator.' });
    return;
  }

  db.prepare(`UPDATE users SET role = 'member' WHERE id = ?`).run(targetUser.id);
  db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(targetUser.id);

  addAuditLog({
    adminId: req.user!.id,
    adminName: req.user!.fullName,
    action: 'ADMIN_ROLE_REVOKED',
    entityType: 'users',
    entityId: targetUser.id,
    beforeData: { username: targetUser.username, fullName: targetUser.full_name, role: 'admin_secondary' },
    afterData: { username: targetUser.username, fullName: targetUser.full_name, role: 'member' },
    reason: String(reason || 'Secondary Administrator privileges revoked by Super Admin').slice(0, 400),
  });

  broadcastUpdate('all');
  res.json({ ok: true, userId: targetUser.id, role: 'member' });
});

// ---------- MEMBERS, MONTHLY DUES & PARTIAL CONTRIBUTIONS ----------
app.get('/api/members', requireAuth, (req, res) => {
  const settings = getAppSettings();
  const maskPhones = !isAdminRole(req.user!.role) && settings.hideMemberPhonesForMembers;
  res.json({ members: computeMembers(maskPhones) });
});

app.post('/api/contributions/generate', requireAuth, requireAdmin, (req, res) => {
  const { monthKey } = req.body || {};
  const target = monthKey && /^\d{4}-\d{2}$/.test(monthKey) ? monthKey : getCurrentMonthKey();
  const result = syncContributionsDuesForAllMembers(target);
  addAuditLog({
    adminId: req.user!.id,
    adminName: req.user!.fullName,
    action: 'MONTHLY_DUES_GENERATED',
    entityType: 'contributions',
    entityId: target,
    afterData: { monthKey: target, generatedCount: result.generatedCount },
    reason: 'Automatic monthly dues check & generation (duplicates prevented)',
  });
  broadcastUpdate('members');
  res.json({ ok: true, monthKey: target, generatedCount: result.generatedCount });
});

app.post('/api/members', requireAuth, requireAdmin, (req, res) => {
  const { fullName, phone, village, monthlyAmount, joiningDate, password, memberCode: requestedCode } = req.body || {};
  if (!fullName || !phone || !village) {
    res.status(400).json({ error: 'Full name, mobile number, and village/address are required.' });
    return;
  }

  let memberCode = '';
  if (requestedCode && String(requestedCode).trim()) {
    const cleanReqCode = String(requestedCode).trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,20}$/.test(cleanReqCode)) {
      res.status(400).json({ error: 'Member ID must be 2–20 alphanumeric characters (A-Z, 0-9, -, _).' });
      return;
    }
    const dupMember = db.prepare(`SELECT 1 FROM members WHERE UPPER(member_code) = ?`).get(cleanReqCode);
    const dupUser = db.prepare(`SELECT 1 FROM users WHERE UPPER(username) = ?`).get(cleanReqCode);
    if (dupMember || dupUser) {
      res.status(409).json({ error: `Member ID "${cleanReqCode}" is already in use. Please enter a unique Member ID.` });
      return;
    }
    memberCode = cleanReqCode;
  } else {
    const countRow = db.prepare(`SELECT COUNT(*) as c FROM members`).get() as { c: number };
    let num = countRow.c + 1;
    memberCode = `M${String(num).padStart(3, '0')}`;
    while (
      db.prepare(`SELECT 1 FROM members WHERE member_code = ?`).get(memberCode) ||
      db.prepare(`SELECT 1 FROM users WHERE UPPER(username) = UPPER(?)`).get(memberCode)
    ) {
      num += 1;
      memberCode = `M${String(num).padStart(3, '0')}`;
    }
  }

  const cleanPassword = String(password || 'Member@123');
  if (cleanPassword.length < 6) {
    res.status(400).json({ error: 'Member password must be at least 6 characters.' });
    return;
  }

  const id = `mem_${crypto.randomUUID().slice(0, 8)}`;
  const amt = Number(monthlyAmount || getAppSettings().defaultMonthlyContribution || 500);
  if (!Number.isFinite(amt) || amt < 1) {
    res.status(400).json({ error: 'Monthly contribution amount must be a positive number.' });
    return;
  }
  const join = joiningDate || getTodayISO();

  db.prepare(
    `INSERT INTO members (id, member_code, full_name, phone, village, monthly_amount, joining_date, status, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 0)`
  ).run(id, memberCode, String(fullName).trim(), String(phone).trim(), String(village).trim(), amt, join);

  const passHash = bcrypt.hashSync(cleanPassword, 8);
  db.prepare(
    `INSERT INTO users (id, username, password_hash, full_name, role, member_id, phone, is_active, created_at)
     VALUES (?, ?, ?, ?, 'member', ?, ?, 1, ?)`
  ).run(`usr_${id}`, memberCode, passHash, String(fullName).trim(), id, String(phone).trim(), new Date().toISOString());

  // Immediately generate dues for the new member according to their individual monthly amount
  syncContributionsDuesForAllMembers();

  addAuditLog({
    adminId: req.user!.id,
    adminName: req.user!.fullName,
    action: 'MEMBER_CREATED',
    entityType: 'member',
    entityId: id,
    afterData: { memberCode, fullName, phone, village, monthlyAmount: amt, joiningDate: join },
    reason: 'New committee member registered with individual monthly contribution amount',
  });

  broadcastUpdate('members');
  res.status(201).json({ id, memberCode, defaultPassword: cleanPassword });
});

app.put('/api/members/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare(`SELECT * FROM members WHERE id = ?`).get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Member not found.' });
    return;
  }

  const { fullName, phone, village, monthlyAmount, joiningDate, status, reason, resetPassword } = req.body || {};
  const nextName = fullName ? String(fullName).trim() : existing.full_name;
  const nextPhone = phone ? String(phone).trim() : existing.phone;
  const nextVillage = village ? String(village).trim() : existing.village;
  const nextAmt = monthlyAmount !== undefined ? Number(monthlyAmount) : Number(existing.monthly_amount);
  const nextJoin = joiningDate || existing.joining_date;
  const nextStatus = status === 'inactive' ? 'inactive' : 'active';

  db.prepare(
    `UPDATE members SET full_name = ?, phone = ?, village = ?, monthly_amount = ?, joining_date = ?, status = ? WHERE id = ?`
  ).run(nextName, nextPhone, nextVillage, nextAmt, nextJoin, nextStatus, id);

  db.prepare(`UPDATE users SET full_name = ?, phone = ?, is_active = ? WHERE member_id = ?`).run(
    nextName,
    nextPhone,
    nextStatus === 'active' ? 1 : 0,
    id
  );

  if (nextStatus === 'inactive') {
    db.prepare(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE member_id = ?)`).run(id);
  }

  if (resetPassword && String(resetPassword).length >= 6) {
    const newHash = bcrypt.hashSync(String(resetPassword), 8);
    db.prepare(`UPDATE users SET password_hash = ? WHERE member_id = ?`).run(newHash, id);
    db.prepare(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE member_id = ?)`).run(id);
  }

  // Update future/unpaid current-month expected amount if monthly_amount changed
  if (nextAmt !== Number(existing.monthly_amount)) {
    const curMonth = getCurrentMonthKey();
    db.prepare(
      `UPDATE contributions SET expected_amount = ?, updated_at = ? WHERE member_id = ? AND month_key >= ? AND paid_amount = 0`
    ).run(nextAmt, new Date().toISOString(), id, curMonth);
  }

  syncContributionsDuesForAllMembers();

  addAuditLog({
    adminId: req.user!.id,
    adminName: req.user!.fullName,
    action: 'MEMBER_UPDATED',
    entityType: 'member',
    entityId: id,
    beforeData: existing,
    afterData: {
      fullName: nextName,
      phone: nextPhone,
      village: nextVillage,
      monthlyAmount: nextAmt,
      joiningDate: nextJoin,
      status: nextStatus,
      passwordReset: Boolean(resetPassword && String(resetPassword).length >= 6),
    },
    reason: reason || 'Member details updated',
  });

  broadcastUpdate('members');
  res.json({ ok: true });
});

app.post('/api/admin/members/:id/access', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { isActive, resetPassword, reason } = req.body || {};
  const member = db.prepare(`SELECT * FROM members WHERE id = ?`).get(id) as any;
  if (!member) {
    res.status(404).json({ error: 'Member not found.' });
    return;
  }

  const linkedUser = db.prepare(`SELECT * FROM users WHERE member_id = ?`).get(id) as any;
  if (linkedUser && linkedUser.role === 'admin_main') {
    res.status(400).json({ error: 'Cannot disable login access for the Primary Administrator.' });
    return;
  }

  const nextActive = isActive !== undefined ? (isActive ? 1 : 0) : linkedUser ? linkedUser.is_active : 1;
  if (linkedUser) {
    db.prepare(`UPDATE users SET is_active = ? WHERE id = ?`).run(nextActive, linkedUser.id);
    if (!nextActive) {
      db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(linkedUser.id);
    }
    if (resetPassword && String(resetPassword).length >= 6) {
      const hash = bcrypt.hashSync(String(resetPassword), 8);
      db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hash, linkedUser.id);
      db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(linkedUser.id);
    }
  }

  db.prepare(`UPDATE members SET status = ? WHERE id = ?`).run(nextActive ? 'active' : 'inactive', id);

  addAuditLog({
    adminId: req.user!.id,
    adminName: req.user!.fullName,
    action: nextActive ? 'MEMBER_ACCESS_ENABLED' : 'MEMBER_ACCESS_REVOKED',
    entityType: 'member',
    entityId: id,
    beforeData: { status: member.status, loginActive: linkedUser ? Boolean(linkedUser.is_active) : false },
    afterData: { status: nextActive ? 'active' : 'inactive', loginActive: Boolean(nextActive), passwordReset: Boolean(resetPassword) },
    reason: String(reason || (nextActive ? 'Member login access enabled' : 'Member login access revoked (financial history preserved)')).slice(0, 400),
  });

  broadcastUpdate('members');
  res.json({ ok: true, isActive: Boolean(nextActive) });
});

app.delete('/api/members/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare(`SELECT * FROM members WHERE id = ?`).get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Member not found.' });
    return;
  }

  const linkedAdmin = db
    .prepare(`SELECT id, role FROM users WHERE member_id = ? AND role IN ('admin_main', 'admin_secondary')`)
    .get(id) as any;
  if (linkedAdmin) {
    res.status(400).json({ error: 'Cannot remove an active Administrator account. Revoke admin role first.' });
    return;
  }

  const payCount = (db.prepare(`SELECT COUNT(*) as c FROM member_payments WHERE member_id = ?`).get(id) as { c: number }).c;
  const txnCount = (db.prepare(`SELECT COUNT(*) as c FROM transactions WHERE member_id = ?`).get(id) as { c: number }).c;
  const subCount = (db.prepare(`SELECT COUNT(*) as c FROM payment_submissions WHERE member_id = ?`).get(id) as { c: number }).c;
  const paidContribCount = (
    db.prepare(`SELECT COUNT(*) as c FROM contributions WHERE member_id = ? AND paid_amount > 0`).get(id) as { c: number }
  ).c;

  if (payCount > 0 || txnCount > 0 || subCount > 0 || paidContribCount > 0) {
    db.prepare(`UPDATE members SET status = 'inactive' WHERE id = ?`).run(id);
    db.prepare(`UPDATE users SET is_active = 0 WHERE member_id = ?`).run(id);
    db.prepare(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE member_id = ?)`).run(id);
    addAuditLog({
      adminId: req.user!.id,
      adminName: req.user!.fullName,
      action: 'MEMBER_DEACTIVATED',
      entityType: 'member',
      entityId: id,
      beforeData: existing,
      afterData: { status: 'inactive', loginRevoked: true, preservedRecords: payCount + txnCount + subCount },
      reason: 'Access revoked & member deactivated instead of deleting to preserve permanent payment & accounting history',
    });
    broadcastUpdate('members');
    res.json({ ok: true, mode: 'deactivated_history_preserved' });
    return;
  } else {
    db.prepare(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE member_id = ?)`).run(id);
    db.prepare(`DELETE FROM users WHERE member_id = ?`).run(id);
    db.prepare(`DELETE FROM members WHERE id = ?`).run(id);
    addAuditLog({
      adminId: req.user!.id,
      adminName: req.user!.fullName,
      action: 'MEMBER_DELETED',
      entityType: 'member',
      entityId: id,
      beforeData: existing,
      afterData: null,
      reason: 'Member removed (no prior financial transactions)',
    });
  }

  broadcastUpdate('members');
  res.json({ ok: true, mode: 'deleted' });
});

// Record Monthly Member Contribution (Full OR Partial Payment!)
app.post('/api/members/:id/contributions', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { months, monthPayments, amountPerMonth, customTotalAmount, paymentMethod, fundId, date, notes } = req.body || {};
  const member = db.prepare(`SELECT * FROM members WHERE id = ?`).get(id) as any;
  if (!member) {
    res.status(404).json({ error: 'Member not found.' });
    return;
  }

  const payDate = date || getTodayISO();
  const payMonthKey = payDate.slice(0, 7);

  if (isMonthLocked(payMonthKey)) {
    res.status(423).json({ error: `Month ${payMonthKey} is closed and locked. Reopen the month to record entries.` });
    return;
  }

  // Build exact allocations per month (supporting partial payments!)
  let allocations: Array<{ monthKey: string; amount: number }> = [];
  if (Array.isArray(monthPayments) && monthPayments.length > 0) {
    allocations = monthPayments
      .map((mp: any) => ({ monthKey: String(mp.monthKey), amount: Number(mp.amount) }))
      .filter((mp) => /^\d{4}-\d{2}$/.test(mp.monthKey) && mp.amount > 0);
  } else {
    const monthList: string[] = Array.isArray(months) && months.length > 0 ? months : [getCurrentMonthKey()];
    if (customTotalAmount !== undefined && Number(customTotalAmount) > 0 && monthList.length === 1) {
      allocations = [{ monthKey: monthList[0], amount: Number(customTotalAmount) }];
    } else {
      const perMonth = Number(amountPerMonth || member.monthly_amount);
      allocations = monthList.map((mk) => ({ monthKey: mk, amount: perMonth }));
    }
  }

  if (allocations.length === 0) {
    res.status(400).json({ error: 'At least one valid month and positive payment amount is required.' });
    return;
  }

  const totalAmount = allocations.reduce((s, a) => s + a.amount, 0);
  const method: 'Cash' | 'UPI' | 'Bank' = paymentMethod === 'UPI' || paymentMethod === 'Bank' ? paymentMethod : 'Cash';
  const targetFund = fundId || 'masjid_general';
  const bankId = method === 'Cash' ? null : SINGLE_BANK_ID;

  const txnId = crypto.randomUUID();
  const txnNumber = generateTxnNumber(payDate);
  const now = new Date().toISOString();
  const monthLabels = allocations.map((a) => `${a.monthKey} (₹${a.amount})`).join(', ');
  const memo = notes || `Contribution for ${monthLabels}`;

  const recordTx = db.transaction(() => {
    db.prepare(
      `INSERT INTO transactions (
        id, txn_number, date, created_at, month_key, type, category, fund_id, target_fund_id,
        bank_account_id, payment_method, amount, party_name, member_id, description, receipt_url,
        status, created_by, created_by_name, approved_by, approved_by_name, approved_at, is_demo
      ) VALUES (?, ?, ?, ?, ?, 'income', 'Monthly Member Contribution', ?, NULL, ?, ?, ?, ?, ?, ?, NULL, 'approved', ?, ?, ?, ?, ?, 0)`
    ).run(
      txnId,
      txnNumber,
      payDate,
      now,
      payMonthKey,
      targetFund,
      bankId,
      method,
      totalAmount,
      `${member.full_name} (${member.member_code})`,
      member.id,
      memo,
      req.user!.id,
      req.user!.fullName,
      req.user!.id,
      req.user!.fullName,
      now
    );

    postDoubleEntryForTransaction({
      transactionId: txnId,
      txnNumber,
      date: payDate,
      type: 'income',
      fundId: targetFund,
      paymentMethod: method,
      amount: totalAmount,
      memo,
    });

    const insPay = db.prepare(
      `INSERT INTO member_payments (id, member_id, month_key, amount, paid_date, payment_method, txn_id, txn_number, status, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'verified', 0)`
    );
    for (const alloc of allocations) {
      insPay.run(crypto.randomUUID(), member.id, alloc.monthKey, alloc.amount, payDate, method, txnId, txnNumber);
    }

    // Recompute contributions table immediately
    syncContributionsDuesForAllMembers();

    // Stop reminders automatically if member now has 0 outstanding dues
    const unpaidRow = db
      .prepare(`SELECT COUNT(*) as c FROM contributions WHERE member_id = ? AND status != 'paid'`)
      .get(member.id) as { c: number };
    if (unpaidRow.c === 0) {
      db.prepare(`UPDATE reminder_logs SET status = 'stopped_paid' WHERE target_member_id = ? AND status = 'sent'`).run(member.id);
    }

    addAuditLog({
      adminId: req.user!.id,
      adminName: req.user!.fullName,
      action: 'MEMBER_CONTRIBUTION_RECORDED',
      entityType: 'contributions',
      entityId: txnId,
      afterData: { memberCode: member.member_code, allocations, totalAmount, method, txnNumber },
      reason: memo,
    });

    addNotification({
      type: 'payment_received',
      title: `Contribution Received — ${member.full_name}`,
      message: `₹${totalAmount.toLocaleString('en-IN')} recorded (${monthLabels}) · Receipt: ${txnNumber}.`,
      targetRole: 'all',
      targetMemberId: member.id,
    });
  });

  recordTx();
  broadcastUpdate('contributions');
  res.status(201).json({ txnId, txnNumber, totalAmount, allocations });
});

// ---------- TRANSACTIONS, DOUBLE-ENTRY, ₹5,000 APPROVALS & REVERSALS ----------
app.get('/api/transactions', requireAuth, (req, res) => {
  const { fundId, type, status, search, monthKey } = req.query;
  const rows = db
    .prepare(
      `SELECT t.*, f.name_en as fund_name, tf.name_en as target_fund_name, b.bank_name
       FROM transactions t
       LEFT JOIN funds f ON f.id = t.fund_id
       LEFT JOIN funds tf ON tf.id = t.target_fund_id
       LEFT JOIN bank_accounts b ON b.id = t.bank_account_id
       ORDER BY t.date DESC, t.created_at DESC`
    )
    .all() as Array<any>;

  let list = rows.map((t) => ({
    id: t.id,
    txnNumber: t.txn_number,
    date: t.date,
    createdAt: t.created_at,
    monthKey: t.month_key,
    type: t.type,
    category: t.category,
    fundId: t.fund_id,
    fundName: t.fund_name,
    targetFundId: t.target_fund_id,
    targetFundName: t.target_fund_name,
    bankAccountId: t.bank_account_id,
    bankAccountName: t.bank_name,
    paymentMethod: t.payment_method,
    amount: Number(t.amount),
    partyName: t.party_name,
    memberId: t.member_id,
    description: t.description,
    receiptUrl: t.receipt_url,
    status: t.status,
    createdBy: t.created_by,
    createdByName: t.created_by_name,
    approvedBy: t.approved_by,
    approvedByName: t.approved_by_name,
    approvedAt: t.approved_at,
    rejectionReason: t.rejection_reason,
    reversedTxnId: t.reversed_txn_id,
    isDemo: Boolean(t.is_demo),
  }));

  if (fundId && fundId !== 'all') {
    list = list.filter((t) => t.fundId === fundId || t.targetFundId === fundId);
  }
  if (type && type !== 'all') {
    list = list.filter((t) => t.type === type);
  }
  if (status && status !== 'all') {
    list = list.filter((t) => t.status === status);
  }
  if (monthKey && monthKey !== 'all') {
    list = list.filter((t) => t.monthKey === monthKey);
  }
  if (search) {
    const q = String(search).toLowerCase().trim();
    list = list.filter(
      (t) =>
        t.txnNumber.toLowerCase().includes(q) ||
        t.partyName.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.date.includes(q) ||
        String(t.amount).includes(q)
    );
  }

  res.json({ transactions: list });
});

app.get('/api/approvals', requireAuth, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT a.*, t.category, t.fund_id, t.party_name, t.date, t.payment_method, t.description, f.name_en as fund_name
       FROM approvals a
       JOIN transactions t ON t.id = a.transaction_id
       LEFT JOIN funds f ON f.id = t.fund_id
       ORDER BY a.requested_at DESC`
    )
    .all();
  res.json({ approvals: rows });
});

app.post('/api/transactions', requireAuth, requireAdmin, (req, res) => {
  const {
    date,
    type,
    category,
    fundId,
    targetFundId,
    paymentMethod,
    amount,
    partyName,
    description,
    receiptUrl,
  } = req.body || {};

  const numAmount = Number(amount);
  if (!type || !['income', 'expense', 'transfer'].includes(type)) {
    res.status(400).json({ error: 'Valid transaction type (income, expense, transfer) is required.' });
    return;
  }
  if (!fundId || !numAmount || numAmount <= 0) {
    res.status(400).json({ error: 'Fund account and a positive amount are required.' });
    return;
  }
  if (!partyName || !category) {
    res.status(400).json({ error: 'Party name and category are required.' });
    return;
  }

  const txnDate = date || getTodayISO();
  const monthKey = txnDate.slice(0, 7);

  const fundCheck = db.prepare(`SELECT id, name_en, is_active FROM funds WHERE id = ?`).get(fundId) as any;
  if (!fundCheck) {
    res.status(400).json({ error: 'Selected fund account does not exist.' });
    return;
  }
  if (fundCheck.is_active === 0) {
    res.status(400).json({ error: `Fund "${fundCheck.name_en}" is currently inactive. Activate it in Admin Control Panel to record new entries.` });
    return;
  }
  if (type === 'transfer' && targetFundId) {
    const targetFundCheck = db.prepare(`SELECT id, name_en, is_active FROM funds WHERE id = ?`).get(targetFundId) as any;
    if (!targetFundCheck || targetFundCheck.is_active === 0) {
      res.status(400).json({ error: 'Destination fund must exist and be active.' });
      return;
    }
  }

  if (isMonthLocked(monthKey)) {
    res.status(423).json({
      error: `Month ${monthKey} is closed and locked. Only the Primary Administrator can reopen a closed month.`,
    });
    return;
  }

  const restrictedDisallowedForZakat = ['Electricity Bills', 'Water Bills', 'Construction Expenses', 'Cleaning Expenses', 'Imam Salary'];
  if (
    type === 'expense' &&
    (fundId === 'zakat' || fundId === 'fitra') &&
    restrictedDisallowedForZakat.includes(category)
  ) {
    res.status(400).json({
      error: `Shariah & Accounting Rule Violation: ${fundId.toUpperCase()} Fund is strictly restricted and cannot be spent on "${category}". Use Masjid/Madrasa General Fund instead.`,
    });
    return;
  }

  if (type === 'transfer') {
    if (!targetFundId || targetFundId === fundId) {
      res.status(400).json({ error: 'A different destination fund is required for an internal virtual fund transfer.' });
      return;
    }
    if (fundId === 'zakat' || fundId === 'fitra') {
      res.status(400).json({ error: 'Restricted Zakat/Fitra funds cannot be transferred into general funds.' });
      return;
    }
  }

  const method: 'Cash' | 'UPI' | 'Bank' = paymentMethod === 'UPI' || paymentMethod === 'Bank' ? paymentMethod : 'Cash';
  const bankId = method === 'Cash' ? null : SINGLE_BANK_ID;

  // Final Configuration #2: Expenses above ₹5,000 require secondary administrator approval
  const settings = getAppSettings();
  const needsDualApproval =
    type === 'expense' && settings.dualApprovalEnabled && numAmount > settings.dualApprovalLimit;

  const status = needsDualApproval ? 'pending_approval' : 'approved';
  const id = crypto.randomUUID();
  const txnNumber = generateTxnNumber(txnDate);
  const now = new Date().toISOString();

  const createTx = db.transaction(() => {
    db.prepare(
      `INSERT INTO transactions (
        id, txn_number, date, created_at, month_key, type, category, fund_id, target_fund_id,
        bank_account_id, payment_method, amount, party_name, member_id, description, receipt_url,
        status, created_by, created_by_name, approved_by, approved_by_name, approved_at, is_demo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      id,
      txnNumber,
      txnDate,
      now,
      monthKey,
      type,
      String(category).trim(),
      fundId,
      type === 'transfer' ? targetFundId : null,
      bankId,
      method,
      numAmount,
      String(partyName).trim(),
      String(description || '').trim(),
      receiptUrl || null,
      status,
      req.user!.id,
      req.user!.fullName,
      needsDualApproval ? null : req.user!.id,
      needsDualApproval ? null : req.user!.fullName,
      needsDualApproval ? null : now
    );

    if (needsDualApproval) {
      db.prepare(
        `INSERT INTO approvals (id, transaction_id, txn_number, amount, threshold_limit, requested_by, requested_by_name, requested_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
      ).run(
        crypto.randomUUID(),
        id,
        txnNumber,
        numAmount,
        settings.dualApprovalLimit,
        req.user!.id,
        req.user!.fullName,
        now
      );
    } else {
      postDoubleEntryForTransaction({
        transactionId: id,
        txnNumber,
        date: txnDate,
        type,
        fundId,
        targetFundId: type === 'transfer' ? targetFundId : null,
        paymentMethod: method,
        amount: numAmount,
        memo: description || `${category} — ${partyName}`,
      });
    }

    addAuditLog({
      adminId: req.user!.id,
      adminName: req.user!.fullName,
      action: needsDualApproval ? 'EXPENSE_PENDING_DUAL_APPROVAL' : `TRANSACTION_${type.toUpperCase()}_CREATED`,
      entityType: 'transaction',
      entityId: id,
      afterData: { txnNumber, type, category, fundId, targetFundId, amount: numAmount, method, status },
      reason: description || 'Financial entry recorded',
    });

    if (needsDualApproval) {
      addNotification({
        type: 'approval_required',
        title: `Dual Approval Needed (${txnNumber})`,
        message: `${req.user!.fullName} submitted ₹${numAmount.toLocaleString('en-IN')} (${category}) exceeding ₹${settings.dualApprovalLimit.toLocaleString('en-IN')}. Second admin approval required.`,
        targetRole: 'admin',
      });
    } else {
      addNotification({
        type: 'new_transaction',
        title: `${type === 'income' ? 'Income' : type === 'expense' ? 'Expense' : 'Fund Transfer'} Recorded (${txnNumber})`,
        message: `₹${numAmount.toLocaleString('en-IN')} · ${category} · ${partyName}`,
        targetRole: 'all',
      });
    }
  });

  createTx();
  broadcastUpdate('transactions');
  res.status(201).json({ id, txnNumber, status, needsDualApproval });
});

app.post('/api/transactions/:id/approve', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { decision, reason } = req.body || {};
  const txn = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(id) as any;
  if (!txn) {
    res.status(404).json({ error: 'Transaction not found.' });
    return;
  }
  if (txn.status !== 'pending_approval') {
    res.status(400).json({ error: 'Only pending transactions can be approved or rejected.' });
    return;
  }
  if (txn.created_by === req.user!.id) {
    res.status(403).json({
      error: 'Dual-Admin Rule Violation: The administrator who created this transaction cannot approve or reject it. The second administrator must review it.',
    });
    return;
  }

  const now = new Date().toISOString();
  const nextStatus = decision === 'reject' ? 'rejected' : 'approved';
  const note = reason || (nextStatus === 'approved' ? 'Verified and approved by second administrator' : 'Rejected by second administrator');

  const approveTx = db.transaction(() => {
    db.prepare(
      `UPDATE transactions SET status = ?, approved_by = ?, approved_by_name = ?, approved_at = ?, rejection_reason = ? WHERE id = ?`
    ).run(nextStatus, req.user!.id, req.user!.fullName, now, nextStatus === 'rejected' ? note : null, id);

    db.prepare(
      `UPDATE approvals SET status = ?, decided_by = ?, decided_by_name = ?, decided_at = ?, decision_reason = ? WHERE transaction_id = ?`
    ).run(nextStatus, req.user!.id, req.user!.fullName, now, note, id);

    if (nextStatus === 'approved') {
      postDoubleEntryForTransaction({
        transactionId: txn.id,
        txnNumber: txn.txn_number,
        date: txn.date,
        type: txn.type,
        fundId: txn.fund_id,
        targetFundId: txn.target_fund_id,
        paymentMethod: txn.payment_method,
        amount: Number(txn.amount),
        memo: txn.description || `${txn.category} — ${txn.party_name}`,
      });
    }

    addAuditLog({
      adminId: req.user!.id,
      adminName: req.user!.fullName,
      action: nextStatus === 'approved' ? 'TRANSACTION_APPROVED' : 'TRANSACTION_REJECTED',
      entityType: 'approvals',
      entityId: id,
      beforeData: { status: txn.status },
      afterData: { status: nextStatus, approvedBy: req.user!.fullName },
      reason: note,
    });

    addNotification({
      type: nextStatus === 'approved' ? 'new_transaction' : 'approval_rejected',
      title: `Expense ${nextStatus === 'approved' ? 'Approved' : 'Rejected'} (${txn.txn_number})`,
      message: `₹${Number(txn.amount).toLocaleString('en-IN')} (${txn.category}) was ${nextStatus} by ${req.user!.fullName}.`,
      targetRole: 'all',
    });
  });

  approveTx();
  broadcastUpdate('transactions');
  res.json({ ok: true, status: nextStatus });
});

app.post('/api/transactions/:id/reverse', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { reason } = req.body || {};
  if (!reason || String(reason).trim().length < 3) {
    res.status(400).json({ error: 'A clear reason for reversal is mandatory for the permanent audit trail.' });
    return;
  }

  const txn = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(id) as any;
  if (!txn) {
    res.status(404).json({ error: 'Transaction not found.' });
    return;
  }
  if (txn.status !== 'approved') {
    res.status(400).json({ error: 'Only approved transactions can be reversed.' });
    return;
  }
  if (isMonthLocked(txn.month_key)) {
    res.status(423).json({ error: `Month ${txn.month_key} is closed and locked. Reopen the month first.` });
    return;
  }

  const now = new Date().toISOString();
  const revId = crypto.randomUUID();
  const revNum = generateTxnNumber(getTodayISO());

  const doReversal = db.transaction(() => {
    db.prepare(`UPDATE transactions SET status = 'reversed' WHERE id = ?`).run(id);
    db.prepare(`UPDATE member_payments SET status = 'reversed' WHERE txn_id = ?`).run(id);

    db.prepare(
      `INSERT INTO transactions (
        id, txn_number, date, created_at, month_key, type, category, fund_id, target_fund_id,
        bank_account_id, payment_method, amount, party_name, member_id, description, receipt_url,
        status, created_by, created_by_name, approved_by, approved_by_name, approved_at, reversed_txn_id, is_demo
      ) VALUES (?, ?, ?, ?, ?, 'reversal', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'reversed', ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      revId,
      revNum,
      getTodayISO(),
      now,
      getCurrentMonthKey(),
      `Reversal of ${txn.txn_number}`,
      txn.fund_id,
      txn.target_fund_id,
      txn.bank_account_id,
      txn.payment_method,
      txn.amount,
      txn.party_name,
      txn.member_id,
      `Reversal entry: ${String(reason).trim()}`,
      req.user!.id,
      req.user!.fullName,
      req.user!.id,
      req.user!.fullName,
      now,
      txn.id
    );

    postDoubleEntryForTransaction({
      transactionId: revId,
      txnNumber: revNum,
      date: getTodayISO(),
      type: 'reversal',
      originalType: txn.type,
      fundId: txn.fund_id,
      targetFundId: txn.target_fund_id,
      paymentMethod: txn.payment_method,
      amount: Number(txn.amount),
      memo: `Reversal of ${txn.txn_number}: ${String(reason).trim()}`,
    });

    syncContributionsDuesForAllMembers();

    addAuditLog({
      adminId: req.user!.id,
      adminName: req.user!.fullName,
      action: 'TRANSACTION_REVERSED',
      entityType: 'transaction',
      entityId: id,
      beforeData: txn,
      afterData: { status: 'reversed', reversalTxnNumber: revNum },
      reason: String(reason).trim(),
    });
  });

  doReversal();
  broadcastUpdate('transactions');
  res.json({ ok: true, reversalTxnNumber: revNum });
});

app.put('/api/transactions/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const txn = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(id) as any;
  if (!txn) {
    res.status(404).json({ error: 'Transaction not found.' });
    return;
  }
  if (txn.status === 'reversed' || txn.status === 'rejected') {
    res.status(400).json({ error: 'Reversed or rejected transactions cannot be edited.' });
    return;
  }
  if (isMonthLocked(txn.month_key)) {
    res.status(423).json({ error: `Month ${txn.month_key} is locked. Only Primary Admin can reopen it before editing notes.` });
    return;
  }

  const { category, partyName, description, receiptUrl, reason, amount, fundId, type } = req.body || {};
  if (
    (amount !== undefined && Number(amount) !== Number(txn.amount)) ||
    (fundId !== undefined && String(fundId) !== String(txn.fund_id)) ||
    (type !== undefined && String(type) !== String(txn.type))
  ) {
    res.status(400).json({
      error: 'Amount, fund, and type cannot be silently overwritten on posted entries. Use Official Reversal + new entry to preserve immutable accounting history.',
    });
    return;
  }

  const cleanReason = String(reason || '').trim();
  if (cleanReason.length < 5) {
    res.status(400).json({ error: 'Please provide an audit reason (at least 5 characters) for updating this transaction.' });
    return;
  }

  const nextCategory = category ? String(category).trim().slice(0, 80) : txn.category;
  const nextParty = partyName ? String(partyName).trim().slice(0, 160) : txn.party_name;
  const nextDesc = description !== undefined ? String(description).trim().slice(0, 500) : txn.description;
  let nextReceipt = txn.receipt_url;
  if (receiptUrl !== undefined) {
    const candidate = String(receiptUrl || '').trim();
    if (candidate && !isSafeMediaUrl(candidate)) {
      res.status(400).json({ error: 'Invalid receipt URL.' });
      return;
    }
    nextReceipt = candidate || null;
  }

  db.prepare(`UPDATE transactions SET category = ?, party_name = ?, description = ?, receipt_url = ? WHERE id = ?`).run(
    nextCategory,
    nextParty,
    nextDesc,
    nextReceipt,
    id
  );

  addAuditLog({
    adminId: req.user!.id,
    adminName: req.user!.fullName,
    action: 'TRANSACTION_UPDATED',
    entityType: 'transaction',
    entityId: id,
    beforeData: { txnNumber: txn.txn_number, category: txn.category, partyName: txn.party_name, description: txn.description },
    afterData: { txnNumber: txn.txn_number, category: nextCategory, partyName: nextParty, description: nextDesc },
    reason: cleanReason,
  });

  broadcastUpdate('transactions');
  res.json({ ok: true });
});

// ---------- IMAM & TEACHERS SALARIES ----------
app.get('/api/salaries', requireAuth, (_req, res) => {
  res.json({ staff: computeStaffSalaries() });
});

app.post('/api/salaries/staff', requireAuth, requireAdmin, (req, res) => {
  const { name, designation, institution, monthlySalary, joiningDate, phone } = req.body || {};
  if (!name || !designation || !monthlySalary) {
    res.status(400).json({ error: 'Staff name, designation, and monthly salary are required.' });
    return;
  }
  const inst = institution === 'masjid' ? 'masjid' : 'madrasa';
  const fundId = inst === 'masjid' ? 'masjid_general' : 'madrasa_general';
  const id = `stf_${crypto.randomUUID().slice(0, 8)}`;

  db.prepare(
    `INSERT INTO staff (id, name, designation, institution, fund_id, monthly_salary, joining_date, phone, status, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 0)`
  ).run(id, String(name).trim(), String(designation).trim(), inst, fundId, Number(monthlySalary), joiningDate || getTodayISO(), phone || '');

  addAuditLog({
    adminId: req.user!.id,
    adminName: req.user!.fullName,
    action: 'STAFF_ADDED',
    entityType: 'salaries',
    entityId: id,
    afterData: { name, designation, institution: inst, monthlySalary: Number(monthlySalary) },
    reason: 'New Imam / Madrasa teacher added to payroll',
  });

  broadcastUpdate('salaries');
  res.status(201).json({ id });
});

app.post('/api/salaries/pay', requireAuth, requireAdmin, (req, res) => {
  const { staffId, monthKey, amount, paymentDate, paymentMethod, reference } = req.body || {};
  const staff = db.prepare(`SELECT * FROM staff WHERE id = ?`).get(staffId) as any;
  if (!staff) {
    res.status(404).json({ error: 'Staff member not found.' });
    return;
  }
  const numAmount = Number(amount);
  if (!numAmount || numAmount <= 0) {
    res.status(400).json({ error: 'Positive salary payment amount is required.' });
    return;
  }

  const payDate = paymentDate || getTodayISO();
  const targetMonth = monthKey || getCurrentMonthKey();
  const payMonthKey = payDate.slice(0, 7);

  if (isMonthLocked(payMonthKey)) {
    res.status(423).json({ error: `Month ${payMonthKey} is closed and locked.` });
    return;
  }

  const method: 'Cash' | 'UPI' | 'Bank' = paymentMethod === 'UPI' || paymentMethod === 'Bank' ? paymentMethod : 'Cash';
  const bankId = method === 'Cash' ? null : SINGLE_BANK_ID;

  const txnId = crypto.randomUUID();
  const txnNumber = generateTxnNumber(payDate);
  const now = new Date().toISOString();
  const memo = `Salary payment for ${targetMonth}${reference ? ` · Ref: ${reference}` : ''}`;

  const payTx = db.transaction(() => {
    db.prepare(
      `INSERT INTO transactions (
        id, txn_number, date, created_at, month_key, type, category, fund_id, target_fund_id,
        bank_account_id, payment_method, amount, party_name, member_id, description, receipt_url,
        status, created_by, created_by_name, approved_by, approved_by_name, approved_at, is_demo
      ) VALUES (?, ?, ?, ?, ?, 'expense', ?, ?, NULL, ?, ?, ?, ?, NULL, ?, NULL, 'approved', ?, ?, ?, ?, ?, 0)`
    ).run(
      txnId,
      txnNumber,
      payDate,
      now,
      payMonthKey,
      staff.institution === 'masjid' ? 'Imam Salary' : "Teachers' Salaries",
      staff.fund_id,
      bankId,
      method,
      numAmount,
      `${staff.name} (${staff.designation})`,
      memo,
      req.user!.id,
      req.user!.fullName,
      req.user!.id,
      req.user!.fullName,
      now
    );

    postDoubleEntryForTransaction({
      transactionId: txnId,
      txnNumber,
      date: payDate,
      type: 'expense',
      fundId: staff.fund_id,
      paymentMethod: method,
      amount: numAmount,
      memo,
    });

    db.prepare(
      `INSERT INTO salaries (id, staff_id, month_key, amount, payment_date, payment_method, reference, txn_id, txn_number, recorded_by_name, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(crypto.randomUUID(), staff.id, targetMonth, numAmount, payDate, method, reference || txnNumber, txnId, txnNumber, req.user!.fullName);

    addAuditLog({
      adminId: req.user!.id,
      adminName: req.user!.fullName,
      action: 'SALARY_PAID',
      entityType: 'salaries',
      entityId: staff.id,
      afterData: { staffName: staff.name, monthKey: targetMonth, amount: numAmount, method, txnNumber },
      reason: `Salary disbursed for ${targetMonth}`,
    });

    addNotification({
      type: 'salary_payment',
      title: `Salary Paid — ${staff.name}`,
      message: `₹${numAmount.toLocaleString('en-IN')} paid for ${targetMonth} via ${method} (${txnNumber}).`,
      targetRole: 'all',
    });
  });

  payTx();
  broadcastUpdate('salaries');
  res.status(201).json({ txnNumber });
});

// ---------- SECURE IMAGE UPLOADS (UPI QR & PAYMENT RECEIPTS) ----------
const ALLOWED_UPLOAD_FILENAME = /^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$/;
const SAFE_DATA_IMAGE_REGEX = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/;
const UPI_ID_REGEX = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z0-9.-]{2,64}$/;
const UTR_REGEX = /^[a-zA-Z0-9-]{6,40}$/;

function isSafeMediaUrl(url: string): boolean {
  const trimmed = String(url || '').trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/assets/') || trimmed.startsWith('/api/uploads/')) return true;
  if (trimmed.startsWith('https://firebasestorage.googleapis.com/')) return true;
  if (SAFE_DATA_IMAGE_REGEX.test(trimmed)) return true;
  return false;
}

app.post('/api/uploads/image', requireAuth, (req, res) => {
  const { dataUrl, purpose } = req.body || {};
  const uploadPurpose = purpose === 'upi_qr' ? 'upi_qr' : purpose === 'app_logo' ? 'app_logo' : 'payment_receipt';

  if ((uploadPurpose === 'upi_qr' || uploadPurpose === 'app_logo') && !isAdminRole(req.user!.role)) {
    res.status(403).json({ error: 'Only authorized administrators can upload official committee QR codes or logos.' });
    return;
  }

  if (typeof dataUrl !== 'string') {
    res.status(400).json({ error: 'Valid image file is required.' });
    return;
  }

  const match = dataUrl.trim().match(SAFE_DATA_IMAGE_REGEX);
  if (!match) {
    res.status(400).json({ error: 'Only PNG, JPG, JPEG, or WebP images are permitted.' });
    return;
  }

  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0 || buffer.length > 3 * 1024 * 1024) {
    res.status(400).json({ error: 'Image size must be between 1 byte and 3 MB.' });
    return;
  }

  const fileName = `${uploadPurpose}_${crypto.randomUUID().replace(/-/g, '')}.${ext}`;
  const resolved = path.resolve(UPLOADS_DIR, fileName);
  if (!resolved.startsWith(UPLOADS_DIR + path.sep)) {
    res.status(400).json({ error: 'Invalid upload destination.' });
    return;
  }

  fs.writeFileSync(resolved, buffer);
  res.status(201).json({ url: `/api/uploads/${fileName}`, fileName, sizeBytes: buffer.length });
});

app.get('/api/uploads/:fileName', (req, res) => {
  const fileName = String(req.params.fileName || '');
  if (!ALLOWED_UPLOAD_FILENAME.test(fileName)) {
    res.status(400).json({ error: 'Invalid file name.' });
    return;
  }
  const resolved = path.resolve(UPLOADS_DIR, fileName);
  if (!resolved.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(resolved)) {
    res.status(404).json({ error: 'File not found.' });
    return;
  }
  const ext = path.extname(fileName).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  res.setHeader('Content-Type', mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(resolved);
});

// ---------- SINGLE PHYSICAL BANK ACCOUNT, UPI QR SETTINGS & PAYMENT VERIFICATION ----------
app.get('/api/banks', requireAuth, (_req, res) => {
  res.json({
    bankAccounts: computeBankAccounts(),
    cashBalance: computeCashBalance(),
    reconciliation: computeDoubleEntryTrialBalance(),
  });
});

app.put('/api/banks/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare(`SELECT * FROM bank_accounts WHERE id = ?`).get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Bank account not found.' });
    return;
  }
  const { bankName, accountName, accountNumber, ifsc, branch, upiId, qrCodeUrl, instructions } = req.body || {};
  const cleanUpi = String(upiId || existing.upi_id || '').trim();
  if (!UPI_ID_REGEX.test(cleanUpi)) {
    res.status(400).json({ error: 'Please enter a valid UPI ID (e.g., boim-617606410026@boi).' });
    return;
  }

  let nextQrUrl = existing.qr_code_url || '';
  if (qrCodeUrl !== undefined) {
    const candidateQr = String(qrCodeUrl || '').trim();
    if (candidateQr && !isSafeMediaUrl(candidateQr)) {
      res.status(400).json({ error: 'Invalid UPI QR image URL. Upload a PNG/JPG/WebP image.' });
      return;
    }
    nextQrUrl = candidateQr;
  }

  db.prepare(
    `UPDATE bank_accounts
     SET bank_name = ?, account_name = ?, account_number = ?, ifsc = ?, branch = ?, upi_id = ?, qr_code_url = ?, instructions = ?
     WHERE id = ?`
  ).run(
    String(bankName || existing.bank_name).trim().slice(0, 120),
    String(accountName || existing.account_name).trim().slice(0, 160),
    String(accountNumber || existing.account_number).trim().slice(0, 40),
    String(ifsc || existing.ifsc).trim().toUpperCase().slice(0, 20),
    String(branch || existing.branch).trim().slice(0, 120),
    cleanUpi.slice(0, 120),
    nextQrUrl.slice(0, 500),
    instructions !== undefined ? String(instructions).trim().slice(0, 500) : existing.instructions,
    id
  );

  addAuditLog({
    adminId: req.user!.id,
    adminName: req.user!.fullName,
    action: 'BANK_UPI_SETTINGS_UPDATED',
    entityType: 'bank_accounts',
    entityId: id,
    beforeData: {
      bankName: existing.bank_name,
      accountName: existing.account_name,
      upiId: existing.upi_id,
      qrCodeUrl: existing.qr_code_url,
    },
    afterData: {
      bankName: bankName || existing.bank_name,
      accountName: accountName || existing.account_name,
      upiId: cleanUpi,
      qrCodeUrl: nextQrUrl,
    },
    reason: 'Updated official committee Bank UPI & QR Code settings',
  });

  broadcastUpdate('banks');
  res.json({ ok: true, qrCodeUrl: nextQrUrl });
});

app.get('/api/submissions', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT ps.*, m.member_code, m.full_name as member_name, b.bank_name, f.name_en as fund_name
       FROM payment_submissions ps
       LEFT JOIN members m ON m.id = ps.member_id
       LEFT JOIN bank_accounts b ON b.id = ps.bank_account_id
       LEFT JOIN funds f ON f.id = ps.fund_id
       ORDER BY ps.submitted_at DESC`
    )
    .all() as Array<any>;

  const utrCounts = new Map<string, number>();
  for (const r of rows) {
    const key = String(r.utr_reference || '').trim().toLowerCase();
    if (key) utrCounts.set(key, (utrCounts.get(key) || 0) + 1);
  }

  const filtered = isAdminRole(req.user!.role)
    ? rows
    : rows.filter((r) => r.member_id === req.user!.memberId || r.member_id === req.user!.id);

  res.json({
    submissions: filtered.map((r) => {
      const utrKey = String(r.utr_reference || '').trim().toLowerCase();
      return {
        id: r.id,
        memberId: r.member_id,
        memberCode: r.member_code || 'DONOR',
        memberName: r.member_name || r.donor_name || 'Committee Donor',
        donorName: r.donor_name || r.member_name || '',
        paymentCategory: r.payment_category || 'monthly_contribution',
        amount: Number(r.amount),
        months: JSON.parse(r.months_json || '[]'),
        bankAccountId: r.bank_account_id,
        bankName: r.bank_name,
        fundId: r.fund_id,
        fundName: r.fund_name || r.fund_id,
        utrReference: r.utr_reference,
        screenshotUrl: r.screenshot_url,
        notes: r.notes,
        status: r.status,
        submittedAt: r.submitted_at,
        verifiedBy: r.verified_by,
        verifiedByName: r.verified_by_name,
        verifiedAt: r.verified_at,
        rejectionNote: r.rejection_note,
        linkedTxnNumber: r.linked_txn_number,
        receiptNumber: r.receipt_number || null,
        bankVerifiedConfirmed: Boolean(r.bank_verified_confirmed),
        isDuplicateUtr: (utrCounts.get(utrKey) || 0) > 1,
        isDemo: Boolean(r.is_demo),
      };
    }),
  });
});

app.post('/api/submissions', requireAuth, (req, res) => {
  const { memberId, amount, months, fundId, paymentCategory, utrReference, screenshotUrl, notes } = req.body || {};
  let targetMemberId = isAdminRole(req.user!.role) ? memberId || req.user!.memberId : req.user!.memberId;

  if (!targetMemberId && !isAdminRole(req.user!.role)) {
    const autoMemberId = `mem_fb_${req.user!.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 14)}`;
    const existingAuto = db.prepare(`SELECT id FROM members WHERE id = ?`).get(autoMemberId) as any;
    if (!existingAuto) {
      const donorCode = `D-${req.user!.username.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase()}`;
      db.prepare(
        `INSERT INTO members (id, member_code, full_name, phone, village, monthly_amount, joining_date, status, is_demo)
         VALUES (?, ?, ?, '', 'Ragdih', 500, ?, 'inactive', 0)`
      ).run(autoMemberId, donorCode, req.user!.fullName, getTodayISO());
      db.prepare(`UPDATE users SET member_id = ? WHERE id = ?`).run(autoMemberId, req.user!.id);
    }
    targetMemberId = autoMemberId;
  }

  if (!targetMemberId) {
    res.status(400).json({ error: 'Member profile is required to submit a payment proof.' });
    return;
  }

  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount < 1 || numAmount > 10000000) {
    res.status(400).json({ error: 'Please enter a valid payment amount (₹1 to ₹1,00,00,000).' });
    return;
  }

  const cleanUtr = String(utrReference || '').trim().replace(/\s+/g, '');
  if (!UTR_REGEX.test(cleanUtr) || /^(\d)\1+$/.test(cleanUtr)) {
    res.status(400).json({
      error: 'Invalid UPI Transaction ID / UTR Number. Enter a valid 6–40 character alphanumeric reference from your UPI app.',
    });
    return;
  }

  if (!screenshotUrl || !isSafeMediaUrl(String(screenshotUrl))) {
    res.status(400).json({ error: 'Please upload a valid PNG, JPG, or WebP payment receipt screenshot.' });
    return;
  }

  const targetFundId = String(fundId || 'masjid_general').trim();
  const fundRow = db.prepare(`SELECT id, name_en FROM funds WHERE id = ?`).get(targetFundId) as
    | { id: string; name_en: string }
    | undefined;
  if (!fundRow) {
    res.status(400).json({ error: 'Selected donation fund does not exist.' });
    return;
  }

  const dupRow = db
    .prepare(
      `SELECT id, status, linked_txn_number FROM payment_submissions
       WHERE LOWER(TRIM(utr_reference)) = LOWER(?) AND status IN ('pending_verification', 'verified')
       LIMIT 1`
    )
    .get(cleanUtr) as any;
  if (dupRow) {
    res.status(409).json({
      error: `Duplicate UTR / Transaction ID (${cleanUtr}) detected. This reference is already ${
        dupRow.status === 'verified' ? `verified (${dupRow.linked_txn_number || 'posted'})` : 'pending administrator verification'
      }.`,
    });
    return;
  }

  const member = db.prepare(`SELECT * FROM members WHERE id = ?`).get(targetMemberId) as any;
  if (!member) {
    res.status(404).json({ error: 'Member record not found.' });
    return;
  }

  const category: 'monthly_contribution' | 'donation' =
    paymentCategory === 'donation' ? 'donation' : 'monthly_contribution';
  const id = `sub_${crypto.randomUUID().slice(0, 8)}`;
  const monthArr =
    category === 'monthly_contribution'
      ? Array.isArray(months) && months.length > 0
        ? months.map((m: unknown) => String(m).trim()).filter((m: string) => /^[0-9]{4}-[0-9]{2}$/.test(m))
        : [getCurrentMonthKey()]
      : [];

  const finalMonths = category === 'monthly_contribution' && monthArr.length === 0 ? [getCurrentMonthKey()] : monthArr;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO payment_submissions (
      id, member_id, donor_name, payment_category, amount, months_json, bank_account_id,
      fund_id, utr_reference, screenshot_url, notes, status, submitted_at, bank_verified_confirmed, is_demo
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_verification', ?, 0, 0)`
  ).run(
    id,
    targetMemberId,
    member.full_name,
    category,
    numAmount,
    JSON.stringify(finalMonths),
    SINGLE_BANK_ID,
    fundRow.id,
    cleanUtr,
    String(screenshotUrl).trim(),
    String(notes || '').trim().slice(0, 400),
    now
  );

  addNotification({
    type: 'payment_submission',
    title: `Pending UPI ${category === 'donation' ? 'Donation' : 'Contribution'} — ${member.full_name}`,
    message: `₹${numAmount.toLocaleString('en-IN')} to ${fundRow.name_en} (UTR: ${cleanUtr}) submitted for manual bank statement verification. Official balance unchanged until approved.`,
    targetRole: 'admin',
  });

  broadcastUpdate('submissions');
  res.status(201).json({
    id,
    status: 'pending_verification',
    fundName: fundRow.name_en,
    utrReference: cleanUtr,
    submittedAt: now,
  });
});

app.post('/api/submissions/:id/verify', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { decision, rejectionNote, bankStatementChecked } = req.body || {};
  const sub = db.prepare(`SELECT * FROM payment_submissions WHERE id = ?`).get(id) as any;
  if (!sub) {
    res.status(404).json({ error: 'Payment submission not found.' });
    return;
  }
  if (sub.status !== 'pending_verification') {
    res.status(400).json({ error: 'This payment submission has already been processed.' });
    return;
  }

  const member = db.prepare(`SELECT * FROM members WHERE id = ?`).get(sub.member_id) as any;
  const fundRow = db.prepare(`SELECT id, name_en, is_restricted FROM funds WHERE id = ?`).get(sub.fund_id) as any;
  const now = new Date().toISOString();

  if (decision === 'reject') {
    const reasonText = String(rejectionNote || '').trim();
    if (reasonText.length < 5) {
      res.status(400).json({ error: 'Please provide a clear rejection reason (at least 5 characters) for the audit log.' });
      return;
    }

    db.prepare(
      `UPDATE payment_submissions
       SET status = 'rejected', verified_by = ?, verified_by_name = ?, verified_at = ?, rejection_note = ?, bank_verified_confirmed = 0
       WHERE id = ?`
    ).run(req.user!.id, req.user!.fullName, now, reasonText.slice(0, 400), id);

    addAuditLog({
      adminId: req.user!.id,
      adminName: req.user!.fullName,
      action: 'PAYMENT_SUBMISSION_REJECTED',
      entityType: 'payment_submissions',
      entityId: id,
      beforeData: { status: 'pending_verification', utrReference: sub.utr_reference, amount: sub.amount, fundId: sub.fund_id },
      afterData: { status: 'rejected', rejectionNote: reasonText },
      reason: reasonText,
    });

    addNotification({
      type: 'payment_rejected',
      title: 'UPI Payment Submission Rejected',
      message: `Your ₹${Number(sub.amount).toLocaleString('en-IN')} payment (UTR: ${sub.utr_reference}) was rejected: ${reasonText}.`,
      targetRole: 'member',
      targetMemberId: sub.member_id,
    });

    broadcastUpdate('submissions');
    res.json({ ok: true, status: 'rejected' });
    return;
  }

  if (bankStatementChecked !== true) {
    res.status(400).json({
      error: 'Manual Bank Verification Required: Confirm that the exact UPI credit and UTR match your Bank of India statement before approving.',
    });
    return;
  }

  const verifiedDup = db
    .prepare(
      `SELECT id, linked_txn_number FROM payment_submissions
       WHERE id != ? AND LOWER(TRIM(utr_reference)) = LOWER(?) AND status = 'verified'
       LIMIT 1`
    )
    .get(id, String(sub.utr_reference || '').trim()) as any;
  if (verifiedDup) {
    res.status(409).json({
      error: `Duplicate UTR blocked: Reference ${sub.utr_reference} was already verified under ${verifiedDup.linked_txn_number}. Reject this duplicate entry instead.`,
    });
    return;
  }

  const months: string[] = JSON.parse(sub.months_json || '[]');
  const isMonthlyContrib = (sub.payment_category || 'monthly_contribution') === 'monthly_contribution';
  const perMonth = months.length > 0 ? Number(sub.amount) / months.length : Number(sub.amount);
  const payDate = getTodayISO();
  const txnId = crypto.randomUUID();
  const txnNumber = generateTxnNumber(payDate);
  const receiptNumber = generateReceiptNumber(payDate);
  const categoryLabel = isMonthlyContrib ? 'Monthly Member Contribution' : `UPI Fund Donation (${fundRow?.name_en || sub.fund_id})`;
  const memo = isMonthlyContrib
    ? `Verified UPI contribution · UTR: ${sub.utr_reference} · Receipt: ${receiptNumber} · Months: ${months.join(', ')}`
    : `Verified UPI donation to ${fundRow?.name_en || sub.fund_id} · UTR: ${sub.utr_reference} · Receipt: ${receiptNumber}`;

  const verifyTx = db.transaction(() => {
    db.prepare(
      `INSERT INTO transactions (
        id, txn_number, date, created_at, month_key, type, category, fund_id, target_fund_id,
        bank_account_id, payment_method, amount, party_name, member_id, description, receipt_url,
        status, created_by, created_by_name, approved_by, approved_by_name, approved_at, is_demo
      ) VALUES (?, ?, ?, ?, ?, 'income', ?, ?, NULL, ?, 'UPI', ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, 0)`
    ).run(
      txnId,
      txnNumber,
      payDate,
      now,
      payDate.slice(0, 7),
      categoryLabel,
      sub.fund_id || 'masjid_general',
      SINGLE_BANK_ID,
      sub.amount,
      member ? `${member.full_name} (${member.member_code})` : sub.donor_name || 'Committee Donor',
      member?.id || null,
      memo,
      sub.screenshot_url,
      req.user!.id,
      req.user!.fullName,
      req.user!.id,
      req.user!.fullName,
      now
    );

    postDoubleEntryForTransaction({
      transactionId: txnId,
      txnNumber,
      date: payDate,
      type: 'income',
      fundId: sub.fund_id || 'masjid_general',
      paymentMethod: 'UPI',
      amount: Number(sub.amount),
      memo,
    });

    if (isMonthlyContrib && member && months.length > 0) {
      const insPay = db.prepare(
        `INSERT INTO member_payments (id, member_id, month_key, amount, paid_date, payment_method, txn_id, txn_number, status, is_demo)
         VALUES (?, ?, ?, ?, ?, 'UPI', ?, ?, 'verified', 0)`
      );
      for (const mk of months) {
        insPay.run(crypto.randomUUID(), member.id, mk, perMonth, payDate, txnId, txnNumber);
      }
      syncContributionsDuesForAllMembers();
      db.prepare(`UPDATE reminder_logs SET status = 'stopped_paid' WHERE target_member_id = ? AND status = 'sent'`).run(member.id);
    }

    db.prepare(
      `UPDATE payment_submissions
       SET status = 'verified', verified_by = ?, verified_by_name = ?, verified_at = ?,
           linked_txn_number = ?, receipt_number = ?, bank_verified_confirmed = 1
       WHERE id = ?`
    ).run(req.user!.id, req.user!.fullName, now, txnNumber, receiptNumber, id);

    addAuditLog({
      adminId: req.user!.id,
      adminName: req.user!.fullName,
      action: 'PAYMENT_SUBMISSION_VERIFIED',
      entityType: 'payment_submissions',
      entityId: id,
      beforeData: { status: 'pending_verification', utrReference: sub.utr_reference },
      afterData: {
        status: 'verified',
        txnNumber,
        receiptNumber,
        amount: sub.amount,
        fundId: sub.fund_id,
        paymentCategory: sub.payment_category || 'monthly_contribution',
        bankVerifiedConfirmed: true,
        months,
      },
      reason: `UPI UTR ${sub.utr_reference} verified against physical Bank of India statement — Receipt ${receiptNumber}`,
    });

    addNotification({
      type: 'payment_verified',
      title: `Official Payment Receipt Issued (${receiptNumber})`,
      message: `Your ₹${Number(sub.amount).toLocaleString('en-IN')} UPI payment to ${fundRow?.name_en || sub.fund_id} (UTR: ${sub.utr_reference}) has been verified against bank statement. Receipt: ${receiptNumber}.`,
      targetRole: 'member',
      targetMemberId: sub.member_id,
    });
  });

  verifyTx();
  broadcastUpdate('submissions');
  res.json({ ok: true, status: 'verified', txnNumber, receiptNumber });
});

// ---------- COMMITTEE MEMBERS ----------
app.get('/api/committee', requireAuth, (_req, res) => {
  const rows = db
    .prepare(`SELECT * FROM committee_members ORDER BY is_active DESC, appointment_date DESC`)
    .all() as Array<any>;

  res.json({
    positions: rows.map((r) => ({
      id: r.id,
      roleKey: r.role_key,
      designationEn: r.designation_en,
      designationHi: r.designation_hi,
      designationUr: r.designation_ur,
      fullName: r.full_name,
      phone: r.phone,
      appointmentDate: r.appointment_date,
      termStart: r.term_start,
      termEnd: r.term_end,
      isActive: Boolean(r.is_active),
      updatedByName: r.updated_by_name,
      updatedAt: r.updated_at,
      isDemo: Boolean(r.is_demo),
    })),
  });
});

app.post('/api/committee', requireAuth, requireAdmin, (req, res) => {
  const { roleKey, fullName, phone, appointmentDate, termStart, termEnd, reason } = req.body || {};
  if (!roleKey || !fullName) {
    res.status(400).json({ error: 'Committee position and full name are required.' });
    return;
  }

  const labels: Record<string, [string, string, string]> = {
    sadar: ['Sadar (President)', 'सदर (अध्यक्ष)', 'صدر (پریزیڈنٹ)'],
    secretary: ['Secretary', 'सेक्रेटरी (सचिव)', 'سیکریٹری'],
    treasurer: ['Treasurer (Khazanchi)', 'खजांची (कोषाध्यक्ष)', 'خزانچی'],
    vice_president: ['Vice President (Naib Sadar)', 'नायब सदर (उपाध्यक्ष)', 'نائب صدر'],
    member: ['Executive Committee Member', 'कार्यकारिणी सदस्य', 'مجلس عاملہ رکن'],
  };
  const [en, hi, ur] = labels[roleKey] || labels.member;
  const now = new Date().toISOString();
  const id = `pos_${crypto.randomUUID().slice(0, 8)}`;

  const changeTx = db.transaction(() => {
    let previous: any = null;
    if (roleKey !== 'member') {
      previous = db
        .prepare(`SELECT * FROM committee_members WHERE role_key = ? AND is_active = 1`)
        .get(roleKey);
      if (previous) {
        db.prepare(`UPDATE committee_members SET is_active = 0, updated_by_name = ?, updated_at = ? WHERE id = ?`).run(
          req.user!.fullName,
          now,
          previous.id
        );
      }
    }

    db.prepare(
      `INSERT INTO committee_members (id, role_key, designation_en, designation_hi, designation_ur, full_name, phone, appointment_date, term_start, term_end, is_active, updated_by_name, updated_at, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0)`
    ).run(
      id,
      roleKey,
      en,
      hi,
      ur,
      String(fullName).trim(),
      String(phone || '').trim(),
      appointmentDate || getTodayISO(),
      termStart || getTodayISO(),
      termEnd || `${Number(getTodayISO().slice(0, 4)) + 2}${getTodayISO().slice(4)}`,
      req.user!.fullName,
      now
    );

    addAuditLog({
      adminId: req.user!.id,
      adminName: req.user!.fullName,
      action: 'COMMITTEE_POSITION_CHANGED',
      entityType: 'committee_members',
      entityId: id,
      beforeData: previous ? { fullName: previous.full_name, roleKey: previous.role_key } : null,
      afterData: { fullName, roleKey, termStart, termEnd },
      reason: reason || `Updated ${en} office holder`,
    });

    addNotification({
      type: 'committee_change',
      title: `Committee Update: ${en}`,
      message: `${fullName} has been appointed as ${en}${previous ? ` (succeeding ${previous.full_name})` : ''}.`,
      targetRole: 'all',
    });
  });

  changeTx();
  broadcastUpdate('committee');
  res.status(201).json({ id });
});

// ---------- MONTHLY ACCOUNT CLOSING ----------
app.get('/api/closings', requireAuth, (_req, res) => {
  const rows = db.prepare(`SELECT * FROM monthly_closings ORDER BY month_key DESC`).all() as Array<any>;
  res.json({
    closings: rows.map((r) => ({
      monthKey: r.month_key,
      isLocked: Boolean(r.is_locked),
      totalIncome: Number(r.total_income),
      totalExpense: Number(r.total_expense),
      outstandingContributions: Number(r.outstanding_contributions),
      pendingSalaries: Number(r.pending_salaries),
      closingBalance: Number(r.closing_balance),
      closedAt: r.closed_at,
      closedByName: r.closed_by_name,
      reopenedAt: r.reopened_at,
      reopenedByName: r.reopened_by_name,
      reopenReason: r.reopen_reason,
    })),
  });
});

app.post('/api/closings/close', requireAuth, requireAdmin, (req, res) => {
  const { monthKey } = req.body || {};
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
    res.status(400).json({ error: 'Valid monthKey (YYYY-MM) is required.' });
    return;
  }

  const txns = db
    .prepare(`SELECT * FROM transactions WHERE month_key = ? AND status = 'approved'`)
    .all(monthKey) as Array<any>;
  const totalIncome = txns.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const totalExpense = txns.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  const members = computeMembers(false);
  const staff = computeStaffSalaries();
  const outstandingContributions = members.reduce((s, m) => s + m.outstandingAmount, 0);
  const pendingSalaries = staff.reduce((s, st) => s + st.totalPending, 0);
  const closingBalance =
    computeBankAccounts().reduce((s, b) => s + b.currentBalance, 0) + computeCashBalance();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT OR REPLACE INTO monthly_closings (
      month_key, is_locked, total_income, total_expense, outstanding_contributions, pending_salaries,
      closing_balance, closed_at, closed_by, closed_by_name, reopened_at, reopened_by, reopened_by_name, reopen_reason
    ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`
  ).run(
    monthKey,
    totalIncome,
    totalExpense,
    outstandingContributions,
    pendingSalaries,
    closingBalance,
    now,
    req.user!.id,
    req.user!.fullName
  );

  addAuditLog({
    adminId: req.user!.id,
    adminName: req.user!.fullName,
    action: 'MONTHLY_CLOSING_LOCKED',
    entityType: 'monthly_closings',
    entityId: monthKey,
    afterData: { monthKey, totalIncome, totalExpense, closingBalance, isLocked: true },
    reason: `Monthly accounts closed and locked for ${monthKey}`,
  });

  addNotification({
    type: 'monthly_closing',
    title: `Monthly Statement Closed (${monthKey})`,
    message: `Income: ₹${totalIncome.toLocaleString('en-IN')} · Expense: ₹${totalExpense.toLocaleString('en-IN')} · Closing Balance: ₹${closingBalance.toLocaleString('en-IN')}.`,
    targetRole: 'all',
  });

  broadcastUpdate('closings');
  res.json({ ok: true });
});

app.post('/api/closings/reopen', requireAuth, requireAdmin, (req, res) => {
  if (req.user!.role !== 'admin_main') {
    res.status(403).json({
      error: 'Special Authorization Required: Only the Primary Administrator (ADMIN-01) can reopen a closed month.',
    });
    return;
  }
  const { monthKey, reason } = req.body || {};
  if (!monthKey || !reason || String(reason).trim().length < 5) {
    res.status(400).json({ error: 'Month key and a detailed reason (min 5 characters) are required to reopen.' });
    return;
  }

  const existing = db.prepare(`SELECT * FROM monthly_closings WHERE month_key = ?`).get(monthKey) as any;
  if (!existing) {
    res.status(404).json({ error: 'Monthly closing record not found.' });
    return;
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE monthly_closings SET is_locked = 0, reopened_at = ?, reopened_by = ?, reopened_by_name = ?, reopen_reason = ? WHERE month_key = ?`
  ).run(now, req.user!.id, req.user!.fullName, String(reason).trim(), monthKey);

  addAuditLog({
    adminId: req.user!.id,
    adminName: req.user!.fullName,
    action: 'MONTHLY_CLOSING_REOPENED',
    entityType: 'monthly_closings',
    entityId: monthKey,
    beforeData: { isLocked: true },
    afterData: { isLocked: false },
    reason: String(reason).trim(),
  });

  broadcastUpdate('closings');
  res.json({ ok: true });
});

// ---------- REPORTS & ANNUAL AUDIT ----------
app.get('/api/reports', requireAuth, (req, res) => {
  const periodType = (req.query.periodType as 'daily' | 'monthly' | 'quarterly' | 'yearly') || 'yearly';
  const curMonth = getCurrentMonthKey();
  const year = Number(req.query.year || curMonth.slice(0, 4));
  const month = String(req.query.month || curMonth.slice(5, 7)).padStart(2, '0');
  const quarter = Number(req.query.quarter || Math.ceil(Number(month) / 3));
  const rawDate = String(req.query.date || getTodayISO());
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : getTodayISO();

  let startDate = `${year}-01-01`;
  let endDate = `${year}-12-31`;
  let periodLabel = `Annual Financial Audit — ${year}`;

  if (periodType === 'daily') {
    startDate = safeDate;
    endDate = safeDate;
    periodLabel = `Daily Financial Report — ${safeDate}`;
  } else if (periodType === 'monthly') {
    startDate = `${year}-${month}-01`;
    endDate = `${year}-${month}-31`;
    periodLabel = `Monthly Statement — ${year}-${month}`;
  } else if (periodType === 'quarterly') {
    const startM = (quarter - 1) * 3 + 1;
    const endM = startM + 2;
    startDate = `${year}-${String(startM).padStart(2, '0')}-01`;
    endDate = `${year}-${String(endM).padStart(2, '0')}-31`;
    periodLabel = `Quarterly Financial Report — Q${quarter} ${year}`;
  }

  const rows = db
    .prepare(
      `SELECT t.*, f.name_en as fund_name, tf.name_en as target_fund_name, b.bank_name
       FROM transactions t
       LEFT JOIN funds f ON f.id = t.fund_id
       LEFT JOIN funds tf ON tf.id = t.target_fund_id
       LEFT JOIN bank_accounts b ON b.id = t.bank_account_id
       WHERE t.status = 'approved' AND t.date >= ? AND t.date <= ?
       ORDER BY t.date DESC`
    )
    .all(startDate, endDate) as Array<any>;

  const sumBy = (pred: (t: any) => boolean) => rows.filter(pred).reduce((s, t) => s + Number(t.amount), 0);

  const totalIncome = sumBy((t) => t.type === 'income');
  const totalExpense = sumBy((t) => t.type === 'expense');
  const totalMemberContributions = sumBy((t) => t.type === 'income' && Boolean(t.member_id));

  const masjidIncome = sumBy((t) => t.type === 'income' && (t.fund_id === 'masjid_general' || t.fund_id === 'juma'));
  const masjidExpense = sumBy((t) => t.type === 'expense' && (t.fund_id === 'masjid_general' || t.fund_id === 'juma'));
  const madrasaIncome = sumBy((t) => t.type === 'income' && t.fund_id === 'madrasa_general');
  const madrasaExpense = sumBy((t) => t.type === 'expense' && t.fund_id === 'madrasa_general');

  const ramadanCollections = sumBy((t) => t.type === 'income' && t.fund_id === 'ramadan');
  const zakatCollections = sumBy((t) => t.type === 'income' && t.fund_id === 'zakat');
  const fitraCollections = sumBy((t) => t.type === 'income' && t.fund_id === 'fitra');
  const sadqaCollections = sumBy((t) => t.type === 'income' && t.fund_id === 'sadqa');
  const rabiUlAwwalCollections = sumBy((t) => t.type === 'income' && t.fund_id === 'rabi_ul_awwal');
  const jumaCollections = sumBy((t) => t.type === 'income' && t.fund_id === 'juma');
  const otherDonations = sumBy((t) => t.type === 'income' && t.fund_id === 'other_donations');
  const specialDonations = sumBy((t) => t.type === 'income' && t.fund_id === 'special_donation');

  const totalSalariesPaid = sumBy(
    (t) => t.type === 'expense' && (t.category === 'Imam Salary' || t.category === "Teachers' Salaries")
  );

  const staff = computeStaffSalaries();
  const members = computeMembers(false);
  const banks = computeBankAccounts();
  const funds = computeFunds();
  const settings = getAppSettings();

  res.json({
    report: {
      periodType,
      periodLabel,
      startDate,
      endDate,
      totalIncome,
      totalExpense,
      netSurplus: totalIncome - totalExpense,
      totalMemberContributions,
      masjidIncome,
      masjidExpense,
      madrasaIncome,
      madrasaExpense,
      ramadanCollections,
      zakatCollections,
      fitraCollections,
      sadqaCollections,
      rabiUlAwwalCollections,
      jumaCollections,
      otherDonations,
      specialDonations,
      totalSalariesPaid,
      totalOutstandingSalaries: staff.reduce((s, st) => s + st.totalPending, 0),
      totalOutstandingContributions: members.reduce((s, m) => s + m.outstandingAmount, 0),
      openingBankBalance: banks.reduce((s, b) => s + b.openingBalance, 0),
      closingBankBalance: banks.reduce((s, b) => s + b.currentBalance, 0),
      closingCashBalance: computeCashBalance(),
      fundBalances: funds,
      transactions: rows.map((t) => ({
        id: t.id,
        txnNumber: t.txn_number,
        date: t.date,
        createdAt: t.created_at,
        monthKey: t.month_key,
        type: t.type,
        category: t.category,
        fundId: t.fund_id,
        fundName: t.fund_name,
        targetFundId: t.target_fund_id,
        targetFundName: t.target_fund_name,
        bankAccountId: t.bank_account_id,
        bankAccountName: t.bank_name,
        paymentMethod: t.payment_method,
        amount: Number(t.amount),
        partyName: t.party_name,
        memberId: t.member_id,
        description: t.description,
        receiptUrl: t.receipt_url,
        status: t.status,
        createdBy: t.created_by,
        createdByName: t.created_by_name,
        approvedBy: t.approved_by,
        approvedByName: t.approved_by_name,
        approvedAt: t.approved_at,
        rejectionReason: t.rejection_reason,
        reversedTxnId: t.reversed_txn_id,
        isDemo: Boolean(t.is_demo),
      })),
      isDemo: settings.isDemoDataActive,
    },
  });
});

// ---------- AUTOMATIC 5TH-OF-MONTH REMINDERS & NOTIFICATIONS ----------
app.get('/api/reminders', requireAuth, (req, res) => {
  const isAdmin = isAdminRole(req.user!.role);
  const rows = isAdmin
    ? db.prepare(`SELECT * FROM reminder_logs ORDER BY sent_at DESC LIMIT 100`).all()
    : db
        .prepare(`SELECT * FROM reminder_logs WHERE target_member_id = ? ORDER BY sent_at DESC LIMIT 50`)
        .all(req.user!.memberId || '');

  res.json({
    reminders: (rows as Array<any>).map((r) => ({
      id: r.id,
      sentAt: r.sent_at,
      sentByName: r.sent_by_name,
      channel: r.channel,
      targetMemberId: r.target_member_id,
      targetMemberName: r.target_member_name,
      targetPhone: r.target_phone,
      reminderMonthKey: r.reminder_month_key,
      pendingMonths: JSON.parse(r.pending_months_json || '[]'),
      outstandingAmount: Number(r.outstanding_amount),
      message: r.message,
      status: r.status,
    })),
  });
});

// Run the scheduled 5th-of-month reminder job (duplicate-safe!)
app.post('/api/scheduler/run-reminders', requireAuth, requireAdmin, (req, res) => {
  const { simulatedDate } = req.body || {};
  const result = runMonthlyAutomationJob({
    forceRun: !simulatedDate,
    simulatedDate: simulatedDate ? new Date(simulatedDate) : undefined,
    triggeredByAdminId: req.user!.id,
    triggeredByName: req.user!.fullName,
  });
  broadcastUpdate('reminders');
  res.json({ ok: true, result });
});

app.post('/api/reminders/send', requireAuth, requireAdmin, (req, res) => {
  const { memberId, channel, customMessage } = req.body || {};
  const ch: 'app' | 'whatsapp' | 'sms' = channel === 'whatsapp' || channel === 'sms' ? channel : 'app';
  const curMonth = getCurrentMonthKey();
  const members = computeMembers(false).filter((m) => m.status === 'active' && m.outstandingAmount > 0);
  const targets = memberId ? members.filter((m) => m.id === memberId) : members;

  if (targets.length === 0) {
    res.status(400).json({ error: 'No members with pending contributions found.' });
    return;
  }

  const now = new Date().toISOString();
  const ins = db.prepare(
    `INSERT INTO reminder_logs (id, sent_at, sent_by_name, channel, target_member_id, target_member_name, target_phone, reminder_month_key, pending_months_json, outstanding_amount, message, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent')`
  );

  for (const m of targets) {
    const msg =
      customMessage ||
      `Assalamu Alaikum ${m.fullName} (${m.memberCode}), your Masjid & Madrasa contribution of ₹${m.outstandingAmount.toLocaleString('en-IN')} is pending for ${m.pendingMonthsCount} month(s): ${m.pendingMonths.join(', ')}. Kindly deposit via S.G.N Committee Ragdih official UPI QR or committee counter.`;
    ins.run(
      crypto.randomUUID(),
      now,
      req.user!.fullName,
      ch,
      m.id,
      m.fullName,
      m.phone,
      curMonth,
      JSON.stringify(m.pendingMonths),
      m.outstandingAmount,
      msg
    );

    addNotification({
      type: 'pending_contribution',
      title: `Payment Reminder — ₹${m.outstandingAmount.toLocaleString('en-IN')} Pending`,
      message: msg,
      targetRole: 'member',
      targetMemberId: m.id,
    });
  }

  addAuditLog({
    adminId: req.user!.id,
    adminName: req.user!.fullName,
    action: 'PAYMENT_REMINDERS_SENT',
    entityType: 'reminder',
    entityId: memberId || 'bulk_unpaid',
    afterData: { count: targets.length, channel: ch },
    reason: `Sent ${ch} payment reminder to ${targets.length} unpaid member(s)`,
  });

  broadcastUpdate('reminders');
  res.json({ ok: true, count: targets.length });
});

app.get('/api/notifications', requireAuth, (req, res) => {
  const isAdmin = isAdminRole(req.user!.role);
  const rows = db.prepare(`SELECT * FROM notifications ORDER BY created_at DESC LIMIT 80`).all() as Array<any>;
  const filtered = rows.filter((n) => {
    if (isAdmin) return n.target_role === 'all' || n.target_role === 'admin' || !n.target_member_id;
    return n.target_role === 'all' || (n.target_role === 'member' && (!n.target_member_id || n.target_member_id === req.user!.memberId));
  });

  res.json({
    notifications: filtered.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      createdAt: n.created_at,
      targetRole: n.target_role,
      targetMemberId: n.target_member_id,
      isRead: Boolean(n.is_read),
    })),
  });
});

app.post('/api/notifications/announce', requireAuth, requireAdmin, (req, res) => {
  const { title, message } = req.body || {};
  if (!title || !message) {
    res.status(400).json({ error: 'Announcement title and message are required.' });
    return;
  }
  addNotification({
    type: 'announcement',
    title: String(title).trim(),
    message: String(message).trim(),
    targetRole: 'all',
  });
  addAuditLog({
    adminId: req.user!.id,
    adminName: req.user!.fullName,
    action: 'ANNOUNCEMENT_POSTED',
    entityType: 'notifications',
    entityId: crypto.randomUUID().slice(0, 8),
    afterData: { title, message },
    reason: 'Committee announcement broadcast to all members',
  });
  broadcastUpdate('notifications');
  res.status(201).json({ ok: true });
});

app.post('/api/notifications/mark-read', requireAuth, (_req, res) => {
  db.prepare(`UPDATE notifications SET is_read = 1`).run();
  res.json({ ok: true });
});

// ---------- AUDIT LOG ----------
app.get('/api/audit-logs', requireAuth, (_req, res) => {
  const rows = db.prepare(`SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 200`).all() as Array<any>;
  res.json({
    logs: rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      adminId: r.admin_id,
      adminName: r.admin_name,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      beforeData: r.before_data,
      afterData: r.after_data,
      reason: r.reason,
    })),
  });
});

// ---------- APP SETTINGS & BACKUPS ----------
app.get('/api/settings', requireAuth, (_req, res) => {
  res.json({ settings: getAppSettings() });
});

app.put('/api/settings', requireAuth, requireAdmin, (req, res) => {
  const before = getAppSettings();
  const {
    committeeName,
    committeeAddress,
    appLogoUrl,
    defaultLanguage,
    memberLoginEnabled,
    autoBackupEnabled,
    dualApprovalEnabled,
    dualApprovalLimit,
    reminderDayOfMonth,
    reminderFrequency,
    defaultMonthlyContribution,
    hideMemberPhonesForMembers,
  } = req.body || {};

  const upsert = db.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)`);
  if (committeeName !== undefined && String(committeeName).trim()) {
    upsert.run('committeeName', String(committeeName).trim().slice(0, 200));
  }
  if (committeeAddress !== undefined && String(committeeAddress).trim()) {
    upsert.run('committeeAddress', String(committeeAddress).trim().slice(0, 300));
  }
  if (appLogoUrl !== undefined) {
    const candidateLogo = String(appLogoUrl || '').trim();
    if (candidateLogo && !isSafeMediaUrl(candidateLogo)) {
      res.status(400).json({ error: 'Invalid logo image URL. Please upload a PNG, JPG, or WebP logo.' });
      return;
    }
    if (candidateLogo) upsert.run('appLogoUrl', candidateLogo.slice(0, 500));
  }
  if (defaultLanguage !== undefined && ['en', 'hi', 'ur'].includes(String(defaultLanguage))) {
    upsert.run('defaultLanguage', String(defaultLanguage));
  }
  if (memberLoginEnabled !== undefined) {
    upsert.run('memberLoginEnabled', String(Boolean(memberLoginEnabled)));
  }
  if (autoBackupEnabled !== undefined) {
    upsert.run('autoBackupEnabled', String(Boolean(autoBackupEnabled)));
  }
  if (dualApprovalEnabled !== undefined) upsert.run('dualApprovalEnabled', String(Boolean(dualApprovalEnabled)));
  if (dualApprovalLimit !== undefined) upsert.run('dualApprovalLimit', String(Math.max(500, Number(dualApprovalLimit))));
  if (reminderDayOfMonth !== undefined)
    upsert.run('reminderDayOfMonth', String(Math.min(28, Math.max(1, Number(reminderDayOfMonth)))));
  if (reminderFrequency !== undefined) upsert.run('reminderFrequency', String(reminderFrequency));
  if (defaultMonthlyContribution !== undefined)
    upsert.run('defaultMonthlyContribution', String(Math.max(50, Number(defaultMonthlyContribution))));
  if (hideMemberPhonesForMembers !== undefined)
    upsert.run('hideMemberPhonesForMembers', String(Boolean(hideMemberPhonesForMembers)));

  const after = getAppSettings();
  addAuditLog({
    adminId: req.user!.id,
    adminName: req.user!.fullName,
    action: 'SETTINGS_UPDATED',
    entityType: 'app_settings',
    entityId: 'app_settings',
    beforeData: before,
    afterData: after,
    reason: 'Committee application settings updated',
  });

  broadcastUpdate('settings');
  res.json({ settings: after });
});

app.post('/api/backup/snapshot', requireAuth, requireAdmin, (req, res) => {
  const b = createDatabaseBackup();
  addAuditLog({
    adminId: req.user!.id,
    adminName: req.user!.fullName,
    action: 'DATABASE_BACKUP_CREATED',
    entityType: 'backup',
    entityId: b.fileName,
    afterData: b,
    reason: 'Manual database backup snapshot created',
  });
  res.json({ backup: b, backups: listBackups() });
});

app.get('/api/backup/export-json', requireAuth, requireAdmin, (_req, res) => {
  const snapshot = {
    exportedAt: new Date().toISOString(),
    app_settings: getAppSettings(),
    funds: computeFunds(),
    bank_accounts: computeBankAccounts(),
    reconciliation: computeDoubleEntryTrialBalance(),
    members: computeMembers(false),
    contributions: db.prepare(`SELECT * FROM contributions ORDER BY month_key DESC`).all(),
    salaries: computeStaffSalaries(),
    transactions: db.prepare(`SELECT * FROM transactions ORDER BY date DESC`).all(),
    approvals: db.prepare(`SELECT * FROM approvals ORDER BY requested_at DESC`).all(),
    payment_submissions: db.prepare(`SELECT * FROM payment_submissions ORDER BY submitted_at DESC`).all(),
    committee_members: db.prepare(`SELECT * FROM committee_members`).all(),
    monthly_closings: db.prepare(`SELECT * FROM monthly_closings`).all(),
    notifications: db.prepare(`SELECT * FROM notifications ORDER BY created_at DESC`).all(),
    audit_logs: db.prepare(`SELECT * FROM audit_logs ORDER BY timestamp DESC`).all(),
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="sgn_committee_backup_${getTodayISO()}.json"`);
  res.send(JSON.stringify(snapshot, null, 2));
});

app.post('/api/admin/data-mode', requireAuth, requireAdmin, (req, res) => {
  if (req.user!.role !== 'admin_main') {
    res.status(403).json({ error: 'Only Primary Administrator (ADMIN-01) can switch between Demo and Clean Live books.' });
    return;
  }
  const { mode } = req.body || {};
  createDatabaseBackup();

  if (mode === 'reset_demo') {
    seedInitialDemoData(true);
    broadcastUpdate('all');
    res.json({ ok: true, mode: 'demo' });
    return;
  }

  if (mode === 'start_live_clean') {
    db.exec(`
      DELETE FROM notifications;
      DELETE FROM reminder_logs;
      DELETE FROM monthly_closings;
      DELETE FROM payment_submissions;
      DELETE FROM salaries;
      DELETE FROM staff;
      DELETE FROM approvals;
      DELETE FROM double_entry_lines;
      DELETE FROM member_payments;
      DELETE FROM contributions;
      DELETE FROM transactions;
      DELETE FROM members;
      DELETE FROM users WHERE role = 'member';
    `);
    db.prepare(`UPDATE funds SET opening_balance = 0`).run();
    db.prepare(`UPDATE bank_accounts SET opening_balance = 0, is_demo = 0`).run();
    db.prepare(`UPDATE committee_members SET is_demo = 0`).run();
    db.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('openingCashBalance', '0')`).run();
    db.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('isDemoDataActive', 'false')`).run();

    addAuditLog({
      adminId: req.user!.id,
      adminName: req.user!.fullName,
      action: 'SWITCHED_TO_LIVE_MODE',
      entityType: 'system',
      entityId: 'live_books',
      afterData: { isDemoDataActive: false },
      reason: 'Cleared demo records (backup saved automatically) and initialized Live Committee Accounts',
    });

    broadcastUpdate('all');
    res.json({ ok: true, mode: 'live' });
    return;
  }

  res.status(400).json({ error: 'Invalid mode.' });
});

// ---------- VITE / STATIC SERVING ----------
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(process.cwd(), 'dist');

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`S.G.N Committee Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
