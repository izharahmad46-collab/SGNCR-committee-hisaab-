import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const BACKUP_DIR = path.resolve(DATA_DIR, 'backups');
export const UPLOADS_DIR = path.resolve(DATA_DIR, 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export const DB_PATH = path.resolve(DATA_DIR, 'sgn_committee.db');
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const COMMITTEE_NAME = 'S.G.N Committee Noori Jama Masjid & Madarsa Anwarool Uloom';
export const COMMITTEE_ADDRESS = 'At Ragdih, PO Chalkusha, District Hazaribagh, Jharkhand – 825109, India.';
export const SINGLE_BANK_ID = 'bank_sbi_committee';
export const OFFICIAL_BOI_BANK_NAME = 'Bank of India';
export const OFFICIAL_BOI_ACCOUNT_NAME = 'MADRASA ANWAROOL ULOOM RAGDIH';
export const OFFICIAL_BOI_UPI_ID = 'boim-617606410026@boi';
export const OFFICIAL_BOI_QR_URL = '/assets/aistudio/IMG-20261120-WA0010_4f735eaa.jpg';
export const DEFAULT_DUAL_APPROVAL_LIMIT = 5000;
export const DEFAULT_REMINDER_DAY = 5;

export function getCurrentMonthKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function getTodayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function listMonthsBetween(startDateISO: string, endMonthKey: string): string[] {
  const startYear = Number(startDateISO.slice(0, 4));
  const startMonth = Number(startDateISO.slice(5, 7));
  const endYear = Number(endMonthKey.slice(0, 4));
  const endMonth = Number(endMonthKey.slice(5, 7));
  if (!startYear || !startMonth || !endYear || !endMonth) return [];
  const months: string[] = [];
  let y = startYear;
  let m = startMonth;
  let guard = 0;
  while ((y < endYear || (y === endYear && m <= endMonth)) && guard < 120) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    guard += 1;
  }
  return months;
}

