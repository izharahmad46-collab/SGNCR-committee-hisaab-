import React, { useEffect, useState } from 'react';
import {
  FileDown,
  FileSpreadsheet,
  Printer,
  ShieldCheck,
  Database,
  History,
  KeyRound,
  RefreshCw,
  AlertTriangle,
  Cloud,
  CloudUpload,
} from 'lucide-react';
import type { User as FirebaseUser } from 'firebase/auth';
import { apiRequest } from '../lib/api';
import { FIREBASE_PROJECT_ID } from '../firebase';
import { fetchCloudStatus, type CloudStatusSnapshot } from '../lib/firestoreSync';
import { downloadFinancialReportPDF, downloadFinancialReportExcel } from '../lib/exports';
import type {
  AppSettings,
  AuditLogRecord,
  AuthUser,
  FinancialReportData,
  Language,
  LoginActivityRecord,
  NumeralSystem,
} from '../types';
import {
  COMMITTEE_TITLE,
  COMMITTEE_ADDRESS,
  COMMITTEE_LOGO_URL,
  formatINR,
  t,
  toDisplayDigits,
} from '../i18n/translations';

interface ReportsAuditSettingsViewProps {
  user: AuthUser;
  firebaseUser: FirebaseUser | null;
  lang: Language;
  setLang: (l: Language) => void;
  numerals: NumeralSystem;
  setNumerals: (n: NumeralSystem) => void;
  dark: boolean;
  setDark: (d: boolean) => void;
  mode: 'reports' | 'settings';
  settings: AppSettings | null;
  auditLogs: AuditLogRecord[];
  onRefresh: () => void;
  onConnectFirebase: () => Promise<FirebaseUser>;
  onSyncFirestore: () => Promise<{ syncedCollections: number; syncedDocuments: number }>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export const ReportsAuditSettingsView: React.FC<ReportsAuditSettingsViewProps> = ({
  user,
  firebaseUser,
  lang,
  setLang,
  numerals,
  setNumerals,
  dark,
  setDark,
  mode,
  settings,
  auditLogs,
  onRefresh,
  onConnectFirebase,
  onSyncFirestore,
  onNotify,
}) => {
  const isAdmin = user.role === 'admin_main' || user.role === 'admin_secondary';
  const isMainAdmin = user.role === 'admin_main';

  // Reports state
  const curYear = new Date().getFullYear();
  const curMonth = String(new Date().getMonth() + 1).padStart(2, '0');
  const [periodType, setPeriodType] = useState<'monthly' | 'quarterly' | 'yearly'>('yearly');
  const [year, setYear] = useState(curYear);
  const [month, setMonth] = useState(curMonth);
  const [quarter, setQuarter] = useState(Math.ceil(Number(curMonth) / 3));
  const [report, setReport] = useState<FinancialReportData | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);

  // Settings & Security state
  const [settingsSubTab, setSettingsSubTab] = useState<'audit' | 'security' | 'config'>('audit');
  const [dualEnabled, setDualEnabled] = useState(settings?.dualApprovalEnabled ?? true);
  const [dualLimit, setDualLimit] = useState(String(settings?.dualApprovalLimit ?? 5000));
  const [remDay, setRemDay] = useState(String(settings?.reminderDayOfMonth ?? 5));
  const [remFreq, setRemFreq] = useState<'monthly' | 'biweekly' | 'weekly'>(settings?.reminderFrequency ?? 'monthly');
  const [defaultContrib, setDefaultContrib] = useState(String(settings?.defaultMonthlyContribution ?? 500));
  const [hidePhones, setHidePhones] = useState(settings?.hideMemberPhonesForMembers ?? false);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(user.twoFactorEnabled);
  const [curPass, setCurPass] = useState('');
  const [newPass, setNewPass] = useState('');

