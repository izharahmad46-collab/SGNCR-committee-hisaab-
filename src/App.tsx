import React, { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Users,
  Wallet,
  Banknote,
  QrCode,
  ShieldCheck,
  Crown,
  Bell,
  FileBarChart2,
  Settings,
  LogOut,
  Sun,
  Moon,
  MoreHorizontal,
  X,
  CheckCircle2,
  AlertCircle,
  Shield,
} from 'lucide-react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { apiRequest, getAuthToken, setAuthToken, subscribeToLiveUpdates } from './lib/api';
import { auth, signInWithGoogle, signOutFirebase } from './firebase';
import {
  ensureFirebaseUserProfile,
  subscribeToFirestoreUpdates,
  syncCommitteeLedgerToFirestore,
} from './lib/firestoreSync';
import { LoginScreen } from './components/LoginScreen';
import { DashboardView } from './components/DashboardView';
import { MembersView } from './components/MembersView';
import { AccountingView } from './components/AccountingView';
import { SalariesView } from './components/SalariesView';
import { BankQrView } from './components/BankQrView';
import { ApprovalsClosingView } from './components/ApprovalsClosingView';
import { CommitteeRemindersView } from './components/CommitteeRemindersView';
import { ReportsAuditSettingsView } from './components/ReportsAuditSettingsView';
import { AdminControlPanelView } from './components/AdminControlPanelView';
import type {
  AppSettings,
  AuditLogRecord,
  AuthUser,
  BankAccountRecord,
  CommitteeMemberRecord,
  DashboardSummary,
  FundSummary,
  Language,
  MemberSummary,
  MonthlyClosingRecord,
  NotificationRecord,
  NumeralSystem,
  PaymentSubmissionRecord,
  ReconciliationSummary,
  ReminderLogRecord,
  StaffSummary,
  TransactionRecord,
} from './types';
import { COMMITTEE_LOGO_URL, COMMITTEE_TITLE, t } from './i18n/translations';