export function shiftMonthKey(monthKey: string, deltaMonths: number): string {
  const y = Number(monthKey.slice(0, 4));
  const m = Number(monthKey.slice(5, 7));
  const d = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin_main', 'admin_secondary', 'member')),
      member_id TEXT,
      phone TEXT DEFAULT '',
      two_factor_enabled INTEGER DEFAULT 0,
      two_factor_secret TEXT DEFAULT '123456',
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      ip TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS login_activity (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      username TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      ip TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS funds (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name_en TEXT NOT NULL,
      name_hi TEXT NOT NULL,
      name_ur TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('masjid', 'madrasa', 'restricted', 'general')),
      is_restricted INTEGER DEFAULT 0,
      restricted_rule TEXT DEFAULT '',
      opening_balance REAL NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS bank_accounts (
      id TEXT PRIMARY KEY,
      bank_name TEXT NOT NULL,
      account_name TEXT NOT NULL,
      account_number TEXT NOT NULL,
      ifsc TEXT NOT NULL,
      branch TEXT NOT NULL,
      upi_id TEXT NOT NULL,
      qr_code_url TEXT NOT NULL DEFAULT '',
      fund_scope TEXT NOT NULL,
      opening_balance REAL NOT NULL DEFAULT 0,
      instructions TEXT NOT NULL DEFAULT '',
      is_active INTEGER DEFAULT 1,
      is_demo INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      member_code TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      village TEXT NOT NULL,
      monthly_amount REAL NOT NULL DEFAULT 500,
      joining_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'inactive')) DEFAULT 'active',
      is_demo INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS contributions (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      month_key TEXT NOT NULL,
      expected_amount REAL NOT NULL,
      paid_amount REAL NOT NULL DEFAULT 0,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('unpaid', 'partial', 'paid', 'overdue')) DEFAULT 'unpaid',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(member_id, month_key),
      FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      txn_number TEXT UNIQUE NOT NULL,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      month_key TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income', 'expense', 'transfer', 'reversal')),
      category TEXT NOT NULL,
      fund_id TEXT NOT NULL,
      target_fund_id TEXT,
      bank_account_id TEXT,
      payment_method TEXT NOT NULL CHECK(payment_method IN ('Cash', 'UPI', 'Bank')),
      amount REAL NOT NULL CHECK(amount > 0),
      party_name TEXT NOT NULL,
      member_id TEXT,
      description TEXT NOT NULL DEFAULT '',
      receipt_url TEXT,
      status TEXT NOT NULL CHECK(status IN ('approved', 'pending_approval', 'rejected', 'reversed')) DEFAULT 'approved',
      created_by TEXT NOT NULL,
      created_by_name TEXT NOT NULL,
      approved_by TEXT,
      approved_by_name TEXT,
      approved_at TEXT,
      rejection_reason TEXT,
      reversed_txn_id TEXT,
      is_demo INTEGER DEFAULT 0,
      FOREIGN KEY(fund_id) REFERENCES funds(id)
    );

    CREATE TABLE IF NOT EXISTS double_entry_lines (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL,
      txn_number TEXT NOT NULL,
      entry_date TEXT NOT NULL,
      account_code TEXT NOT NULL,
      account_name TEXT NOT NULL,
      account_type TEXT NOT NULL CHECK(account_type IN ('asset', 'fund_equity', 'income', 'expense')),
      debit REAL NOT NULL DEFAULT 0,
      credit REAL NOT NULL DEFAULT 0,
      memo TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(transaction_id) REFERENCES transactions(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      transaction_id TEXT UNIQUE NOT NULL,
      txn_number TEXT NOT NULL,
      amount REAL NOT NULL,
      threshold_limit REAL NOT NULL,
      requested_by TEXT NOT NULL,
      requested_by_name TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
      decided_by TEXT,
      decided_by_name TEXT,
      decided_at TEXT,
      decision_reason TEXT,
      FOREIGN KEY(transaction_id) REFERENCES transactions(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS member_payments (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      month_key TEXT NOT NULL,
      amount REAL NOT NULL,
      paid_date TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      txn_id TEXT,
      txn_number TEXT,
      status TEXT NOT NULL CHECK(status IN ('verified', 'reversed')) DEFAULT 'verified',
      is_demo INTEGER DEFAULT 0,
      FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      designation TEXT NOT NULL,
      institution TEXT NOT NULL CHECK(institution IN ('masjid', 'madrasa')),
      fund_id TEXT NOT NULL,
      monthly_salary REAL NOT NULL,
      joining_date TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('active', 'inactive')) DEFAULT 'active',
      is_demo INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS salaries (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL,
      month_key TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_date TEXT NOT NULL,
      payment_method TEXT NOT NULL CHECK(payment_method IN ('Cash', 'UPI', 'Bank')),
      reference TEXT NOT NULL DEFAULT '',
      txn_id TEXT,
      txn_number TEXT,
      recorded_by_name TEXT NOT NULL,
      is_demo INTEGER DEFAULT 0,
      FOREIGN KEY(staff_id) REFERENCES staff(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payment_submissions (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      donor_name TEXT NOT NULL DEFAULT '',
      payment_category TEXT NOT NULL CHECK(payment_category IN ('monthly_contribution', 'donation')) DEFAULT 'monthly_contribution',
      amount REAL NOT NULL,
      months_json TEXT NOT NULL,
      bank_account_id TEXT,
      fund_id TEXT NOT NULL DEFAULT 'masjid_general',
      utr_reference TEXT NOT NULL,
      screenshot_url TEXT NOT NULL,
      notes TEXT DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('pending_verification', 'verified', 'rejected')) DEFAULT 'pending_verification',
      submitted_at TEXT NOT NULL,
      verified_by TEXT,
      verified_by_name TEXT,
      verified_at TEXT,
      rejection_note TEXT,
      linked_txn_number TEXT,
      receipt_number TEXT,
      bank_verified_confirmed INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER DEFAULT 0,
      FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS committee_members (
      id TEXT PRIMARY KEY,
      role_key TEXT NOT NULL CHECK(role_key IN ('sadar', 'secretary', 'treasurer', 'vice_president', 'member')),
      designation_en TEXT NOT NULL,
      designation_hi TEXT NOT NULL,
      designation_ur TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      appointment_date TEXT NOT NULL,
      term_start TEXT NOT NULL,
      term_end TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_by_name TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      is_demo INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS monthly_closings (
      month_key TEXT PRIMARY KEY,
      is_locked INTEGER NOT NULL DEFAULT 1,
      total_income REAL NOT NULL DEFAULT 0,
      total_expense REAL NOT NULL DEFAULT 0,
      outstanding_contributions REAL NOT NULL DEFAULT 0,
      pending_salaries REAL NOT NULL DEFAULT 0,
      closing_balance REAL NOT NULL DEFAULT 0,
      closed_at TEXT,
      closed_by TEXT,
      closed_by_name TEXT,
      reopened_at TEXT,
      reopened_by TEXT,
      reopened_by_name TEXT,
      reopen_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      admin_id TEXT NOT NULL,
      admin_name TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      before_data TEXT,
      after_data TEXT,
      reason TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS reminder_logs (
      id TEXT PRIMARY KEY,
      sent_at TEXT NOT NULL,
      sent_by_name TEXT NOT NULL,
      channel TEXT NOT NULL CHECK(channel IN ('app', 'whatsapp', 'sms')),
      target_member_id TEXT NOT NULL,
      target_member_name TEXT NOT NULL,
      target_phone TEXT NOT NULL DEFAULT '',
      reminder_month_key TEXT NOT NULL DEFAULT '',
      pending_months_json TEXT NOT NULL,
      outstanding_amount REAL NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent'
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      target_role TEXT NOT NULL CHECK(target_role IN ('all', 'admin', 'member')) DEFAULT 'all',
      target_member_id TEXT,
      is_read INTEGER NOT NULL DEFAULT 0
    );

    -- Enforce database-level immutability on audit_logs (never silently overwrite or delete)
    CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_update
    BEFORE UPDATE ON audit_logs
    BEGIN
      SELECT RAISE(ABORT, 'Audit logs are immutable and cannot be modified');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_delete
    BEFORE DELETE ON audit_logs
    BEGIN
      SELECT RAISE(ABORT, 'Audit logs are immutable and cannot be deleted');
    END;

    -- Enforce maximum 2 authorized admins at the database level (INSERT & UPDATE)
    CREATE TRIGGER IF NOT EXISTS trg_max_two_admins
    BEFORE INSERT ON users
    WHEN NEW.role IN ('admin_main', 'admin_secondary')
    BEGIN
      SELECT CASE
        WHEN (SELECT COUNT(*) FROM users WHERE role IN ('admin_main', 'admin_secondary')) >= 2
        THEN RAISE(ABORT, 'Maximum of two authorized administrators (Primary Admin and Secondary Admin) is strictly enforced')
      END;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_max_two_admins_update
    BEFORE UPDATE OF role ON users
    WHEN NEW.role IN ('admin_main', 'admin_secondary') AND OLD.role NOT IN ('admin_main', 'admin_secondary')
    BEGIN
      SELECT CASE
        WHEN (SELECT COUNT(*) FROM users WHERE role IN ('admin_main', 'admin_secondary')) >= 2
        THEN RAISE(ABORT, 'Maximum of two authorized administrators (Primary Admin and Secondary Admin) is strictly enforced')
      END;
    END;
  `);

  // Safe schema upgrades for existing databases (strictly additive — preserves all existing records)
  const remCols = db.prepare(`PRAGMA table_info(reminder_logs)`).all() as Array<{ name: string }>;
  if (!remCols.some((c) => c.name === 'reminder_month_key')) {
    db.exec(`ALTER TABLE reminder_logs ADD COLUMN reminder_month_key TEXT NOT NULL DEFAULT ''`);
  }

  const fundCols = db.prepare(`PRAGMA table_info(funds)`).all() as Array<{ name: string }>;
  if (!fundCols.some((c) => c.name === 'description')) {
    db.exec(`ALTER TABLE funds ADD COLUMN description TEXT NOT NULL DEFAULT ''`);
  }
  if (!fundCols.some((c) => c.name === 'is_active')) {
    db.exec(`ALTER TABLE funds ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`);
  }

  const bankCols = db.prepare(`PRAGMA table_info(bank_accounts)`).all() as Array<{ name: string }>;
  if (!bankCols.some((c) => c.name === 'qr_code_url')) {
    db.exec(`ALTER TABLE bank_accounts ADD COLUMN qr_code_url TEXT NOT NULL DEFAULT ''`);
  }
  // Upgrade initial placeholder SBI UPI to the official uploaded Bank of India QR standee if untouched
  db.prepare(
    `UPDATE bank_accounts
     SET bank_name = ?, account_name = ?, upi_id = ?, qr_code_url = ?
     WHERE id = ? AND (upi_id = 'sgncommittee.ragdih@sbi' OR qr_code_url = '')`
  ).run(OFFICIAL_BOI_BANK_NAME, OFFICIAL_BOI_ACCOUNT_NAME, OFFICIAL_BOI_UPI_ID, OFFICIAL_BOI_QR_URL, SINGLE_BANK_ID);

  const subCols = db.prepare(`PRAGMA table_info(payment_submissions)`).all() as Array<{ name: string }>;
  if (!subCols.some((c) => c.name === 'payment_category')) {
    db.exec(`ALTER TABLE payment_submissions ADD COLUMN payment_category TEXT NOT NULL DEFAULT 'monthly_contribution'`);
  }
  if (!subCols.some((c) => c.name === 'donor_name')) {
    db.exec(`ALTER TABLE payment_submissions ADD COLUMN donor_name TEXT NOT NULL DEFAULT ''`);
  }
  if (!subCols.some((c) => c.name === 'receipt_number')) {
    db.exec(`ALTER TABLE payment_submissions ADD COLUMN receipt_number TEXT`);
  }
  if (!subCols.some((c) => c.name === 'bank_verified_confirmed')) {
    db.exec(`ALTER TABLE payment_submissions ADD COLUMN bank_verified_confirmed INTEGER NOT NULL DEFAULT 0`);
  }
}

let txnCounterCache = 0;

export function generateTxnNumber(dateStr?: string): string {
  const year = (dateStr || getTodayISO()).slice(0, 4);
  if (txnCounterCache === 0) {
    const row = db.prepare(`SELECT COUNT(*) as c FROM transactions`).get() as { c: number };
    txnCounterCache = row.c;
  }
  txnCounterCache += 1;
  return `SGN-${year}-${String(txnCounterCache).padStart(4, '0')}`;
}

export function generateReceiptNumber(dateStr?: string): string {
  const year = (dateStr || getTodayISO()).slice(0, 4);
  const row = db
    .prepare(`SELECT COUNT(*) as c FROM payment_submissions WHERE receipt_number IS NOT NULL AND receipt_number != ''`)
    .get() as { c: number };
  return `RCPT-${year}-${String((row?.c || 0) + 1).padStart(4, '0')}`;
}

export function addAuditLog(params: {
  adminId: string;
  adminName: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeData?: unknown;
  afterData?: unknown;
  reason?: string;
}): void {
  db.prepare(
    `INSERT INTO audit_logs (id, timestamp, admin_id, admin_name, action, entity_type, entity_id, before_data, after_data, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    new Date().toISOString(),
    params.adminId,
    params.adminName,
    params.action,
    params.entityType,
    params.entityId,
    params.beforeData !== undefined ? JSON.stringify(params.beforeData) : null,
    params.afterData !== undefined ? JSON.stringify(params.afterData) : null,
    params.reason || ''
  );
}

export function addNotification(params: {
  type: string;
  title: string;
  message: string;
  targetRole?: 'all' | 'admin' | 'member';
  targetMemberId?: string | null;
}): void {
  db.prepare(
    `INSERT INTO notifications (id, type, title, message, created_at, target_role, target_member_id, is_read)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(
    crypto.randomUUID(),
    params.type,
    params.title,
    params.message,
    new Date().toISOString(),
    params.targetRole || 'all',
    params.targetMemberId || null
  );
}

export function postDoubleEntryForTransaction(params: {
  transactionId: string;
  txnNumber: string;
  date: string;
  type: 'income' | 'expense' | 'transfer' | 'reversal';
  fundId: string;
  targetFundId?: string | null;
  paymentMethod: 'Cash' | 'UPI' | 'Bank';
  amount: number;
  memo: string;
  originalType?: 'income' | 'expense' | 'transfer';
}): void {
  const now = new Date().toISOString();
  const ins = db.prepare(
    `INSERT INTO double_entry_lines (id, transaction_id, txn_number, entry_date, account_code, account_name, account_type, debit, credit, memo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const assetCode = params.paymentMethod === 'Cash' ? 'ASSET:CASH' : `ASSET:${SINGLE_BANK_ID}`;
  const assetName = params.paymentMethod === 'Cash' ? 'Committee Cash-in-Hand' : 'SBI Committee Physical Bank Account';
  const fundCode = `FUND:${params.fundId}`;
  const fundRow = db.prepare(`SELECT name_en FROM funds WHERE id = ?`).get(params.fundId) as { name_en: string } | undefined;
  const fundName = fundRow?.name_en || params.fundId;

  if (params.type === 'income') {
    ins.run(crypto.randomUUID(), params.transactionId, params.txnNumber, params.date, assetCode, assetName, 'asset', params.amount, 0, params.memo, now);
    ins.run(crypto.randomUUID(), params.transactionId, params.txnNumber, params.date, fundCode, fundName, 'fund_equity', 0, params.amount, params.memo, now);
  } else if (params.type === 'expense') {
    ins.run(crypto.randomUUID(), params.transactionId, params.txnNumber, params.date, fundCode, fundName, 'fund_equity', params.amount, 0, params.memo, now);
    ins.run(crypto.randomUUID(), params.transactionId, params.txnNumber, params.date, assetCode, assetName, 'asset', 0, params.amount, params.memo, now);
  } else if (params.type === 'transfer' && params.targetFundId) {
    const targetRow = db.prepare(`SELECT name_en FROM funds WHERE id = ?`).get(params.targetFundId) as { name_en: string } | undefined;
    const targetName = targetRow?.name_en || params.targetFundId;
    ins.run(crypto.randomUUID(), params.transactionId, params.txnNumber, params.date, fundCode, fundName, 'fund_equity', params.amount, 0, params.memo, now);
    ins.run(crypto.randomUUID(), params.transactionId, params.txnNumber, params.date, `FUND:${params.targetFundId}`, targetName, 'fund_equity', 0, params.amount, params.memo, now);
  } else if (params.type === 'reversal') {
    // Exact inverse of original approved transaction
    if (params.originalType === 'income') {
      ins.run(crypto.randomUUID(), params.transactionId, params.txnNumber, params.date, fundCode, fundName, 'fund_equity', params.amount, 0, params.memo, now);
      ins.run(crypto.randomUUID(), params.transactionId, params.txnNumber, params.date, assetCode, assetName, 'asset', 0, params.amount, params.memo, now);
    } else if (params.originalType === 'expense') {
      ins.run(crypto.randomUUID(), params.transactionId, params.txnNumber, params.date, assetCode, assetName, 'asset', params.amount, 0, params.memo, now);
      ins.run(crypto.randomUUID(), params.transactionId, params.txnNumber, params.date, fundCode, fundName, 'fund_equity', 0, params.amount, params.memo, now);
    } else if (params.originalType === 'transfer' && params.targetFundId) {
      const targetRow = db.prepare(`SELECT name_en FROM funds WHERE id = ?`).get(params.targetFundId) as { name_en: string } | undefined;
      const targetName = targetRow?.name_en || params.targetFundId;
      ins.run(crypto.randomUUID(), params.transactionId, params.txnNumber, params.date, `FUND:${params.targetFundId}`, targetName, 'fund_equity', params.amount, 0, params.memo, now);
      ins.run(crypto.randomUUID(), params.transactionId, params.txnNumber, params.date, fundCode, fundName, 'fund_equity', 0, params.amount, params.memo, now);
    }
  }
}

export const TEN_FUNDS = [
  {
    id: 'masjid_general',
    code: 'MASJID',
    name_en: 'Masjid General Fund',
    name_hi: 'मस्जिद सामान्य फंड',
    name_ur: 'مسجد جنرل فنڈ',
    scope: 'masjid',
    is_restricted: 0,
    restricted_rule: 'Virtual ledger for Noori Jama Masjid maintenance, utilities, Imam salary, and construction.',
    opening_balance: 48000,
    sort_order: 1,
  },
  {
    id: 'madrasa_general',
    code: 'MADRASA',
    name_en: 'Madrasa General Fund',
    name_hi: 'मदरसा सामान्य फंड',
    name_ur: 'مدرسہ جنرل فنڈ',
    scope: 'madrasa',
    is_restricted: 0,
    restricted_rule: 'Virtual ledger for Madarsa Anwarool Uloom teachers salaries, student food, books, and upkeep.',
    opening_balance: 62000,
    sort_order: 2,
  },
  {
    id: 'ramadan',
    code: 'RAMADAN',
    name_en: 'Ramadan Fund',
    name_hi: 'रमज़ान फंड',
    name_ur: 'رمضان فنڈ',
    scope: 'restricted',
    is_restricted: 1,
    restricted_rule: 'Restricted virtual ledger strictly for Ramadan Iftar, Taraweeh, Sahri, and Madrasa Ramadan aid.',
    opening_balance: 24000,
    sort_order: 3,
  },
  {
    id: 'fitra',
    code: 'FITRA',
    name_en: 'Fitra Fund',
    name_hi: 'फ़ितरा फंड',
    name_ur: 'فطرہ فنڈ',
    scope: 'restricted',
    is_restricted: 1,
    restricted_rule: 'Restricted Shariah virtual ledger: strictly for eligible poor families & eligible hostel students.',
    opening_balance: 14500,
    sort_order: 4,
  },
  {
    id: 'zakat',
    code: 'ZAKAT',
    name_en: 'Zakat Fund',
    name_hi: 'ज़कात फंड',
    name_ur: 'زکوٰۃ فنڈ',
    scope: 'restricted',
    is_restricted: 1,
    restricted_rule: 'Strictly restricted Shariah Zakat (Tamleek) virtual ledger — never mix with Masjid construction or utilities.',
    opening_balance: 31000,
    sort_order: 5,
  },
  {
    id: 'sadqa',
    code: 'SADQA',
    name_en: 'Sadqa Fund',
    name_hi: 'सदक़ा फंड',
    name_ur: 'صدقہ فنڈ',
    scope: 'restricted',
    is_restricted: 1,
    restricted_rule: 'Dedicated virtual ledger for charitable relief, indigent support, and student welfare.',
    opening_balance: 11500,
    sort_order: 6,
  },
  {
    id: 'rabi_ul_awwal',
    code: 'RABI',
    name_en: 'Rabi-ul-Awwal Fund',
    name_hi: 'रबी-उल-अव्वल फंड',
    name_ur: 'ربیع الاول فنڈ',
    scope: 'restricted',
    is_restricted: 1,
    restricted_rule: 'Dedicated virtual ledger for Eid Milad-un-Nabi Jalsa, lighting, and community Langar.',
    opening_balance: 9000,
    sort_order: 7,
  },
  {
    id: 'juma',
    code: 'JUMA',
    name_en: 'Juma Collection Fund',
    name_hi: 'जुमा कलेक्शन फंड',
    name_ur: 'جمعہ کلیکشن فنڈ',
    scope: 'masjid',
    is_restricted: 0,
    restricted_rule: 'Weekly Friday prayer collections virtual ledger for Noori Jama Masjid operations.',
    opening_balance: 18500,
    sort_order: 8,
  },
  {
    id: 'other_donations',
    code: 'OTHER',
    name_en: 'Other Donations',
    name_hi: 'अन्य दान फंड',
    name_ur: 'دیگر عطیات فنڈ',
    scope: 'general',
    is_restricted: 0,
    restricted_rule: 'General unrestricted community donations virtual ledger.',
    opening_balance: 7500,
    sort_order: 9,
  },
  {
    id: 'special_donation',
    code: 'SPECIAL',
    name_en: 'Special Donation Fund',
    name_hi: 'विशेष दान फंड',
    name_ur: 'خصوصی عطیہ فنڈ',
    scope: 'general',
    is_restricted: 1,
    restricted_rule: 'Special project virtual ledger (water cooler, solar backup, classroom expansion).',
    opening_balance: 19000,
    sort_order: 10,
  },
] as const;

export function syncContributionsDuesForAllMembers(upToMonthKey?: string): { generatedCount: number } {
  const endMonth = upToMonthKey || getCurrentMonthKey();
  const today = getTodayISO();
  const now = new Date().toISOString();
  const activeMembers = db.prepare(`SELECT * FROM members WHERE status = 'active'`).all() as Array<any>;

  const insertDue = db.prepare(
    `INSERT OR IGNORE INTO contributions (id, member_id, month_key, expected_amount, paid_amount, due_date, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, 'unpaid', ?, ?)`
  );

  let generatedCount = 0;

  const tx = db.transaction(() => {
    for (const m of activeMembers) {
      const months = listMonthsBetween(m.joining_date, endMonth);
      for (const mk of months) {
        const dueDate = `${mk}-${String(DEFAULT_REMINDER_DAY).padStart(2, '0')}`;
        const info = insertDue.run(crypto.randomUUID(), m.id, mk, Number(m.monthly_amount), dueDate, now, now);
        if (info.changes > 0) generatedCount += 1;
      }
    }

    // Recompute paid_amount and status for every contribution row from verified member_payments
    const allContribs = db.prepare(`SELECT * FROM contributions`).all() as Array<any>;
    const sumStmt = db.prepare(
      `SELECT COALESCE(SUM(amount), 0) as total FROM member_payments WHERE member_id = ? AND month_key = ? AND status = 'verified'`
    );
    const updStmt = db.prepare(
      `UPDATE contributions SET paid_amount = ?, status = ?, updated_at = ? WHERE id = ?`
    );

    for (const c of allContribs) {
      const paid = Number((sumStmt.get(c.member_id, c.month_key) as { total: number }).total || 0);
      const expected = Number(c.expected_amount);
      let status: 'paid' | 'partial' | 'unpaid' | 'overdue' = 'unpaid';
      if (paid >= expected) status = 'paid';
      else if (paid > 0) status = 'partial';
      else if (today > c.due_date) status = 'overdue';
      else status = 'unpaid';

      if (paid !== Number(c.paid_amount) || status !== c.status) {
        updStmt.run(paid, status, now, c.id);
      }
    }
  });

  tx();
  return { generatedCount };
}

export function seedInitialDemoData(forceReset = false): void {
  // Check if DB has migrated schema version; if old 2-bank/₹10k schema existed, migrate cleanly once
  const settingsCount = (db.prepare(`SELECT COUNT(*) as c FROM app_settings`).get() as { c: number }).c;
  const shouldBootstrap = settingsCount === 0 || forceReset;

  if (!shouldBootstrap) {
    // Always make sure monthly dues exist for current month without duplicates
    syncContributionsDuesForAllMembers();
    return;
  }

  // Wipe non-immutable tables cleanly when forceReset or fresh migration
  db.exec(`
    DELETE FROM notifications;
    DELETE FROM reminder_logs;
    DELETE FROM monthly_closings;
    DELETE FROM committee_members;
    DELETE FROM payment_submissions;
    DELETE FROM salaries;
    DELETE FROM staff;
    DELETE FROM approvals;
    DELETE FROM double_entry_lines;
    DELETE FROM member_payments;
    DELETE FROM contributions;
    DELETE FROM transactions;
    DELETE FROM members;
    DELETE FROM bank_accounts;
    DELETE FROM funds;
    DELETE FROM sessions;
    DELETE FROM users;
    DELETE FROM app_settings;
  `);
  txnCounterCache = 0;

  const now = new Date().toISOString();
  const curMonth = getCurrentMonthKey();
  const mMinus1 = shiftMonthKey(curMonth, -1);
  const mMinus2 = shiftMonthKey(curMonth, -2);
  const mMinus3 = shiftMonthKey(curMonth, -3);

  // Final Configuration Settings: ₹5,000 approval limit, 5th of month reminders, 1 physical bank account
  const defaultSettings: Record<string, string> = {
    committeeName: COMMITTEE_NAME,
    committeeAddress: COMMITTEE_ADDRESS,
    dualApprovalEnabled: 'true',
    dualApprovalLimit: String(DEFAULT_DUAL_APPROVAL_LIMIT),
    reminderDayOfMonth: String(DEFAULT_REMINDER_DAY),
    reminderFrequency: 'monthly',
    defaultMonthlyContribution: '500',
    hideMemberPhonesForMembers: 'false',
    isDemoDataActive: 'true',
    openingCashBalance: '30000',
    lastBackupAt: now,
  };
  const upsertSetting = db.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)`);
  for (const [k, v] of Object.entries(defaultSettings)) {
    upsertSetting.run(k, v);
  }

  // 10 Separate Virtual Fund Ledgers (Opening sum = ₹2,45,000 == Physical Bank ₹2,15,000 + Cash ₹30,000)
  const insertFund = db.prepare(
    `INSERT INTO funds (id, code, name_en, name_hi, name_ur, scope, is_restricted, restricted_rule, opening_balance, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const f of TEN_FUNDS) {
    insertFund.run(
      f.id,
      f.code,
      f.name_en,
      f.name_hi,
      f.name_ur,
      f.scope,
      f.is_restricted,
      f.restricted_rule,
      f.opening_balance,
      f.sort_order
    );
  }

  // SINGLE Physical Committee Bank Account (Official Bank of India UPI QR Standee)
  db.prepare(
    `INSERT INTO bank_accounts (id, bank_name, account_name, account_number, ifsc, branch, upi_id, qr_code_url, fund_scope, opening_balance, instructions, is_active, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`
  ).run(
    SINGLE_BANK_ID,
    OFFICIAL_BOI_BANK_NAME,
    OFFICIAL_BOI_ACCOUNT_NAME,
    '617606410026',
    'BKID0004861',
    'Chalkusha / Ragdih Branch, District Hazaribagh, Jharkhand',
    OFFICIAL_BOI_UPI_ID,
    OFFICIAL_BOI_QR_URL,
    'Single Physical Bank Account — Reconciled Across All 10 Separate Virtual Fund Ledgers',
    215000,
    'Scan official QR or pay via UPI/IMPS/NEFT to this single committee bank account. Mention your Member ID (e.g. M001) and target fund (Masjid / Madrasa / Zakat / Fitra / Ramadan) in remarks, then upload the payment slip for administrator verification.'
  );

  // Two Authorized Admins (Strict Maximum 2: Primary Admin & Secondary Admin) using unique Member IDs + bcrypt
  const adminPassHash = bcrypt.hashSync('Admin@123', 8);
  const memberPassHash = bcrypt.hashSync('Member@123', 8);

  const insertUser = db.prepare(
    `INSERT INTO users (id, username, password_hash, full_name, role, member_id, phone, two_factor_enabled, two_factor_secret, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  );
  insertUser.run('usr_admin_1', 'ADMIN-01', adminPassHash, 'Haji Mohammad Ali (Sadar)', 'admin_main', null, '+91 98351 44011', 0, '123456', now);
  insertUser.run('usr_admin_2', 'ADMIN-02', adminPassHash, 'Mohammad Ahmed (Secretary)', 'admin_secondary', null, '+91 98351 44022', 0, '123456', now);

  // Committee Members with INDIVIDUALLY CONFIGURABLE monthly contribution amounts (₹300, ₹500, ₹750, ₹1,000, ₹1,500)
  const joinStart = `${mMinus3}-01`;
  const membersData = [
    { id: 'mem_001', code: 'M001', name: 'Mohammad Ahmad', phone: '+91 98352 11001', village: 'Ragdih East', monthly: 500, join: joinStart, status: 'active' },
    { id: 'mem_002', code: 'M002', name: 'Rizwan Khan', phone: '+91 98352 11002', village: 'Ragdih Bazar', monthly: 500, join: joinStart, status: 'active' },
    { id: 'mem_003', code: 'M003', name: 'Aftab Alam', phone: '+91 98352 11003', village: 'Chalkusha', monthly: 750, join: joinStart, status: 'active' },
    { id: 'mem_004', code: 'M004', name: 'Salman Raza', phone: '+91 98352 11004', village: 'Ragdih West', monthly: 500, join: joinStart, status: 'active' },
    { id: 'mem_005', code: 'M005', name: 'Md. Asif', phone: '+91 98352 11005', village: 'Ragdih Masjid Tola', monthly: 1000, join: joinStart, status: 'active' },
    { id: 'mem_006', code: 'M006', name: 'Zahid Ansari', phone: '+91 98352 11006', village: 'Ragdih North', monthly: 300, join: joinStart, status: 'active' },
    { id: 'mem_007', code: 'M007', name: 'Imran Khan', phone: '+91 98352 11007', village: 'Chalkusha Road', monthly: 500, join: joinStart, status: 'inactive' },
    { id: 'mem_008', code: 'M008', name: 'Nadeem Akhtar', phone: '+91 98352 11008', village: 'Ragdih East', monthly: 1500, join: joinStart, status: 'active' },
    { id: 'mem_009', code: 'M009', name: 'Farhan Siddiqui', phone: '+91 98352 11009', village: 'Ragdih South', monthly: 600, join: joinStart, status: 'active' },
    { id: 'mem_010', code: 'M010', name: 'Shafique Alam', phone: '+91 98352 11010', village: 'Ragdih Masjid Tola', monthly: 500, join: joinStart, status: 'active' },
  ];

  const insertMember = db.prepare(
    `INSERT INTO members (id, member_code, full_name, phone, village, monthly_amount, joining_date, status, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
  );
  for (const m of membersData) {
    insertMember.run(m.id, m.code, m.name, m.phone, m.village, m.monthly, m.join, m.status);
    insertUser.run(`usr_${m.id}`, m.code, memberPassHash, m.name, 'member', m.id, m.phone, 0, '123456', now);
  }

  const insertTxn = db.prepare(
    `INSERT INTO transactions (
      id, txn_number, date, created_at, month_key, type, category, fund_id, target_fund_id,
      bank_account_id, payment_method, amount, party_name, member_id, description, receipt_url,
      status, created_by, created_by_name, approved_by, approved_by_name, approved_at, rejection_reason, reversed_txn_id, is_demo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  );

  const insertMemPay = db.prepare(
    `INSERT INTO member_payments (id, member_id, month_key, amount, paid_date, payment_method, txn_id, txn_number, status, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'verified', 1)`
  );

  // Member payment plan including full payments, skipped month (M001), and PARTIAL payment (M004 paid ₹300 of ₹500!)
  const payPlan: Array<{ memberId: string; monthKey: string; amount?: number }> = [
    // M001 (₹500/mo): mMinus3 Paid, mMinus2 Paid, mMinus1 UNPAID, curMonth Paid -> Pending ₹500 since mMinus1
    { memberId: 'mem_001', monthKey: mMinus3 },
    { memberId: 'mem_001', monthKey: mMinus2 },
    { memberId: 'mem_001', monthKey: curMonth },
    // M002 (₹500/mo): 3 months pending
    { memberId: 'mem_002', monthKey: mMinus3 },
    // M003 (₹750/mo): 2 months pending
    { memberId: 'mem_003', monthKey: mMinus3 },
    { memberId: 'mem_003', monthKey: mMinus2 },
    // M004 (₹500/mo): 3 paid + curMonth PARTIALLY PAID (₹300 of ₹500 -> ₹200 remaining!)
    { memberId: 'mem_004', monthKey: mMinus3 },
    { memberId: 'mem_004', monthKey: mMinus2 },
    { memberId: 'mem_004', monthKey: mMinus1 },
    { memberId: 'mem_004', monthKey: curMonth, amount: 300 },
    // M005 (₹1000/mo): all paid
    { memberId: 'mem_005', monthKey: mMinus3 },
    { memberId: 'mem_005', monthKey: mMinus2 },
    { memberId: 'mem_005', monthKey: mMinus1 },
    { memberId: 'mem_005', monthKey: curMonth },
    // M006 (₹300/mo): all paid
    { memberId: 'mem_006', monthKey: mMinus3 },
    { memberId: 'mem_006', monthKey: mMinus2 },
    { memberId: 'mem_006', monthKey: mMinus1 },
    { memberId: 'mem_006', monthKey: curMonth },
    // M008 (₹1500/mo): all paid
    { memberId: 'mem_008', monthKey: mMinus3 },
    { memberId: 'mem_008', monthKey: mMinus2 },
    { memberId: 'mem_008', monthKey: mMinus1 },
    { memberId: 'mem_008', monthKey: curMonth },
    // M009 (₹600/mo): 2 paid, 2 pending
    { memberId: 'mem_009', monthKey: mMinus3 },
    { memberId: 'mem_009', monthKey: mMinus2 },
    // M010 (₹500/mo): all paid
    { memberId: 'mem_010', monthKey: mMinus3 },
    { memberId: 'mem_010', monthKey: mMinus2 },
    { memberId: 'mem_010', monthKey: mMinus1 },
    { memberId: 'mem_010', monthKey: curMonth },
  ];

  for (const item of payPlan) {
    const m = membersData.find((x) => x.id === item.memberId)!;
    const amt = item.amount ?? m.monthly;
    const txnId = crypto.randomUUID();
    const dateStr = `${item.monthKey}-06`;
    const txnNum = generateTxnNumber(dateStr);
    const isUpi = m.code === 'M001' || m.code === 'M005' || m.code === 'M008';
    const method: 'Cash' | 'UPI' = isUpi ? 'UPI' : 'Cash';
    const bankId = isUpi ? SINGLE_BANK_ID : null;
    const memo = `Monthly contribution for ${item.monthKey} (${m.code}) (DEMO)`;

    insertTxn.run(
      txnId,
      txnNum,
      dateStr,
      `${dateStr}T10:15:00.000Z`,
      item.monthKey,
      'income',
      'Monthly Member Contribution',
      'masjid_general',
      null,
      bankId,
      method,
      amt,
      `${m.name} (${m.code})`,
      m.id,
      memo,
      null,
      'approved',
      'usr_admin_1',
      'Haji Mohammad Ali (Sadar)',
      'usr_admin_1',
      'Haji Mohammad Ali (Sadar)',
      `${dateStr}T10:15:00.000Z`,
      null,
      null
    );
    postDoubleEntryForTransaction({
      transactionId: txnId,
      txnNumber: txnNum,
      date: dateStr,
      type: 'income',
      fundId: 'masjid_general',
      paymentMethod: method,
      amount: amt,
      memo,
    });
    insertMemPay.run(crypto.randomUUID(), m.id, item.monthKey, amt, dateStr, method, txnId, txnNum);
  }

  // Extra Income, Expenses, Inter-Fund Transfer, and Pending Approval (> ₹5,000!)
  const extraTxns: Array<{
    date: string;
    type: 'income' | 'expense' | 'transfer';
    category: string;
    fundId: string;
    targetFundId?: string | null;
    method: 'Cash' | 'UPI' | 'Bank';
    amount: number;
    party: string;
    desc: string;
    status?: 'approved' | 'pending_approval';
  }> = [
    { date: `${mMinus2}-12`, type: 'income', category: 'Friday/Juma Donations', fundId: 'juma', method: 'Cash', amount: 6400, party: 'Juma Namazi Congregation', desc: 'Friday collection box count (DEMO)' },
    { date: `${mMinus1}-14`, type: 'income', category: 'Friday/Juma Donations', fundId: 'juma', method: 'Cash', amount: 7250, party: 'Juma Namazi Congregation', desc: 'Friday collection box count (DEMO)' },
    { date: `${curMonth}-06`, type: 'income', category: 'Friday/Juma Donations', fundId: 'juma', method: 'Cash', amount: 5800, party: 'Juma Namazi Congregation', desc: 'First Friday collection (DEMO)' },
    { date: `${curMonth}-13`, type: 'income', category: 'Friday/Juma Donations', fundId: 'juma', method: 'Cash', amount: 6100, party: 'Juma Namazi Congregation', desc: 'Second Friday collection (DEMO)' },

    { date: `${mMinus2}-10`, type: 'income', category: 'Madrasa Donations', fundId: 'madrasa_general', method: 'Bank', amount: 18500, party: 'Ragdih Village Well-Wishers', desc: 'Monthly Madrasa support contributions (DEMO)' },
    { date: `${mMinus1}-11`, type: 'income', category: 'Madrasa Donations', fundId: 'madrasa_general', method: 'UPI', amount: 22000, party: 'Chalkusha Community Donors', desc: 'Madarsa Anwarool Uloom monthly fund (DEMO)' },
    { date: `${curMonth}-05`, type: 'income', category: 'Madrasa Donations', fundId: 'madrasa_general', method: 'Bank', amount: 24500, party: 'Haji Safdar & Family', desc: 'Madrasa education & hostel donation (DEMO)' },

    { date: `${mMinus1}-18`, type: 'income', category: 'Ramadan Donations', fundId: 'ramadan', method: 'UPI', amount: 12000, party: 'Local Traders Association', desc: 'Advance Ramadan Iftar & Taraweeh support (DEMO)' },
    { date: `${mMinus1}-19`, type: 'income', category: 'Zakat Collection', fundId: 'zakat', method: 'Bank', amount: 18000, party: 'Anonymous Zakat Donor', desc: 'Zakat strictly for eligible hostel students (DEMO)' },
    { date: `${curMonth}-04`, type: 'income', category: 'Fitra Collection', fundId: 'fitra', method: 'UPI', amount: 4500, party: 'Village Families', desc: 'Sadqa-e-Fitr collection (DEMO)' },
    { date: `${curMonth}-07`, type: 'income', category: 'Sadqa Donations', fundId: 'sadqa', method: 'Cash', amount: 3500, party: 'Md. Shamim Ragdih', desc: 'Sadqa donation for needy families (DEMO)' },
    { date: `${mMinus2}-16`, type: 'income', category: 'Rabi-ul-Awwal Collection', fundId: 'rabi_ul_awwal', method: 'Cash', amount: 9500, party: 'Naujawan Committee Ragdih', desc: 'Jalsa Eid Milad-un-Nabi collection (DEMO)' },
    { date: `${curMonth}-08`, type: 'income', category: 'General Donations', fundId: 'other_donations', method: 'UPI', amount: 4000, party: 'Abdul Karim Hazaribagh', desc: 'General community welfare donation (DEMO)' },
    { date: `${curMonth}-09`, type: 'income', category: 'Special Donations', fundId: 'special_donation', method: 'Bank', amount: 15000, party: 'Haji Nasimuddin', desc: 'Dedicated for solar inverter battery upgrade (DEMO)' },

    // Masjid Expenses
    { date: `${mMinus1}-20`, type: 'expense', category: 'Electricity Bills', fundId: 'masjid_general', method: 'UPI', amount: 3450, party: 'JBVNL Electricity Board', desc: 'Noori Jama Masjid monthly electricity bill (DEMO)' },
    { date: `${mMinus1}-22`, type: 'expense', category: 'Cleaning Expenses', fundId: 'masjid_general', method: 'Cash', amount: 1800, party: 'Masjid Cleaning Supplies', desc: 'Mats cleaning, phenyl, and wuzu khana soap (DEMO)' },
    { date: `${curMonth}-08`, type: 'expense', category: 'Electricity Bills', fundId: 'masjid_general', method: 'UPI', amount: 3200, party: 'JBVNL Electricity Board', desc: 'Current month Masjid electricity bill (DEMO)' },
    { date: `${curMonth}-11`, type: 'expense', category: 'Repairs & Maintenance', fundId: 'masjid_general', method: 'Cash', amount: 2750, party: 'Chalkusha Hardware & Plumbing', desc: 'Wuzu area taps & loudspeaker wiring repair (DEMO)' },

    // Madrasa Expenses (those > ₹5,000 already dual-approved by Admin 2 in demo history)
    { date: `${mMinus1}-17`, type: 'expense', category: 'Food Expenses', fundId: 'madrasa_general', method: 'Bank', amount: 11200, party: 'Hazaribagh Wholesale Grain Store', desc: 'Rice, dal, oil, and kitchen supplies for hostel students (DEMO)' },
    { date: `${mMinus1}-24`, type: 'expense', category: 'Books & Stationery', fundId: 'madrasa_general', method: 'Cash', amount: 3800, party: 'Maktaba Nooria Books', desc: 'Qaida, Quran Pak & Urdu textbooks (DEMO)' },
    { date: `${curMonth}-10`, type: 'expense', category: 'Food Expenses', fundId: 'madrasa_general', method: 'Bank', amount: 9600, party: 'Ragdih Kirana & Ration Depot', desc: 'Current month Madrasa kitchen ration (DEMO)' },
    { date: `${curMonth}-12`, type: 'expense', category: 'Student Expenses', fundId: 'zakat', method: 'Bank', amount: 6500, party: 'Eligible Orphan & Needy Students', desc: 'Winter clothes & direct Tamleek stipend from Zakat Fund (DEMO)' },
    { date: `${mMinus2}-19`, type: 'expense', category: 'Jalsa & Langar', fundId: 'rabi_ul_awwal', method: 'Cash', amount: 7200, party: 'Ragdih Tent & Catering', desc: 'Rabi-ul-Awwal Jalsa sound & Langar expenses (DEMO)' },

    // Internal Virtual Fund Transfer (recorded strictly as transfer, NOT income!)
    { date: `${mMinus1}-25`, type: 'transfer', category: 'Inter-Fund Transfer', fundId: 'juma', targetFundId: 'masjid_general', method: 'Cash', amount: 5000, party: 'Committee Resolution #14', desc: 'Internal transfer from Juma Collection to Masjid General Fund (DEMO)' },

    // Pending Dual-Admin Approval Expense (> ₹5,000 limit!)
    {
      date: `${curMonth}-15`,
      type: 'expense',
      category: 'Construction Expenses',
      fundId: 'special_donation',
      method: 'Bank',
      amount: 8500,
      party: 'Jharkhand Solar Power Solutions',
      desc: 'Inverter battery upgrade for Masjid & Madrasa — exceeds ₹5,000 limit, requires Secondary Admin approval (DEMO)',
      status: 'pending_approval',
    },
  ];

  const insertApproval = db.prepare(
    `INSERT INTO approvals (id, transaction_id, txn_number, amount, threshold_limit, requested_by, requested_by_name, requested_at, status, decided_by, decided_by_name, decided_at, decision_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const t of extraTxns) {
    const id = crypto.randomUUID();
    const txnNum = generateTxnNumber(t.date);
    const status = t.status || 'approved';
    const bankId = t.method === 'Cash' ? null : SINGLE_BANK_ID;
    insertTxn.run(
      id,
      txnNum,
      t.date,
      `${t.date}T11:30:00.000Z`,
      t.date.slice(0, 7),
      t.type,
      t.category,
      t.fundId,
      t.targetFundId || null,
      bankId,
      t.method,
      t.amount,
      t.party,
      null,
      t.desc,
      null,
      status,
      'usr_admin_1',
      'Haji Mohammad Ali (Sadar)',
      status === 'approved' ? 'usr_admin_2' : null,
      status === 'approved' ? 'Mohammad Ahmed (Secretary)' : null,
      status === 'approved' ? `${t.date}T12:00:00.000Z` : null,
      null,
      null
    );

    if (status === 'approved') {
      postDoubleEntryForTransaction({
        transactionId: id,
        txnNumber: txnNum,
        date: t.date,
        type: t.type,
        fundId: t.fundId,
        targetFundId: t.targetFundId || null,
        paymentMethod: t.method,
        amount: t.amount,
        memo: t.desc,
      });
    }

    if (t.type === 'expense' && t.amount > DEFAULT_DUAL_APPROVAL_LIMIT) {
      insertApproval.run(
        crypto.randomUUID(),
        id,
        txnNum,
        t.amount,
        DEFAULT_DUAL_APPROVAL_LIMIT,
        'usr_admin_1',
        'Haji Mohammad Ali (Sadar)',
        `${t.date}T11:30:00.000Z`,
        status === 'approved' ? 'approved' : 'pending',
        status === 'approved' ? 'usr_admin_2' : null,
        status === 'approved' ? 'Mohammad Ahmed (Secretary)' : null,
        status === 'approved' ? `${t.date}T12:00:00.000Z` : null,
        status === 'approved' ? 'Approved by Secondary Admin (DEMO)' : null
      );
    }
  }

  // Staff: Imam & Madrasa Teachers
  const insertStaff = db.prepare(
    `INSERT INTO staff (id, name, designation, institution, fund_id, monthly_salary, joining_date, phone, status, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 1)`
  );
  const staffList = [
    { id: 'stf_imam', name: 'Maulana Abdul Rahman Qasmi', designation: 'Imam & Khateeb', inst: 'masjid', fundId: 'masjid_general', salary: 12000, join: `${mMinus2}-01`, phone: '+91 98351 77001' },
    { id: 'stf_muazzin', name: 'Hafiz Sajjad Hussain', designation: 'Muazzin', inst: 'masjid', fundId: 'masjid_general', salary: 6000, join: `${mMinus2}-01`, phone: '+91 98351 77002' },
    { id: 'stf_t1', name: 'Maulana Tariq Anwar', designation: 'Head Teacher (Muhtamim)', inst: 'madrasa', fundId: 'madrasa_general', salary: 10000, join: `${mMinus2}-01`, phone: '+91 98351 77003' },
    { id: 'stf_t2', name: 'Hafiz Mohammad Imran', designation: 'Hifz Teacher', inst: 'madrasa', fundId: 'madrasa_general', salary: 8500, join: `${mMinus2}-01`, phone: '+91 98351 77004' },
    { id: 'stf_t3', name: 'Qari Shabbir Ahmad', designation: 'Nazira & Urdu Teacher', inst: 'madrasa', fundId: 'madrasa_general', salary: 7500, join: `${mMinus2}-01`, phone: '+91 98351 77005' },
  ];
  for (const s of staffList) {
    insertStaff.run(s.id, s.name, s.designation, s.inst, s.fundId, s.salary, s.join, s.phone);
  }

  const insertSalPay = db.prepare(
    `INSERT INTO salaries (id, staff_id, month_key, amount, payment_date, payment_method, reference, txn_id, txn_number, recorded_by_name, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  );

  const salarySeed: Array<{ staffId: string; monthKey: string; amount: number; date: string; method: 'Bank' | 'UPI' | 'Cash'; ref: string }> = [
    { staffId: 'stf_imam', monthKey: mMinus2, amount: 12000, date: `${mMinus2}-28`, method: 'Bank', ref: 'IMPS-IMAM-01' },
    { staffId: 'stf_imam', monthKey: mMinus1, amount: 12000, date: `${mMinus1}-28`, method: 'Bank', ref: 'IMPS-IMAM-02' },
    { staffId: 'stf_imam', monthKey: curMonth, amount: 8000, date: `${curMonth}-10`, method: 'UPI', ref: 'UPI-IMAM-PARTIAL' },

    { staffId: 'stf_muazzin', monthKey: mMinus2, amount: 6000, date: `${mMinus2}-28`, method: 'Cash', ref: 'CASH-MZN-01' },
    { staffId: 'stf_muazzin', monthKey: mMinus1, amount: 6000, date: `${mMinus1}-28`, method: 'Cash', ref: 'CASH-MZN-02' },
    { staffId: 'stf_muazzin', monthKey: curMonth, amount: 6000, date: `${curMonth}-09`, method: 'Cash', ref: 'CASH-MZN-03' },

    { staffId: 'stf_t1', monthKey: mMinus2, amount: 10000, date: `${mMinus2}-28`, method: 'Bank', ref: 'NEFT-MAD-01' },
    { staffId: 'stf_t1', monthKey: mMinus1, amount: 10000, date: `${mMinus1}-28`, method: 'Bank', ref: 'NEFT-MAD-02' },
    { staffId: 'stf_t1', monthKey: curMonth, amount: 10000, date: `${curMonth}-09`, method: 'Bank', ref: 'NEFT-MAD-03' },

    { staffId: 'stf_t2', monthKey: mMinus2, amount: 8500, date: `${mMinus2}-28`, method: 'Bank', ref: 'NEFT-MAD-04' },
    { staffId: 'stf_t2', monthKey: mMinus1, amount: 8500, date: `${mMinus1}-28`, method: 'Bank', ref: 'NEFT-MAD-05' },
    { staffId: 'stf_t2', monthKey: curMonth, amount: 5000, date: `${curMonth}-12`, method: 'UPI', ref: 'UPI-MAD-PART' },

    { staffId: 'stf_t3', monthKey: mMinus2, amount: 7500, date: `${mMinus2}-28`, method: 'Cash', ref: 'CASH-MAD-01' },
    { staffId: 'stf_t3', monthKey: mMinus1, amount: 7500, date: `${mMinus1}-28`, method: 'Cash', ref: 'CASH-MAD-02' },
  ];

  for (const sp of salarySeed) {
    const st = staffList.find((x) => x.id === sp.staffId)!;
    const txnId = crypto.randomUUID();
    const txnNum = generateTxnNumber(sp.date);
    const bankId = sp.method === 'Cash' ? null : SINGLE_BANK_ID;
    const memo = `Salary payment for ${sp.monthKey} · Ref: ${sp.ref} (DEMO)`;

    insertTxn.run(
      txnId,
      txnNum,
      sp.date,
      `${sp.date}T14:00:00.000Z`,
      sp.monthKey,
      'expense',
      st.inst === 'masjid' ? 'Imam Salary' : "Teachers' Salaries",
      st.fundId,
      null,
      bankId,
      sp.method,
      sp.amount,
      `${st.name} (${st.designation})`,
      null,
      memo,
      null,
      'approved',
      'usr_admin_1',
      'Haji Mohammad Ali (Sadar)',
      'usr_admin_2',
      'Mohammad Ahmed (Secretary)',
      `${sp.date}T14:05:00.000Z`,
      null,
      null
    );
    postDoubleEntryForTransaction({
      transactionId: txnId,
      txnNumber: txnNum,
      date: sp.date,
      type: 'expense',
      fundId: st.fundId,
      paymentMethod: sp.method,
      amount: sp.amount,
      memo,
    });
    insertSalPay.run(
      crypto.randomUUID(),
      sp.staffId,
      sp.monthKey,
      sp.amount,
      sp.date,
      sp.method,
      sp.ref,
      txnId,
      txnNum,
      'Haji Mohammad Ali (Sadar)'
    );
  }

  // Generate contributions dues table from active members & reconcile paid/partial/overdue
  syncContributionsDuesForAllMembers(curMonth);

  // Pending Member UPI Payment Screenshot Submission
  const sampleSlipSvg = `data:image/svg+xml;base64,${Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="380" height="220" viewBox="0 0 380 220">
      <rect width="380" height="220" rx="12" fill="#f0fdf4" stroke="#16a34a" stroke-width="2"/>
      <text x="190" y="38" font-family="sans-serif" font-size="16" font-weight="bold" fill="#14532d" text-anchor="middle">UPI PAYMENT RECEIPT (DEMO)</text>
      <text x="190" y="72" font-family="sans-serif" font-size="28" font-weight="bold" fill="#15803d" text-anchor="middle">Rs. 1,500.00</text>
      <text x="190" y="104" font-family="sans-serif" font-size="13" fill="#334155" text-anchor="middle">Paid to: sgncommittee.ragdih@sbi</text>
      <text x="190" y="128" font-family="monospace" font-size="12" fill="#475569" text-anchor="middle">UTR: 632419882741</text>
      <text x="190" y="156" font-family="sans-serif" font-size="12" fill="#64748b" text-anchor="middle">Member: Aftab Alam (M003)</text>
      <text x="190" y="186" font-family="sans-serif" font-size="11" fill="#b45309" text-anchor="middle">Awaiting Committee Admin Verification</text>
    </svg>`
  ).toString('base64')}`;

  db.prepare(
    `INSERT INTO payment_submissions (id, member_id, amount, months_json, bank_account_id, fund_id, utr_reference, screenshot_url, notes, status, submitted_at, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_verification', ?, 1)`
  ).run(
    'sub_demo_001',
    'mem_003',
    1500,
    JSON.stringify([mMinus1, curMonth]),
    SINGLE_BANK_ID,
    'masjid_general',
    '632419882741',
    sampleSlipSvg,
    'Paid 2 months pending contribution (₹750 x 2) via PhonePe UPI (DEMO)',
    now
  );

  // Committee Members (Current + Previous Office Holders)
  const insertCommittee = db.prepare(
    `INSERT INTO committee_members (id, role_key, designation_en, designation_hi, designation_ur, full_name, phone, appointment_date, term_start, term_end, is_active, updated_by_name, updated_at, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  );
  insertCommittee.run('pos_sadar', 'sadar', 'Sadar (President)', 'सदर (अध्यक्ष)', 'صدر (پریزیڈنٹ)', 'Haji Mohammad Ali', '+91 98351 44011', '2025-01-10', '2025-01-10', '2027-01-09', 1, 'Haji Mohammad Ali (Sadar)', now);
  insertCommittee.run('pos_sec', 'secretary', 'Secretary', 'सेक्रेटरी (सचिव)', 'سیکریٹری', 'Mohammad Ahmed', '+91 98351 44022', '2025-01-10', '2025-01-10', '2027-01-09', 1, 'Haji Mohammad Ali (Sadar)', now);
  insertCommittee.run('pos_treas', 'treasurer', 'Treasurer (Khazanchi)', 'खजांची (कोषाध्यक्ष)', 'خزانچی', 'Haji Abdul Rashid', '+91 98351 44033', '2025-01-10', '2025-01-10', '2027-01-09', 1, 'Haji Mohammad Ali (Sadar)', now);
  insertCommittee.run('pos_vp', 'vice_president', 'Vice President (Naib Sadar)', 'नायब सदर (उपाध्यक्ष)', 'نائب صدر', 'Md. Kalimuddin Ansari', '+91 98351 44044', '2025-01-10', '2025-01-10', '2027-01-09', 1, 'Haji Mohammad Ali (Sadar)', now);
  insertCommittee.run('pos_mem1', 'member', 'Executive Committee Member', 'कार्यकारिणी सदस्य', 'مجلس عاملہ رکن', 'Md. Asif', '+91 98352 11005', '2025-01-10', '2025-01-10', '2027-01-09', 1, 'Haji Mohammad Ali (Sadar)', now);
  insertCommittee.run('pos_prev_sadar', 'sadar', 'Former Sadar (President)', 'पूर्व सदर', 'سابق صدر', 'Haji Shamsuddin (Retd.)', '+91 98351 40001', '2023-01-10', '2023-01-10', '2025-01-09', 0, 'Haji Mohammad Ali (Sadar)', now);
  insertCommittee.run('pos_prev_sec', 'secretary', 'Former Secretary', 'पूर्व सेक्रेटरी', 'سابق سیکریٹری', 'Master Nizamuddin', '+91 98351 40002', '2023-01-10', '2023-01-10', '2025-01-09', 0, 'Haji Mohammad Ali (Sadar)', now);

  // Closed & Locked past month (mMinus2)
  db.prepare(
    `INSERT INTO monthly_closings (month_key, is_locked, total_income, total_expense, outstanding_contributions, pending_salaries, closing_balance, closed_at, closed_by, closed_by_name)
     VALUES (?, 1, 41250, 51200, 1250, 0, 235050, ?, 'usr_admin_1', 'Haji Mohammad Ali (Sadar)')`
  ).run(mMinus2, `${mMinus1}-01T09:00:00.000Z`);

  addAuditLog({
    adminId: 'usr_admin_1',
    adminName: 'Haji Mohammad Ali (Sadar)',
    action: 'SYSTEM_CONFIG_INITIALIZED',
    entityType: 'app_settings',
    entityId: 'final_config',
    afterData: {
      dualApprovalLimit: DEFAULT_DUAL_APPROVAL_LIMIT,
      reminderDayOfMonth: DEFAULT_REMINDER_DAY,
      physicalBankCount: 1,
      virtualFundsCount: 10,
    },
    reason: 'Initialized single physical bank account, 10 virtual fund ledgers, ₹5,000 dual-approval threshold, and 5th-of-month reminder schedule',
  });

  addNotification({
    type: 'approval_required',
    title: 'Dual-Admin Approval Required (> ₹5,000)',
    message: 'An expense of ₹8,500 (Solar Inverter Battery Upgrade) submitted by Primary Admin requires Secondary Admin approval.',
    targetRole: 'admin',
  });
  addNotification({
    type: 'payment_submission',
    title: 'New UPI Screenshot Uploaded',
    message: 'Aftab Alam (M003) uploaded a ₹1,500 UPI receipt (UTR: 632419882741) awaiting admin verification.',
    targetRole: 'admin',
  });
  addNotification({
    type: 'salary_payment',
    title: 'Partial Salary Recorded — Imam Sahab',
    message: `₹8,000 paid towards Maulana Abdul Rahman Qasmi's ${curMonth} salary. Remaining balance: ₹4,000.`,
    targetRole: 'all',
  });
}

// ---------- COMPUTATION HELPERS ----------

export function getSettingsMap(): Record<string, string> {
  const rows = db.prepare(`SELECT key, value FROM app_settings`).all() as Array<{ key: string; value: string }>;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

export function getAppSettings() {
  const s = getSettingsMap();
  return {
    committeeName: s.committeeName || COMMITTEE_NAME,
    committeeAddress: s.committeeAddress || COMMITTEE_ADDRESS,
    appLogoUrl: s.appLogoUrl || '/assets/aistudio/1795136479317_b68e267a.png',
    defaultLanguage: (s.defaultLanguage === 'hi' || s.defaultLanguage === 'ur' ? s.defaultLanguage : 'en') as 'en' | 'hi' | 'ur',
    memberLoginEnabled: s.memberLoginEnabled !== 'false',
    autoBackupEnabled: s.autoBackupEnabled !== 'false',
    dualApprovalEnabled: s.dualApprovalEnabled !== 'false',
    dualApprovalLimit: Number(s.dualApprovalLimit || DEFAULT_DUAL_APPROVAL_LIMIT),
    reminderDayOfMonth: Number(s.reminderDayOfMonth || DEFAULT_REMINDER_DAY),
    reminderFrequency: (s.reminderFrequency || 'monthly') as 'monthly' | 'biweekly' | 'weekly',
    defaultMonthlyContribution: Number(s.defaultMonthlyContribution || 500),
    hideMemberPhonesForMembers: s.hideMemberPhonesForMembers === 'true',
    isDemoDataActive: s.isDemoDataActive === 'true',
    lastBackupAt: s.lastBackupAt || null,
  };
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\s+/g, '');
  if (digits.length < 6) return '••••••';
  return `${digits.slice(0, 5)}••••${digits.slice(-2)}`;
}

export function computeFunds() {
  const funds = db.prepare(`SELECT * FROM funds ORDER BY sort_order ASC`).all() as Array<any>;
  const txns = db.prepare(`SELECT * FROM transactions`).all() as Array<any>;

  return funds.map((f) => {
    let totalIncome = 0;
    let totalExpense = 0;
    let transfersIn = 0;
    let transfersOut = 0;
    let pendingCount = 0;
    let transactionCount = 0;

    for (const t of txns) {
      if (t.fund_id === f.id && t.status === 'pending_approval') {
        pendingCount += 1;
      }
      if (t.status !== 'approved') continue;

      if (t.type === 'income' && t.fund_id === f.id) {
        totalIncome += Number(t.amount);
        transactionCount += 1;
      } else if (t.type === 'expense' && t.fund_id === f.id) {
        totalExpense += Number(t.amount);
        transactionCount += 1;
      } else if (t.type === 'transfer') {
        if (t.fund_id === f.id) {
          transfersOut += Number(t.amount);
          transactionCount += 1;
        }
        if (t.target_fund_id === f.id) {
          transfersIn += Number(t.amount);
          transactionCount += 1;
        }
      }
    }

    const currentBalance =
      Number(f.opening_balance) + totalIncome + transfersIn - totalExpense - transfersOut;

    return {
      id: f.id,
      code: f.code,
      nameEn: f.name_en,
      nameHi: f.name_hi,
      nameUr: f.name_ur,
      description: f.description || f.restricted_rule || '',
      scope: f.scope,
      isRestricted: Boolean(f.is_restricted),
      isActive: f.is_active === undefined ? true : Boolean(f.is_active),
      restrictedRule: f.restricted_rule,
      openingBalance: Number(f.opening_balance),
      totalIncome,
      totalExpense,
      transfersIn,
      transfersOut,
      currentBalance,
      pendingCount,
      transactionCount,
    };
  });
}

export function computeBankAccounts() {
  const accounts = db.prepare(`SELECT * FROM bank_accounts ORDER BY id ASC`).all() as Array<any>;
  const txns = db
    .prepare(`SELECT * FROM transactions WHERE status = 'approved' AND payment_method IN ('Bank', 'UPI')`)
    .all() as Array<any>;

  return accounts.map((acc) => {
    let delta = 0;
    for (const t of txns) {
      if (t.bank_account_id !== acc.id) continue;
      if (t.type === 'income') delta += Number(t.amount);
      else if (t.type === 'expense') delta -= Number(t.amount);
    }
    return {
      id: acc.id,
      bankName: acc.bank_name,
      accountName: acc.account_name,
      accountNumber: acc.account_number,
      ifsc: acc.ifsc,
      branch: acc.branch,
      upiId: acc.upi_id,
      qrCodeUrl: acc.qr_code_url || OFFICIAL_BOI_QR_URL,
      fundScope: acc.fund_scope,
      openingBalance: Number(acc.opening_balance),
      currentBalance: Number(acc.opening_balance) + delta,
      instructions: acc.instructions,
      isActive: Boolean(acc.is_active),
      isDemo: Boolean(acc.is_demo),
    };
  });
}

export function computeCashBalance(): number {
  const s = getSettingsMap();
  const openingCash = Number(s.openingCashBalance || 0);
  const txns = db
    .prepare(`SELECT type, amount FROM transactions WHERE status = 'approved' AND payment_method = 'Cash'`)
    .all() as Array<{ type: string; amount: number }>;

  let bal = openingCash;
  for (const t of txns) {
    if (t.type === 'income') bal += Number(t.amount);
    else if (t.type === 'expense') bal -= Number(t.amount);
  }
  return bal;
}

export function computeDoubleEntryTrialBalance() {
  const row = db
    .prepare(`SELECT COALESCE(SUM(debit), 0) as totalDebits, COALESCE(SUM(credit), 0) as totalCredits, COUNT(*) as lineCount FROM double_entry_lines`)
    .get() as { totalDebits: number; totalCredits: number; lineCount: number };

  const funds = computeFunds();
  const banks = computeBankAccounts();
  const cashBalance = computeCashBalance();
  const sumFunds = funds.reduce((s, f) => s + f.currentBalance, 0);
  const sumBank = banks.reduce((s, b) => s + b.currentBalance, 0);

  return {
    totalDebits: Number(row.totalDebits),
    totalCredits: Number(row.totalCredits),
    isBalanced: Math.abs(Number(row.totalDebits) - Number(row.totalCredits)) < 0.01,
    journalLineCount: Number(row.lineCount),
    physicalBankBalance: sumBank,
    cashBalance,
    totalLiquidAssets: sumBank + cashBalance,
    sumOfVirtualFunds: sumFunds,
    isReconciled: Math.abs(sumBank + cashBalance - sumFunds) < 0.01,
  };
}

export function computeMembers(maskPhones: boolean) {
  syncContributionsDuesForAllMembers();
  const members = db.prepare(`SELECT * FROM members ORDER BY member_code ASC`).all() as Array<any>;
  const contribs = db.prepare(`SELECT * FROM contributions ORDER BY month_key ASC`).all() as Array<any>;
  const payments = db
    .prepare(`SELECT * FROM member_payments WHERE status = 'verified' ORDER BY paid_date ASC`)
    .all() as Array<any>;

  const contribByMember = new Map<string, Array<any>>();
  for (const c of contribs) {
    const arr = contribByMember.get(c.member_id) || [];
    arr.push(c);
    contribByMember.set(c.member_id, arr);
  }

  const payByMember = new Map<string, Array<any>>();
  for (const p of payments) {
    const arr = payByMember.get(p.member_id) || [];
    arr.push(p);
    payByMember.set(p.member_id, arr);
  }

  return members.map((m) => {
    const mContribs = contribByMember.get(m.id) || [];
    const mPays = payByMember.get(m.id) || [];
    let totalExpected = 0;
    let totalPaid = 0;
    const pendingMonths: string[] = [];

    const monthHistory = mContribs.map((c) => {
      const expected = Number(c.expected_amount);
      const paid = Number(c.paid_amount);
      const remaining = Math.max(0, expected - paid);
      totalExpected += expected;
      totalPaid += paid;
      if (remaining > 0) pendingMonths.push(c.month_key);

      const monthPays = mPays.filter((p) => p.month_key === c.month_key);
      const latest = monthPays[monthPays.length - 1];
      const uiStatus: 'paid' | 'partial' | 'unpaid' =
        paid >= expected ? 'paid' : paid > 0 ? 'partial' : 'unpaid';

      return {
        monthKey: c.month_key,
        expected,
        paid,
        remaining,
        status: uiStatus,
        dueStatus: c.status,
        paidDate: latest?.paid_date,
        txnNumber: latest?.txn_number,
        paymentMethod: latest?.payment_method,
      };
    });

    if (m.status === 'inactive') {
      totalPaid = mPays.reduce((acc, p) => acc + Number(p.amount), 0);
    }

    const outstandingAmount = Math.max(0, totalExpected - totalPaid);

    return {
      id: m.id,
      memberCode: m.member_code,
      fullName: m.full_name,
      phone: maskPhones ? maskPhone(m.phone) : m.phone,
      village: m.village,
      monthlyAmount: Number(m.monthly_amount),
      joiningDate: m.joining_date,
      status: m.status as 'active' | 'inactive',
      totalExpected,
      totalPaid,
      outstandingAmount,
      pendingMonthsCount: pendingMonths.length,
      pendingMonths,
      pendingSince: pendingMonths.length > 0 ? pendingMonths[0] : null,
      monthHistory,
      isDemo: Boolean(m.is_demo),
    };
  });
}

export function computeStaffSalaries() {
  const curMonth = getCurrentMonthKey();
  const today = new Date();
  const staffRows = db.prepare(`SELECT * FROM staff ORDER BY institution ASC, name ASC`).all() as Array<any>;
  const payRows = db.prepare(`SELECT * FROM salaries ORDER BY payment_date DESC`).all() as Array<any>;

  return staffRows.map((s) => {
    const months = s.status === 'active' ? listMonthsBetween(s.joining_date, curMonth) : [];
    const sPays = payRows.filter((p) => p.staff_id === s.id);
    let totalPayable = 0;
    let totalPaid = 0;
    const pendingMonths: string[] = [];
    let maxPendingDays = 0;

    const monthlyHistory = months.map((mk) => {
      const mPays = sPays.filter((p) => p.month_key === mk);
      const paid = mPays.reduce((acc, p) => acc + Number(p.amount), 0);
      const payable = Number(s.monthly_salary);
      const remaining = Math.max(0, payable - paid);
      totalPayable += payable;
      totalPaid += paid;

      let pendingDays = 0;
      if (remaining > 0) {
        pendingMonths.push(mk);
        const dueDate = new Date(`${mk}-05T00:00:00Z`);
        const diffMs = today.getTime() - dueDate.getTime();
        pendingDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
        if (pendingDays > maxPendingDays) maxPendingDays = pendingDays;
      }

      return {
        monthKey: mk,
        payable,
        paid,
        remaining,
        status: (remaining === 0 ? 'paid' : paid > 0 ? 'partial' : 'pending') as 'paid' | 'partial' | 'pending',
        pendingDays,
        payments: mPays.map((p) => ({
          id: p.id,
          staffId: p.staff_id,
          monthKey: p.month_key,
          amount: Number(p.amount),
          paymentDate: p.payment_date,
          paymentMethod: p.payment_method,
          reference: p.reference,
          txnId: p.txn_id,
          txnNumber: p.txn_number,
          recordedByName: p.recorded_by_name,
        })),
      };
    });

    return {
      id: s.id,
      name: s.name,
      designation: s.designation,
      institution: s.institution as 'masjid' | 'madrasa',
      fundId: s.fund_id,
      monthlySalary: Number(s.monthly_salary),
      joiningDate: s.joining_date,
      phone: s.phone,
      status: s.status as 'active' | 'inactive',
      totalPayable,
      totalPaid,
      totalPending: Math.max(0, totalPayable - totalPaid),
      pendingMonths,
      maxPendingDays,
      monthlyHistory: monthlyHistory.reverse(),
      isDemo: Boolean(s.is_demo),
    };
  });
}

export function createDatabaseBackup(): { fileName: string; path: string; createdAt: string } {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `sgn_committee_backup_${ts}.db`;
  const dest = path.resolve(BACKUP_DIR, fileName);
  fs.copyFileSync(DB_PATH, dest);
  const now = new Date().toISOString();
  db.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('lastBackupAt', ?)`).run(now);
  return { fileName, path: dest, createdAt: now };
}

export function listBackups(): Array<{ fileName: string; sizeBytes: number; createdAt: string }> {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((fileName) => {
      const stat = fs.statSync(path.resolve(BACKUP_DIR, fileName));
      return {
        fileName,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