  const [securityData, setSecurityData] = useState<{
    loginActivity: LoginActivityRecord[];
    activeSessions: any[];
    admins: any[];
    backups: Array<{ fileName: string; sizeBytes: number; createdAt: string }>;
  } | null>(null);
  const [cloudStatus, setCloudStatus] = useState<CloudStatusSnapshot | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings) {
      setDualEnabled(settings.dualApprovalEnabled);
      setDualLimit(String(settings.dualApprovalLimit));
      setRemDay(String(settings.reminderDayOfMonth));
      setRemFreq(settings.reminderFrequency);
      setDefaultContrib(String(settings.defaultMonthlyContribution));
      setHidePhones(settings.hideMemberPhonesForMembers);
    }
  }, [settings]);

  useEffect(() => {
    if (mode !== 'reports') return;
    let active = true;
    setLoadingReport(true);
    apiRequest<{ report: FinancialReportData }>(
      `/api/reports?periodType=${periodType}&year=${year}&month=${month}&quarter=${quarter}`
    )
      .then((res) => {
        if (active) setReport(res.report);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingReport(false);
      });
    return () => {
      active = false;
    };
  }, [mode, periodType, year, month, quarter]);

  useEffect(() => {
    if (mode !== 'settings') return;
    apiRequest<any>('/api/security/activity')
      .then((res) => setSecurityData(res))
      .catch(() => {});
  }, [mode, settingsSubTab]);

  useEffect(() => {
    if (mode !== 'settings' || settingsSubTab !== 'config') return;
    let active = true;
    fetchCloudStatus(firebaseUser)
      .then((snap) => {
        if (active) setCloudStatus(snap);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [mode, settingsSubTab, firebaseUser]);

  async function handleConnectCloud() {
    setCloudBusy(true);
    try {
      const fbUser = await onConnectFirebase();
      const snap = await fetchCloudStatus(fbUser);
      setCloudStatus(snap);
      onNotify(`Connected to Firebase Cloud Firestore as ${fbUser.email}.`, 'success');
    } catch (err: any) {
      const msg = err?.message || 'Unable to connect Google account.';
      if (!msg.toLowerCase().includes('popup-closed-by-user')) {
        onNotify(msg, 'error');
      }
    } finally {
      setCloudBusy(false);
    }
  }

  async function handlePushCloudSync() {
    setCloudBusy(true);
    try {
      const res = await onSyncFirestore();
      const snap = await fetchCloudStatus(firebaseUser);
      setCloudStatus(snap);
      onNotify(
        `Synced ${res.syncedDocuments} records across ${res.syncedCollections} Firestore collections.`,
        'success'
      );
    } catch (err: any) {
      onNotify(err?.message || 'Cloud Firestore sync failed.', 'error');
    } finally {
      setCloudBusy(false);
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiRequest('/api/settings', {
        method: 'PUT',
        body: {
          dualApprovalEnabled: dualEnabled,
          dualApprovalLimit: Number(dualLimit),
          reminderDayOfMonth: Number(remDay),
          reminderFrequency: remFreq,
          defaultMonthlyContribution: Number(defaultContrib),
          hideMemberPhonesForMembers: hidePhones,
        },
      });
      onRefresh();
      onNotify('Committee settings updated and logged in audit trail.', 'success');
    } catch (err: any) {
      onNotify(err.message || 'Failed to save settings', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle2FA() {
    setBusy(true);
    try {
      const next = !twoFactorEnabled;
      await apiRequest('/api/auth/2fa', { method: 'POST', body: { enabled: next } });
      setTwoFactorEnabled(next);
      onNotify(
        next ? 'Administrator 2FA enabled (Demo OTP: 123456).' : 'Administrator 2FA disabled.',
        'success'
      );
    } catch (err: any) {
      onNotify(err.message || '2FA update failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword: curPass, newPassword: newPass },
      });
      setCurPass('');
      setNewPass('');
      onNotify('Password updated securely with bcrypt hashing.', 'success');
    } catch (err: any) {
      onNotify(err.message || 'Password update failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateBackup() {
    setBusy(true);
    try {
      const res = await apiRequest<{ backup: { fileName: string }; backups: any[] }>('/api/backup/snapshot', {
        method: 'POST',
      });
      setSecurityData((prev) => (prev ? { ...prev, backups: res.backups } : prev));
      onRefresh();
      onNotify(`Database snapshot saved: ${res.backup.fileName}`, 'success');
    } catch (err: any) {
      onNotify(err.message || 'Backup failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleExportJSON() {
    try {
      const token = localStorage.getItem('sgn_committee_auth_token') || '';
      const res = await fetch('/api/backup/export-json', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sgn_committee_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      onNotify('Full JSON committee backup downloaded.', 'success');
    } catch {
      onNotify('Export failed', 'error');
    }
  }

  async function handleDataModeSwitch(targetMode: 'reset_demo' | 'start_live_clean') {
    setBusy(true);
    try {
      await apiRequest('/api/admin/data-mode', { method: 'POST', body: { mode: targetMode } });
      onRefresh();
      onNotify(
        targetMode === 'start_live_clean'
          ? 'Automatic backup saved. Demo records cleared — Clean Live Committee Books initialized!'
          : 'Demo records restored.',
        'success'
      );
    } catch (err: any) {
      onNotify(err.message || 'Mode switch failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'reports') {
    return (
      <div className="space-y-6">
        {/* Controls & Export Actions */}
        <div className="no-print flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-4 rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
              {(['monthly', 'quarterly', 'yearly'] as const).map((pt) => (
                <button
                  key={pt}
                  type="button"
                  onClick={() => setPeriodType(pt)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize min-h-[36px] ${
                    periodType === pt
                      ? 'bg-white dark:bg-[#192822] text-[#0B4F32] dark:text-emerald-300 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {pt}
                </button>
              ))}
            </div>

            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold"
            >
              {[curYear - 1, curYear, curYear + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>

            {periodType === 'monthly' && (
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold"
              >
                {Array.from({ length: 12 }).map((_, i) => {
                  const m = String(i + 1).padStart(2, '0');
                  return (
                    <option key={m} value={m}>
                      Month {m}
                    </option>
                  );
                })}
              </select>
            )}

            {periodType === 'quarterly' && (
              <select
                value={quarter}
                onChange={(e) => setQuarter(Number(e.target.value))}
                className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold"
              >
                <option value={1}>Q1 (Jan–Mar)</option>
                <option value={2}>Q2 (Apr–Jun)</option>
                <option value={3}>Q3 (Jul–Sep)</option>
                <option value={4}>Q4 (Oct–Dec)</option>
              </select>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!report}
              onClick={() => report && downloadFinancialReportPDF(report)}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <FileDown className="w-4 h-4" />
              <span>{t(lang, 'downloadPdf')}</span>
            </button>
            <button
              type="button"
              disabled={!report}
              onClick={() => report && downloadFinancialReportExcel(report)}
              className="min-h-[42px] px-4 py-2 rounded-xl border border-[#0B4F32] text-[#0B4F32] dark:text-emerald-300 dark:border-emerald-600 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>{t(lang, 'downloadExcel')}</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Printer className="w-4 h-4" />
              <span>{t(lang, 'printStatement')}</span>
            </button>
          </div>
        </div>

        {/* Printable Official Financial Statement */}
        {loadingReport || !report ? (
          <div className="h-72 rounded-2xl bg-slate-200/70 dark:bg-slate-800/50 animate-pulse" />
        ) : (
          <div className="print-card rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-6 space-y-6">
            {/* Official Letterhead */}
            <div className="flex flex-col sm:flex-row items-center gap-4 pb-5 border-b border-slate-200 dark:border-slate-800 text-center sm:text-left">
              <img
                src={COMMITTEE_LOGO_URL}
                alt={COMMITTEE_TITLE}
                referrerPolicy="no-referrer"
                className="w-16 h-16 rounded-full object-contain bg-white p-1 border border-slate-200 shrink-0"
              />
              <div className="flex-1">
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{COMMITTEE_TITLE}</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{COMMITTEE_ADDRESS}</p>
                <p className="text-sm font-semibold text-[#0B4F32] dark:text-emerald-400 mt-1">
                  {report.periodLabel} ({report.startDate} to {report.endDate})
                  {report.isDemo ? ' · DEMO DATA' : ''}
                </p>
              </div>
            </div>

            {/* Complete Audit Line Items Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 text-sm">
              {[
                ['Total Verified Income', formatINR(report.totalIncome, numerals), 'text-emerald-700 dark:text-emerald-400'],
                ['Total Verified Expenditure', formatINR(report.totalExpense, numerals), 'text-rose-700 dark:text-rose-400'],
                ['Net Surplus / Deficit', formatINR(report.netSurplus, numerals), 'text-slate-900 dark:text-slate-100'],
                ['Member Contributions Received', formatINR(report.totalMemberContributions, numerals), 'text-emerald-700 dark:text-emerald-400'],
                ['Masjid Income / Expense', `${formatINR(report.masjidIncome, numerals)} / ${formatINR(report.masjidExpense, numerals)}`, 'text-slate-900 dark:text-slate-100'],
                ['Madrasa Income / Expense', `${formatINR(report.madrasaIncome, numerals)} / ${formatINR(report.madrasaExpense, numerals)}`, 'text-slate-900 dark:text-slate-100'],
                ['Ramadan Collections', formatINR(report.ramadanCollections, numerals), 'text-slate-900 dark:text-slate-100'],
                ['Zakat / Fitra / Sadqa', `${formatINR(report.zakatCollections, numerals)} / ${formatINR(report.fitraCollections, numerals)} / ${formatINR(report.sadqaCollections, numerals)}`, 'text-slate-900 dark:text-slate-100'],
                ['Rabi-ul-Awwal / Juma', `${formatINR(report.rabiUlAwwalCollections, numerals)} / ${formatINR(report.jumaCollections, numerals)}`, 'text-slate-900 dark:text-slate-100'],
                ['Total Salaries Paid', formatINR(report.totalSalariesPaid, numerals), 'text-slate-900 dark:text-slate-100'],
                ['Outstanding Salaries', formatINR(report.totalOutstandingSalaries, numerals), 'text-amber-700 dark:text-amber-400'],
                ['Outstanding Contributions', formatINR(report.totalOutstandingContributions, numerals), 'text-rose-700 dark:text-rose-400'],
                ['Opening Bank Balance', formatINR(report.openingBankBalance, numerals), 'text-slate-900 dark:text-slate-100'],
                ['Closing Bank Balance', formatINR(report.closingBankBalance, numerals), 'text-[#0B4F32] dark:text-emerald-400'],
                ['Closing Cash-in-Hand', formatINR(report.closingCashBalance, numerals), 'text-[#0B4F32] dark:text-emerald-400'],
              ].map(([label, value, colorClass]) => (
                <div key={label} className="p-3.5 rounded-xl bg-[#F6F8F7] dark:bg-[#0D1612] border border-slate-200/80 dark:border-slate-800">
                  <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
                  <div className={`text-base font-bold font-data mt-1 ${colorClass}`}>{value}</div>
                </div>
              ))}
            </div>

            {/* Fund-Wise Closing Balances Table */}
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-2.5">
                Fund-Wise Closing Balances (All 10 Separate Accounts)
              </h3>
              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                <table className="w-full text-left border-collapse min-w-[640px] text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="py-2.5 px-3.5 font-semibold">Fund Account</th>
                      <th className="py-2.5 px-3.5 font-semibold text-right">Opening</th>
                      <th className="py-2.5 px-3.5 font-semibold text-right">Income</th>
                      <th className="py-2.5 px-3.5 font-semibold text-right">Expense</th>
                      <th className="py-2.5 px-3.5 font-semibold text-right">Net Transfer</th>
                      <th className="py-2.5 px-3.5 font-semibold text-right">Closing Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {report.fundBalances.map((f) => (
                      <tr key={f.id}>
                        <td className="py-2.5 px-3.5 font-semibold text-slate-900 dark:text-slate-100">{f.nameEn}</td>
                        <td className="py-2.5 px-3.5 text-right font-data">{formatINR(f.openingBalance, numerals)}</td>
                        <td className="py-2.5 px-3.5 text-right font-data text-emerald-700 dark:text-emerald-400">
                          +{formatINR(f.totalIncome, numerals)}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-data text-rose-700 dark:text-rose-400">
                          -{formatINR(f.totalExpense, numerals)}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-data">
                          {formatINR(f.transfersIn - f.transfersOut, numerals)}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-data font-bold text-slate-900 dark:text-slate-100">
                          {formatINR(f.currentBalance, numerals)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // SETTINGS, PERMANENT AUDIT LOG & SECURITY MODE
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-200/70 dark:bg-slate-900 w-fit">
        {(
          [
            ['audit', 'Financial Audit Trail'],
            ['security', 'Security & Login History'],
            ['config', 'Settings & Backups'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSettingsSubTab(key)}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold min-h-[38px] whitespace-nowrap transition-colors ${
              settingsSubTab === key
                ? 'bg-white dark:bg-[#192822] text-[#0B4F32] dark:text-emerald-300 shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* TAB 1: PERMANENT FINANCIAL AUDIT LOG */}
      {settingsSubTab === 'audit' && (
        <section className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
            <History className="w-4 h-4 text-[#0B4F32] dark:text-emerald-400" />
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Permanent Financial Audit Trail ({toDisplayDigits(auditLogs.length, numerals)} Records)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Immutable log capturing every transaction, reversal, salary, committee change, and setting update with admin identity and reason.
              </p>
            </div>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[36rem] overflow-y-auto">
            {auditLogs.map((log) => (
              <div key={log.id} className="p-4 text-xs space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {log.action.replace(/_/g, ' ')} · <span className="font-normal text-slate-500">{log.entityType} ({log.entityId})</span>
                  </span>
                  <span className="font-data text-slate-500 dark:text-slate-400">
                    {new Date(log.timestamp).toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="text-slate-600 dark:text-slate-300">
                  Admin: <strong>{log.adminName}</strong>
                  {log.reason ? ` · Reason: ${log.reason}` : ''}
                </div>
                {(log.beforeData || log.afterData) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
                    {log.beforeData && (
                      <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900/70 font-data text-[11px] text-slate-600 dark:text-slate-400 overflow-x-auto">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">Original: </span>
                        {log.beforeData.slice(0, 260)}
                      </div>
                    )}
                    {log.afterData && (
                      <div className="p-2 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 font-data text-[11px] text-slate-700 dark:text-slate-300 overflow-x-auto">
                        <span className="font-semibold text-emerald-800 dark:text-emerald-400">Updated: </span>
                        {log.afterData.slice(0, 260)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* TAB 2: SECURITY, MAX 2 ADMINS, 2FA & LOGIN ACTIVITY */}
      {settingsSubTab === 'security' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#0B4F32] dark:text-emerald-400" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Authorized Administrators (Strict Maximum: 2)
                </h3>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {(securityData?.admins || []).map((a) => (
                  <div key={a.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-bold text-slate-900 dark:text-slate-100">{a.fullName}</div>
                      <div className="text-slate-500 dark:text-slate-400">
                        Member ID: <span className="font-data">{a.username}</span> ·{' '}
                        {a.role === 'admin_main' ? 'Primary Admin' : 'Secondary Admin'}
                      </div>
                    </div>
                    <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                      {a.twoFactorEnabled ? '2FA Active' : 'Active'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-[#0B4F32] dark:text-emerald-400" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Access Enforcement, Password & 2FA
                </h3>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                All role permissions are enforced server-side on every API route. Passwords are stored as bcrypt hashes only. Committee members receive HTTP 403 on all write endpoints.
              </p>
              <form onSubmit={handleChangePassword} className="pt-2 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="password"
                  required
                  value={curPass}
                  onChange={(e) => setCurPass(e.target.value)}
                  placeholder="Current password"
                  className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  placeholder="New password (6+ chars)"
                  className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[40px] px-3 py-1.5 rounded-lg bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-semibold whitespace-nowrap"
                >
                  Update Password
                </button>
              </form>
              {isAdmin && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Two-Factor Authentication (Admin OTP)
                    </div>
                    <div className="text-[11px] text-slate-500">Demo OTP code when enabled: 123456</div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleToggle2FA}
                    className={`min-h-[40px] px-4 py-1.5 rounded-xl text-xs font-semibold ${
                      twoFactorEnabled
                        ? 'bg-emerald-700 text-white'
                        : 'border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {twoFactorEnabled ? '2FA Enabled' : 'Enable 2FA'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Login Activity History */}
          <section className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3">Login Activity History</h3>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-80 overflow-y-auto text-xs">
              {(securityData?.loginActivity || []).map((la) => (
                <div key={la.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <strong className="text-slate-900 dark:text-slate-100">{la.fullName}</strong> ({la.username} · {la.role})
                  </div>
                  <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
                    <span className={la.status === 'failed' ? 'text-rose-600 font-semibold' : 'text-emerald-700 dark:text-emerald-400 font-semibold'}>
                      {la.status.toUpperCase()}
                    </span>
                    <span className="font-data">{new Date(la.timestamp).toLocaleString('en-IN')}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* TAB 3: APPLICATION SETTINGS, PREFERENCES & BACKUPS */}
      {settingsSubTab === 'config' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Display Preferences (Available to both Members & Admins) */}
          <div className="p-5 rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 space-y-5">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Display, Language & Number Format</h3>

            <div className="space-y-3">
              <div>
                <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">Application Language</div>
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
                  {(['en', 'hi', 'ur'] as Language[]).map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setLang(l)}
                      className={`min-h-[40px] rounded-lg text-xs font-semibold ${
                        lang === l ? 'bg-[#0B4F32] text-white' : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {l === 'en' ? 'English' : l === 'hi' ? 'हिन्दी' : 'اردو'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">Number Script</div>
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
                  <button
                    type="button"
                    onClick={() => setNumerals('en')}
                    className={`min-h-[40px] rounded-lg text-xs font-semibold ${
                      numerals === 'en' ? 'bg-[#0B4F32] text-white' : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    English (₹2,45,000)
                  </button>
                  <button
                    type="button"
                    onClick={() => setNumerals('hi')}
                    className={`min-h-[40px] rounded-lg text-xs font-semibold ${
                      numerals === 'hi' ? 'bg-[#0B4F32] text-white' : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    हिन्दी (₹२,४५,०००)
                  </button>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">Appearance Theme</div>
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
                  <button
                    type="button"
                    onClick={() => setDark(false)}
                    className={`min-h-[40px] rounded-lg text-xs font-semibold ${
                      !dark ? 'bg-[#0B4F32] text-white' : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Light Mode
                  </button>
                  <button
                    type="button"
                    onClick={() => setDark(true)}
                    className={`min-h-[40px] rounded-lg text-xs font-semibold ${
                      dark ? 'bg-[#0B4F32] text-white' : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Dark Mode
                  </button>
                </div>
              </div>
            </div>

            {/* Firebase Cloud Firestore Sync Card */}
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Cloud className="w-4 h-4 text-[#0B4F32] dark:text-emerald-400" />
                  <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Firebase Cloud Firestore
                  </h4>
                </div>
                <span className="text-[11px] font-data text-slate-500 dark:text-slate-400">
                  {FIREBASE_PROJECT_ID}
                </span>
              </div>

              {firebaseUser && firebaseUser.emailVerified ? (
                <div className="space-y-3">
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    Signed in as <strong className="text-slate-900 dark:text-slate-100">{firebaseUser.email}</strong>
                    {cloudStatus?.isFirebaseAdmin ? ' (Firebase Admin)' : ' (Read-Only Cloud Access)'}
                  </div>
                  {cloudStatus && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="p-2.5 rounded-xl bg-[#F6F8F7] dark:bg-[#0D1612] border border-slate-200/80 dark:border-slate-800">
                        <div className="text-[11px] text-slate-500">Funds</div>
                        <div className="font-data font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                          {toDisplayDigits(cloudStatus.fundsCount, numerals)}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-[#F6F8F7] dark:bg-[#0D1612] border border-slate-200/80 dark:border-slate-800">
                        <div className="text-[11px] text-slate-500">Members</div>
                        <div className="font-data font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                          {toDisplayDigits(cloudStatus.membersCount, numerals)}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-[#F6F8F7] dark:bg-[#0D1612] border border-slate-200/80 dark:border-slate-800">
                        <div className="text-[11px] text-slate-500">Transactions</div>
                        <div className="font-data font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                          {toDisplayDigits(cloudStatus.transactionsCount, numerals)}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-[#F6F8F7] dark:bg-[#0D1612] border border-slate-200/80 dark:border-slate-800">
                        <div className="text-[11px] text-slate-500">Audit Logs</div>
                        <div className="font-data font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                          {toDisplayDigits(cloudStatus.auditLogsCount, numerals)}
                        </div>
                      </div>
                    </div>
                  )}
                  {cloudStatus?.lastSyncedAt && (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Last synced: {new Date(cloudStatus.lastSyncedAt).toLocaleString('en-IN')}
                    </div>
                  )}
                  {isAdmin && cloudStatus?.isFirebaseAdmin && (
                    <button
                      type="button"
                      disabled={cloudBusy}
                      onClick={handlePushCloudSync}
                      className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center justify-center gap-2"
                    >
                      <CloudUpload className="w-4 h-4" />
                      <span>{cloudBusy ? 'Syncing Ledger to Cloud Firestore...' : 'Sync Committee Ledger to Cloud Firestore'}</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2.5">
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    Sign in with Google to activate real-time Cloud Firestore synchronization and cloud ledger backup under hardened security rules.
                  </p>
                  <button
                    type="button"
                    disabled={cloudBusy}
                    onClick={handleConnectCloud}
                    className="w-full min-h-[42px] px-4 py-2 rounded-xl border border-[#0B4F32] text-[#0B4F32] dark:text-emerald-300 dark:border-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-60 text-xs font-semibold inline-flex items-center justify-center gap-2"
                  >
                    <Cloud className="w-4 h-4" />
                    <span>{cloudBusy ? 'Connecting...' : 'Connect Google Account (Firebase Cloud)'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Admin Governance Settings & Database Backups */}
          {isAdmin && (
            <div className="space-y-5">
              <form
                onSubmit={handleSaveSettings}
                className="p-5 rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 space-y-4"
              >
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Committee Governance & Accounting Rules
                </h3>

                <label className="flex items-center justify-between gap-3 text-xs cursor-pointer">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Enable Dual-Admin Approval for Large Expenses
                  </span>
                  <input
                    type="checkbox"
                    checked={dualEnabled}
                    onChange={(e) => setDualEnabled(e.target.checked)}
                    className="w-4 h-4 accent-[#0B4F32]"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Dual-Approval Limit (₹)
                    </label>
                    <input
                      type="number"
                      min={500}
                      value={dualLimit}
                      onChange={(e) => setDualLimit(e.target.value)}
                      className="w-full min-h-[42px] px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Default Monthly Contribution (₹)
                    </label>
                    <input
                      type="number"
                      min={50}
                      value={defaultContrib}
                      onChange={(e) => setDefaultContrib(e.target.value)}
                      className="w-full min-h-[42px] px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Auto-Reminder Day (1–28)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={28}
                      value={remDay}
                      onChange={(e) => setRemDay(e.target.value)}
                      className="w-full min-h-[42px] px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Reminder Frequency
                    </label>
                    <select
                      value={remFreq}
                      onChange={(e) => setRemFreq(e.target.value as any)}
                      className="w-full min-h-[42px] px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    >
                      <option value="monthly">Monthly</option>
                      <option value="biweekly">Bi-Weekly</option>
                      <option value="weekly">Weekly</option>
                    </select>
                  </div>
                </div>

                <label className="flex items-center justify-between gap-3 text-xs cursor-pointer">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Mask Member Mobile Numbers in Member View (Privacy Protection)
                  </span>
                  <input
                    type="checkbox"
                    checked={hidePhones}
                    onChange={(e) => setHidePhones(e.target.checked)}
                    className="w-4 h-4 accent-[#0B4F32]"
                  />
                </label>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full min-h-[44px] rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-sm font-semibold"
                >
                  {t(lang, 'saveChanges')}
                </button>
              </form>

              {/* Database Backups & Demo/Live Switch */}
              <div className="p-5 rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 space-y-4">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-[#0B4F32] dark:text-emerald-400" />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Database Backups & Demo Mode Control
                  </h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleCreateBackup}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-[#0B4F32] text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Database className="w-4 h-4" />
                    <span>Create SQLite Backup</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportJSON}
                    className="min-h-[42px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <FileDown className="w-4 h-4" />
                    <span>Download Full JSON</span>
                  </button>
                </div>

                {isMainAdmin && (
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                    <div className="text-xs text-amber-800 dark:text-amber-300 flex items-center gap-1.5 font-semibold">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>Primary Admin Data Mode ({settings?.isDemoDataActive ? 'Currently DEMO' : 'Currently LIVE'})</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {settings?.isDemoDataActive ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleDataModeSwitch('start_live_clean')}
                          className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
                        >
                          Clear Demo & Start Clean Live Books
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleDataModeSwitch('reset_demo')}
                          className="min-h-[40px] px-3.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Load Demo Data</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