type NavKey =
  | 'dashboard'
  | 'admin_panel'
  | 'members'
  | 'accounts'
  | 'salaries'
  | 'bank'
  | 'approvals'
  | 'committee'
  | 'reminders'
  | 'reports'
  | 'settings';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [publicDemoFlag, setPublicDemoFlag] = useState(true);

  // UI preferences
  const [lang, setLang] = useState<Language>(() => {
    const saved = localStorage.getItem('sgn_lang');
    return saved === 'hi' || saved === 'ur' ? saved : 'en';
  });
  const [numerals, setNumerals] = useState<NumeralSystem>(() => {
    const saved = localStorage.getItem('sgn_numerals');
    return saved === 'hi' ? 'hi' : 'en';
  });
  const [dark, setDark] = useState<boolean>(() => localStorage.getItem('sgn_theme') === 'dark');

  // Active route & subcontext
  const [activeTab, setActiveTab] = useState<NavKey>('dashboard');
  const [subContext, setSubContext] = useState<string | undefined>(undefined);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Domain Data State
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [funds, setFunds] = useState<FundSummary[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [staff, setStaff] = useState<StaffSummary[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountRecord[]>([]);
  const [cashBalance, setCashBalance] = useState<number>(0);
  const [reconciliation, setReconciliation] = useState<ReconciliationSummary | null>(null);
  const [submissions, setSubmissions] = useState<PaymentSubmissionRecord[]>([]);
  const [positions, setPositions] = useState<CommitteeMemberRecord[]>([]);
  const [closings, setClosings] = useState<MonthlyClosingRecord[]>([]);
  const [reminders, setReminders] = useState<ReminderLogRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);

  // Sync theme, lang, and RTL direction on <html>
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', dark);
    localStorage.setItem('sgn_theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = lang === 'ur' ? 'rtl' : 'ltr';
    localStorage.setItem('sgn_lang', lang);
  }, [lang]);

  useEffect(() => {
    localStorage.setItem('sgn_numerals', numerals);
  }, [numerals]);

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => {
      setToast((prev) => (prev?.msg === msg ? null : prev));
    }, 4500);
  }, []);

  const loadAllData = useCallback(async () => {
    try {
      const [
        dashRes,
        memRes,
        txnRes,
        salRes,
        bankRes,
        subRes,
        comRes,
        closeRes,
        remRes,
        notRes,
        audRes,
      ] = await Promise.all([
        apiRequest<{ summary: DashboardSummary; funds: FundSummary[]; settings: AppSettings }>('/api/dashboard'),
        apiRequest<{ members: MemberSummary[] }>('/api/members'),
        apiRequest<{ transactions: TransactionRecord[] }>('/api/transactions'),
        apiRequest<{ staff: StaffSummary[] }>('/api/salaries'),
        apiRequest<{ bankAccounts: BankAccountRecord[]; cashBalance: number; reconciliation?: ReconciliationSummary }>('/api/banks'),
        apiRequest<{ submissions: PaymentSubmissionRecord[] }>('/api/submissions'),
        apiRequest<{ positions: CommitteeMemberRecord[] }>('/api/committee'),
        apiRequest<{ closings: MonthlyClosingRecord[] }>('/api/closings'),
        apiRequest<{ reminders: ReminderLogRecord[] }>('/api/reminders'),
        apiRequest<{ notifications: NotificationRecord[] }>('/api/notifications'),
        apiRequest<{ logs: AuditLogRecord[] }>('/api/audit-logs'),
      ]);

      setSummary(dashRes.summary);
      setFunds(dashRes.funds);
      setSettings(dashRes.settings);
      setMembers(memRes.members);
      setTransactions(txnRes.transactions);
      setStaff(salRes.staff);
      setBankAccounts(bankRes.bankAccounts);
      setCashBalance(bankRes.cashBalance);
      setReconciliation(bankRes.reconciliation || dashRes.summary.reconciliation || null);
      setSubmissions(subRes.submissions);
      setPositions(comRes.positions);
      setClosings(closeRes.closings);
      setReminders(remRes.reminders);
      setNotifications(notRes.notifications);
      setAuditLogs(audRes.logs);
    } catch (err: any) {
      if (err?.status === 401) {
        setAuthToken(null);
        setUser(null);
      }
    }
  }, []);

  // Initial session check
  useEffect(() => {
    let active = true;
    async function boot() {
      try {
        const pub = await apiRequest<{ isDemoDataActive: boolean }>('/api/public/info', { skipAuth: true });
        if (active) setPublicDemoFlag(pub.isDemoDataActive);
      } catch {
        // ignore
      }
      const token = getAuthToken();
      if (!token) {
        if (active) setAuthChecking(false);
        return;
      }
      try {
        const res = await apiRequest<{ user: AuthUser }>('/api/auth/me');
        if (active) setUser(res.user);
      } catch {
        setAuthToken(null);
      } finally {
        if (active) setAuthChecking(false);
      }
    }
    boot();
    return () => {
      active = false;
    };
  }, []);

  // Observe Firebase Auth state cleanly
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      setFirebaseUser(fbUser);
      if (fbUser && fbUser.emailVerified) {
        void ensureFirebaseUserProfile(fbUser).catch(() => {
          // Handled via ErrorBoundary or explicit user actions
        });
      }
    });
    return () => unsub();
  }, []);

  // Load data & connect real-time SSE + Firestore live sync when authenticated
  useEffect(() => {
    if (!user) return;
    loadAllData();
    const unsubSse = subscribeToLiveUpdates(() => {
      loadAllData();
    });
    const unsubFirestore =
      firebaseUser && firebaseUser.emailVerified
        ? subscribeToFirestoreUpdates(() => {
            loadAllData();
          })
        : () => {};
    return () => {
      unsubSse();
      unsubFirestore();
    };
  }, [user, firebaseUser, loadAllData]);

  const handleConnectFirebase = useCallback(async () => {
    const fbUser = await signInWithGoogle();
    await ensureFirebaseUserProfile(fbUser, user?.username);
    setFirebaseUser(fbUser);
    return fbUser;
  }, [user?.username]);

  const handleSyncToFirestore = useCallback(async () => {
    const activeFbUser = firebaseUser || auth.currentUser;
    if (!activeFbUser || !activeFbUser.emailVerified) {
      throw new Error('Connect a verified Google account first to sync with Cloud Firestore.');
    }
    return syncCommitteeLedgerToFirestore(
      {
        settings,
        funds,
        members,
        transactions,
        staff,
        bankAccounts,
        submissions,
        positions,
        closings,
        notifications,
        auditLogs,
      },
      activeFbUser
    );
  }, [
    firebaseUser,
    settings,
    funds,
    members,
    transactions,
    staff,
    bankAccounts,
    submissions,
    positions,
    closings,
    notifications,
    auditLogs,
  ]);

  async function handleLogout() {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    try {
      await signOutFirebase();
    } catch {
      // ignore
    }
    setAuthToken(null);
    setUser(null);
    setActiveTab('dashboard');
    setMobileMoreOpen(false);
  }

  function handleNavigate(tab: string, ctx?: string) {
    if (tab === 'admin_panel' && user?.role !== 'admin_main' && user?.role !== 'admin_secondary') {
      setActiveTab('dashboard');
      return;
    }
    setActiveTab(tab as NavKey);
    setSubContext(ctx);
    setMobileMoreOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F6F8F7] dark:bg-[#0B120F]">
        <div className="text-center space-y-3">
          <img
            src={COMMITTEE_LOGO_URL}
            alt={COMMITTEE_TITLE}
            referrerPolicy="no-referrer"
            className="w-16 h-16 mx-auto rounded-full object-contain bg-white p-1 border border-slate-200"
          />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Loading S.G.N Committee Portal...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        lang={lang}
        setLang={setLang}
        dark={dark}
        setDark={setDark}
        isDemoDataActive={publicDemoFlag}
        onLoginSuccess={(u) => {
          setUser(u);
          setActiveTab('dashboard');
        }}
      />
    );
  }

  const isAdmin = user.role === 'admin_main' || user.role === 'admin_secondary';
  const effectiveLogoUrl = settings?.appLogoUrl || COMMITTEE_LOGO_URL;
  const effectiveCommitteeTitle = settings?.committeeName || COMMITTEE_TITLE;
  const navItems: Array<{ key: NavKey; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number }> = [
    { key: 'dashboard', label: t(lang, 'navDashboard'), icon: LayoutDashboard },
    ...(isAdmin
      ? [
          {
            key: 'admin_panel' as NavKey,
            label: t(lang, 'navAdminPanel'),
            icon: Shield,
            badge:
              (summary?.pendingApprovalsCount || 0) + (summary?.pendingVerificationsCount || 0) > 0
                ? (summary?.pendingApprovalsCount || 0) + (summary?.pendingVerificationsCount || 0)
                : undefined,
          },
        ]
      : []),
    { key: 'members', label: t(lang, 'navMembers'), icon: Users },
    { key: 'accounts', label: t(lang, 'navAccounts'), icon: Wallet },
    { key: 'salaries', label: t(lang, 'navSalaries'), icon: Banknote },
    {
      key: 'bank',
      label: t(lang, 'navBankQr'),
      icon: QrCode,
      badge: isAdmin && summary?.pendingVerificationsCount ? summary.pendingVerificationsCount : undefined,
    },
    {
      key: 'approvals',
      label: t(lang, 'navApprovals'),
      icon: ShieldCheck,
      badge: summary?.pendingApprovalsCount ? summary.pendingApprovalsCount : undefined,
    },
    { key: 'committee', label: t(lang, 'navCommittee'), icon: Crown },
    { key: 'reminders', label: t(lang, 'navReminders'), icon: Bell },
    { key: 'reports', label: t(lang, 'navReports'), icon: FileBarChart2 },
    { key: 'settings', label: t(lang, 'navSettings'), icon: Settings },
  ];

  const activeNavMeta = navItems.find((n) => n.key === activeTab) || navItems[0];

  return (
    <div className="min-h-screen bg-[#F6F8F7] dark:bg-[#0B120F] text-slate-900 dark:text-slate-100 flex">
      {/* Desktop Sidebar (264px) */}
      <aside className="no-print hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white dark:bg-[#111B16] border-r border-slate-200 dark:border-slate-800 z-30">
        {/* Brand Header */}
        <div className="px-4 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3">
          <img
            src={effectiveLogoUrl}
            alt={effectiveCommitteeTitle}
            referrerPolicy="no-referrer"
            className="w-10 h-10 rounded-full object-contain bg-white p-0.5 border border-slate-200 shrink-0"
          />
          <div className="min-w-0">
            <div className="text-sm font-bold text-[#0B4F32] dark:text-emerald-400 truncate">
              {settings?.committeeName ? settings.committeeName : t(lang, 'appNameShort')}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              Noori Jama Masjid · Ragdih
            </div>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleNavigate(item.key)}
                className={`w-full min-h-[42px] px-3 py-2 rounded-xl text-sm font-medium flex items-center justify-between gap-2 transition-colors ${
                  active
                    ? 'bg-[#0B4F32] text-white font-semibold'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span
                    className={`text-[11px] font-data font-bold px-1.5 py-0.5 rounded-md ${
                      active ? 'bg-white/20 text-white' : 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* User Role & Quick Controls Footer */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
          <div className="px-2">
            <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">{user.fullName}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {isAdmin
                ? user.role === 'admin_main'
                  ? t(lang, 'adminMainBadge')
                  : t(lang, 'adminSecBadge')
                : t(lang, 'readOnlyBadge')}
            </div>
          </div>
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-900">
              {(['en', 'hi', 'ur'] as Language[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLang(l)}
                  className={`px-2 py-1 rounded-md text-[11px] font-semibold ${
                    lang === l ? 'bg-[#0B4F32] text-white' : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {l === 'en' ? 'EN' : l === 'hi' ? 'हि' : 'ار'}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setDark(!dark)}
              aria-label="Toggle theme"
              className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300"
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              title={t(lang, 'signOut')}
              className="min-h-[34px] px-2.5 inline-flex items-center gap-1 rounded-lg border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-400 text-xs font-semibold hover:bg-rose-50 dark:hover:bg-rose-950/30"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64">
        {/* Compact Top Bar */}
        <header className="no-print sticky top-0 z-20 h-14 px-4 sm:px-6 bg-white/95 dark:bg-[#111B16]/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={effectiveLogoUrl}
              alt={effectiveCommitteeTitle}
              referrerPolicy="no-referrer"
              className="lg:hidden w-8 h-8 rounded-full object-contain bg-white border border-slate-200 shrink-0"
            />
            <span className="text-base font-bold text-slate-900 dark:text-slate-100 truncate">
              {activeNavMeta.label}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden sm:inline text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
              {isAdmin
                ? user.role === 'admin_main'
                  ? `Primary Admin · ${user.username}`
                  : `Secondary Admin · ${user.username}`
                : `Read-Only · ${user.username}`}
            </span>
            <button
              type="button"
              onClick={() => handleNavigate('reminders')}
              aria-label="Notifications"
              className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 relative"
            >
              <Bell className="w-4 h-4" />
              {notifications.some((n) => !n.isRead) && (
                <span className="sr-only">Unread notifications</span>
              )}
            </button>
          </div>
        </header>

        {/* Explicit DEMO DATA Banner (Clearly distinguishes demo vs real balances) */}
        {settings?.isDemoDataActive && (
          <div className="no-print bg-amber-100/90 dark:bg-amber-950/60 border-b border-amber-300/80 dark:border-amber-800/60 px-4 sm:px-6 py-2 text-xs text-amber-950 dark:text-amber-200 flex items-center justify-between gap-3">
            <span className="font-medium">{t(lang, 'demoBanner')}</span>
            {user.role === 'admin_main' && (
              <button
                type="button"
                onClick={() => handleNavigate('settings')}
                className="font-bold underline whitespace-nowrap shrink-0"
              >
                Switch to Live
              </button>
            )}
          </div>
        )}

        {/* Toast Notification */}
        {toast && (
          <div className="no-print fixed top-16 right-4 z-50 max-w-sm">
            <div
              className={`px-4 py-3 rounded-xl shadow-lg border text-xs font-semibold flex items-start gap-2.5 ${
                toast.type === 'error'
                  ? 'bg-rose-50 dark:bg-rose-950 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200'
                  : 'bg-emerald-50 dark:bg-emerald-950 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
              }`}
            >
              {toast.type === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <span>{toast.msg}</span>
            </div>
          </div>
        )}

        {/* Page Content */}
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-5 pb-24 lg:pb-8">
          {activeTab === 'dashboard' && (
            <DashboardView
              user={user}
              lang={lang}
              numerals={numerals}
              summary={summary}
              funds={funds}
              recentTransactions={transactions}
              onNavigate={handleNavigate}
            />
          )}

          {activeTab === 'admin_panel' && isAdmin && (
            <AdminControlPanelView
              user={user}
              firebaseUser={firebaseUser}
              lang={lang}
              setLang={setLang}
              numerals={numerals}
              funds={funds}
              members={members}
              transactions={transactions}
              staff={staff}
              bankAccounts={bankAccounts}
              submissions={submissions}
              settings={settings}
              auditLogs={auditLogs}
              reconciliation={reconciliation}
              onRefresh={loadAllData}
              onNotify={showToast}
              onConnectFirebase={handleConnectFirebase}
              onSyncFirestore={handleSyncToFirestore}
              onNavigate={handleNavigate}
            />
          )}

          {activeTab === 'members' && (
            <MembersView
              user={user}
              lang={lang}
              numerals={numerals}
              members={members}
              funds={funds}
              bankAccounts={bankAccounts}
              initialFilter={subContext}
              onRefresh={loadAllData}
              onNotify={showToast}
            />
          )}

          {activeTab === 'accounts' && (
            <AccountingView
              user={user}
              lang={lang}
              numerals={numerals}
              funds={funds}
              transactions={transactions}
              bankAccounts={bankAccounts}
              reconciliation={reconciliation}
              settings={settings}
              initialSubTab={subContext}
              onRefresh={loadAllData}
              onNotify={showToast}
            />
          )}

          {activeTab === 'salaries' && (
            <SalariesView
              user={user}
              lang={lang}
              numerals={numerals}
              staff={staff}
              bankAccounts={bankAccounts}
              onRefresh={loadAllData}
              onNotify={showToast}
            />
          )}

          {activeTab === 'bank' && (
            <BankQrView
              user={user}
              lang={lang}
              numerals={numerals}
              bankAccounts={bankAccounts}
              cashBalance={cashBalance}
              reconciliation={reconciliation}
              submissions={submissions}
              members={members}
              funds={funds}
              onRefresh={loadAllData}
              onNotify={showToast}
            />
          )}

          {activeTab === 'approvals' && (
            <ApprovalsClosingView
              user={user}
              lang={lang}
              numerals={numerals}
              transactions={transactions}
              closings={closings}
              settings={settings}
              onRefresh={loadAllData}
              onNotify={showToast}
            />
          )}

          {(activeTab === 'committee' || activeTab === 'reminders') && (
            <CommitteeRemindersView
              user={user}
              lang={lang}
              numerals={numerals}
              mode={activeTab}
              positions={positions}
              members={members}
              reminders={reminders}
              notifications={notifications}
              settings={settings}
              onRefresh={loadAllData}
              onNotify={showToast}
            />
          )}

          {(activeTab === 'reports' || activeTab === 'settings') && (
            <ReportsAuditSettingsView
              user={user}
              firebaseUser={firebaseUser}
              lang={lang}
              setLang={setLang}
              numerals={numerals}
              setNumerals={setNumerals}
              dark={dark}
              setDark={setDark}
              mode={activeTab}
              settings={settings}
              auditLogs={auditLogs}
              onRefresh={loadAllData}
              onConnectFirebase={handleConnectFirebase}
              onSyncFirestore={handleSyncToFirestore}
              onNotify={showToast}
            />
          )}
        </main>
      </div>

      {/* Mobile Fixed Bottom Navigation Bar (Thumb-zone ergonomic 5 tabs) */}
      <nav className="no-print lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-[#111B16]/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 pb-safe">
        <div className="grid grid-cols-5 h-15">
          {(
            [
              { key: 'dashboard', label: t(lang, 'navDashboard'), icon: LayoutDashboard },
              { key: 'members', label: t(lang, 'navMembers'), icon: Users },
              { key: 'accounts', label: t(lang, 'navAccounts'), icon: Wallet },
              { key: 'reports', label: t(lang, 'navReports'), icon: FileBarChart2 },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleNavigate(item.key)}
                className={`flex flex-col items-center justify-center gap-0.5 min-h-[48px] ${
                  active ? 'text-[#0B4F32] dark:text-emerald-400 font-bold' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] leading-tight truncate max-w-[68px]">{item.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileMoreOpen(true)}
            className={`flex flex-col items-center justify-center gap-0.5 min-h-[48px] ${
              mobileMoreOpen ||
              ['admin_panel', 'salaries', 'bank', 'approvals', 'committee', 'reminders', 'settings'].includes(activeTab)
                ? 'text-[#0B4F32] dark:text-emerald-400 font-bold'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] leading-tight">{t(lang, 'navMore')}</span>
          </button>
        </div>
      </nav>

      {/* Mobile Bottom Sheet Drawer ("More" Modules & Settings) */}
      {mobileMoreOpen && (
        <div
          className="no-print lg:hidden fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-end"
          onClick={() => setMobileMoreOpen(false)}
        >
          <div
            className="w-full rounded-t-3xl bg-white dark:bg-[#121D18] p-5 pb-8 max-h-[85vh] overflow-y-auto space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700 mx-auto" />
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{user.fullName}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {isAdmin
                    ? user.role === 'admin_main'
                      ? t(lang, 'adminMainBadge')
                      : t(lang, 'adminSecBadge')
                    : t(lang, 'readOnlyBadge')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileMoreOpen(false)}
                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {navItems
                .filter((i) => !['dashboard', 'members', 'accounts', 'reports'].includes(i.key))
                .map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => handleNavigate(item.key)}
                      className={`p-3.5 rounded-xl border text-left flex items-center gap-2.5 min-h-[52px] ${
                        activeTab === item.key
                          ? 'bg-[#0B4F32] text-white border-[#0B4F32]'
                          : 'border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="text-xs font-semibold truncate">{item.label}</span>
                    </button>
                  );
                })}
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900">
                {(['en', 'hi', 'ur'] as Language[]).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLang(l)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                      lang === l ? 'bg-[#0B4F32] text-white' : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {l === 'en' ? 'EN' : l === 'hi' ? 'हिन्दी' : 'اردو'}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setDark(!dark)}
                className="min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-semibold inline-flex items-center gap-1.5"
              >
                {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                <span>{dark ? 'Light' : 'Dark'}</span>
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="min-h-[42px] px-3.5 rounded-xl bg-rose-600 text-white text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <LogOut className="w-4 h-4" />
                <span>{t(lang, 'signOut')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
