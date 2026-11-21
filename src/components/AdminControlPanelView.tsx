import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  Shield,
  Users,
  UserCheck,
  UserX,
  TrendingUp,
  TrendingDown,
  Wallet,
  Clock,
  ShieldAlert,
  Calendar,
  Plus,
  Edit3,
  KeyRound,
  Trash2,
  Power,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Upload,
  FileSpreadsheet,
  FileText,
  Cloud,
  Database,
  Crown,
  Search,
  Lock,
  ArrowUpRight,
  ArrowDownRight,
  Building2,
  QrCode,
  RefreshCw,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import {
  syncBankUpiToFirestore,
  syncFundToFirestore,
  syncSettingsToFirestore,
} from '../lib/firestoreSync';
import {
  downloadFinancialReportExcel,
  downloadFinancialReportPDF,
  downloadFundWiseReportExcel,
  downloadFundWiseReportPDF,
  downloadIncomeExpenseReportExcel,
  downloadIncomeExpenseReportPDF,
  downloadMemberWiseReportExcel,
  downloadMemberWiseReportPDF,
  downloadPendingDuesReportExcel,
  downloadPendingDuesReportPDF,
  downloadSalaryReportExcel,
  downloadSalaryReportPDF,
} from '../lib/exports';
import { COMMITTEE_LOGO_URL, formatINR, formatMonthKey } from '../i18n/translations';
import type {
  AdminOverviewData,
  AdminRoleAccount,
  AppSettings,
  AuditLogRecord,
  AuthUser,
  BankAccountRecord,
  FinancialReportData,
  FundSummary,
  Language,
  LoginActivityRecord,
  MemberSummary,
  NumeralSystem,
  PaymentSubmissionRecord,
  ReconciliationSummary,
  StaffSummary,
  TransactionRecord,
} from '../types';

type AdminSubTab = 'overview' | 'members' | 'funds' | 'ledger' | 'settings' | 'reports' | 'roles';
type ReportTypeKey =
  | 'daily'
  | 'monthly'
  | 'yearly'
  | 'member_wise'
  | 'fund_wise'
  | 'income_expense'
  | 'salary'
  | 'pending_dues';

interface AdminControlPanelViewProps {
  user: AuthUser;
  firebaseUser: FirebaseUser | null;
  lang: Language;
  setLang: (l: Language) => void;
  numerals: NumeralSystem;
  funds: FundSummary[];
  members: MemberSummary[];
  transactions: TransactionRecord[];
  staff: StaffSummary[];
  bankAccounts: BankAccountRecord[];
  submissions: PaymentSubmissionRecord[];
  settings: AppSettings | null;
  auditLogs: AuditLogRecord[];
  reconciliation: ReconciliationSummary | null;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onConnectFirebase: () => Promise<FirebaseUser>;
  onSyncFirestore: () => Promise<{ syncedCollections: number; syncedDocuments: number }>;
  onNavigate: (tab: string, ctx?: string) => void;
}

function getFundLabel(f: FundSummary, lang: Language): string {
  if (lang === 'hi' && f.nameHi) return f.nameHi;
  if (lang === 'ur' && f.nameUr) return f.nameUr;
  return f.nameEn;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read selected file.'));
    reader.readAsDataURL(file);
  });
}

export function AdminControlPanelView({
  user,
  firebaseUser,
  lang,
  setLang,
  numerals,
  funds,
  members,
  transactions,
  staff,
  bankAccounts,
  submissions,
  settings,
  auditLogs,
  reconciliation,
  onRefresh,
  onNotify,
  onConnectFirebase,
  onSyncFirestore,
  onNavigate,
}: AdminControlPanelViewProps) {
  const isAdmin = user.role === 'admin_main' || user.role === 'admin_secondary';
  const isSuperAdmin = user.role === 'admin_main';

  const [subTab, setSubTab] = useState<AdminSubTab>('overview');
  const [overview, setOverview] = useState<AdminOverviewData | null>(null);
  const [adminAccounts, setAdminAccounts] = useState<AdminRoleAccount[]>([]);
  const [memberAccounts, setMemberAccounts] = useState<Array<AdminRoleAccount & { memberStatus?: string }>>([]);
  const [canAddSecondaryAdmin, setCanAddSecondaryAdmin] = useState(false);
  const [loginActivity, setLoginActivity] = useState<LoginActivityRecord[]>([]);
  const [loadingAdminData, setLoadingAdminData] = useState(false);

  // Member management state
  const [memberSearch, setMemberSearch] = useState('');
  const [memberStatusFilter, setMemberStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMember, setNewMember] = useState({
    fullName: '',
    phone: '',
    village: 'Ragdih',
    memberCode: '',
    monthlyAmount: String(settings?.defaultMonthlyContribution || 500),
    joiningDate: new Date().toISOString().slice(0, 10),
    password: '',
  });
  const [editingMember, setEditingMember] = useState<MemberSummary | null>(null);
  const [editMemberForm, setEditMemberForm] = useState({
    fullName: '',
    phone: '',
    village: '',
    monthlyAmount: '500',
    status: 'active' as 'active' | 'inactive',
    newPassword: '',
  });
  const [accessModalMember, setAccessModalMember] = useState<MemberSummary | null>(null);
  const [accessPassword, setAccessPassword] = useState('');
  const [removeConfirmMember, setRemoveConfirmMember] = useState<MemberSummary | null>(null);

  // Fund management state
  const [showAddFund, setShowAddFund] = useState(false);
  const [newFund, setNewFund] = useState({
    code: '',
    nameEn: '',
    nameHi: '',
    nameUr: '',
    scope: 'general' as 'masjid' | 'madrasa' | 'restricted' | 'general',
    description: '',
    isRestricted: false,
    restrictedRule: '',
  });
  const [editingFund, setEditingFund] = useState<FundSummary | null>(null);
  const [editFundForm, setEditFundForm] = useState({
    nameEn: '',
    nameHi: '',
    nameUr: '',
    scope: 'general' as 'masjid' | 'madrasa' | 'restricted' | 'general',
    description: '',
    isRestricted: false,
    restrictedRule: '',
    isActive: true,
  });

  // Income / Expense Control state
  const [quickTxnModal, setQuickTxnModal] = useState<{ type: 'income' | 'expense'; fundId: string } | null>(null);
  const [txnForm, setTxnForm] = useState({
    type: 'income' as 'income' | 'expense',
    fundId: funds[0]?.id || 'fund_masjid',
    amount: '',
    category: 'Donation / Chanda',
    partyName: '',
    paymentMethod: 'UPI' as 'Cash' | 'UPI' | 'Bank',
    date: new Date().toISOString().slice(0, 10),
    description: '',
  });
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState<'all' | 'income' | 'expense' | 'transfer' | 'reversal'>('all');
  const [editingTxn, setEditingTxn] = useState<TransactionRecord | null>(null);
  const [editTxnForm, setEditTxnForm] = useState({ category: '', partyName: '', description: '', reason: '' });
  const [reversingTxn, setReversingTxn] = useState<TransactionRecord | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [approvalDecisionModal, setApprovalDecisionModal] = useState<{
    txn: TransactionRecord;
    decision: 'approve' | 'reject';
  } | null>(null);
  const [approvalReason, setApprovalReason] = useState('');

  // App & UPI Settings state
  const [settingsForm, setSettingsForm] = useState({
    committeeName: settings?.committeeName || '',
    committeeAddress: settings?.committeeAddress || '',
    appLogoUrl: settings?.appLogoUrl || COMMITTEE_LOGO_URL,
    defaultLanguage: (settings?.defaultLanguage || 'en') as Language,
    memberLoginEnabled: settings?.memberLoginEnabled !== false,
    autoBackupEnabled: settings?.autoBackupEnabled !== false,
    defaultMonthlyContribution: String(settings?.defaultMonthlyContribution || 500),
    dualApprovalEnabled: settings?.dualApprovalEnabled !== false,
    dualApprovalLimit: String(settings?.dualApprovalLimit || 5000),
    reminderDayOfMonth: String(settings?.reminderDayOfMonth || 5),
    reminderFrequency: (settings?.reminderFrequency || 'monthly') as 'monthly' | 'biweekly' | 'weekly',
    hideMemberPhonesForMembers: Boolean(settings?.hideMemberPhonesForMembers),
  });
  const primaryBank = bankAccounts[0] || null;
  const [bankForm, setBankForm] = useState({
    bankName: primaryBank?.bankName || '',
    accountName: primaryBank?.accountName || '',
    accountNumber: primaryBank?.accountNumber || '',
    ifsc: primaryBank?.ifsc || '',
    branch: primaryBank?.branch || '',
    upiId: primaryBank?.upiId || '',
    qrCodeUrl: primaryBank?.qrCodeUrl || '',
    instructions: primaryBank?.instructions || '',
  });
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingQr, setUploadingQr] = useState(false);
  const [syncingCloud, setSyncingCloud] = useState(false);

  // Reports Center state
  const [reportType, setReportType] = useState<ReportTypeKey>('daily');
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [reportMonth, setReportMonth] = useState(new Date().toISOString().slice(0, 7));
  const [reportYear, setReportYear] = useState(String(new Date().getFullYear()));
  const [periodReport, setPeriodReport] = useState<FinancialReportData | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);

  // Roles & Audit state
  const [auditSearch, setAuditSearch] = useState('');
  const [promoteUserId, setPromoteUserId] = useState('');
  const [roleActionReason, setRoleActionReason] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<AdminRoleAccount | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (settings) {
      setSettingsForm({
        committeeName: settings.committeeName || '',
        committeeAddress: settings.committeeAddress || '',
        appLogoUrl: settings.appLogoUrl || COMMITTEE_LOGO_URL,
        defaultLanguage: (settings.defaultLanguage || 'en') as Language,
        memberLoginEnabled: settings.memberLoginEnabled !== false,
        autoBackupEnabled: settings.autoBackupEnabled !== false,
        defaultMonthlyContribution: String(settings.defaultMonthlyContribution || 500),
        dualApprovalEnabled: settings.dualApprovalEnabled !== false,
        dualApprovalLimit: String(settings.dualApprovalLimit || 5000),
        reminderDayOfMonth: String(settings.reminderDayOfMonth || 5),
        reminderFrequency: (settings.reminderFrequency || 'monthly') as 'monthly' | 'biweekly' | 'weekly',
        hideMemberPhonesForMembers: Boolean(settings.hideMemberPhonesForMembers),
      });
    }
  }, [settings]);

  useEffect(() => {
    if (primaryBank) {
      setBankForm({
        bankName: primaryBank.bankName || '',
        accountName: primaryBank.accountName || '',
        accountNumber: primaryBank.accountNumber || '',
        ifsc: primaryBank.ifsc || '',
        branch: primaryBank.branch || '',
        upiId: primaryBank.upiId || '',
        qrCodeUrl: primaryBank.qrCodeUrl || '',
        instructions: primaryBank.instructions || '',
      });
    }
  }, [primaryBank]);

  const loadAdminOverviewAndRoles = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingAdminData(true);
    try {
      const [ovRes, roleRes, actRes] = await Promise.all([
        apiRequest<{ overview: AdminOverviewData }>('/api/admin/overview'),
        apiRequest<{
          admins: AdminRoleAccount[];
          memberAccounts: Array<AdminRoleAccount & { memberStatus?: string }>;
          canAddSecondaryAdmin: boolean;
        }>('/api/admin/roles'),
        apiRequest<{ activity: LoginActivityRecord[] }>('/api/security/activity'),
      ]);
      setOverview(ovRes.overview);
      setAdminAccounts(roleRes.admins || []);
      setMemberAccounts(roleRes.memberAccounts || []);
      setCanAddSecondaryAdmin(Boolean(roleRes.canAddSecondaryAdmin));
      setLoginActivity(actRes.activity || []);
    } catch (err: any) {
      onNotify(err?.message || 'Failed to load Admin Control Panel metrics.', 'error');
    } finally {
      setLoadingAdminData(false);
    }
  }, [isAdmin, onNotify]);

  useEffect(() => {
    loadAdminOverviewAndRoles();
  }, [loadAdminOverviewAndRoles, members.length, funds.length, transactions.length, submissions.length]);

  const loadPeriodReport = useCallback(async () => {
    if (!['daily', 'monthly', 'yearly'].includes(reportType)) return;
    setLoadingReport(true);
    try {
      const params = new URLSearchParams({ periodType: reportType });
      if (reportType === 'daily') params.set('date', reportDate);
      if (reportType === 'monthly') params.set('month', reportMonth);
      if (reportType === 'yearly') params.set('year', reportYear);
      const res = await apiRequest<{ report: FinancialReportData }>(`/api/reports?${params.toString()}`);
      setPeriodReport(res.report);
    } catch (err: any) {
      onNotify(err?.message || 'Failed to generate report.', 'error');
    } finally {
      setLoadingReport(false);
    }
  }, [reportType, reportDate, reportMonth, reportYear, onNotify]);

  useEffect(() => {
    if (subTab === 'reports' && ['daily', 'monthly', 'yearly'].includes(reportType)) {
      loadPeriodReport();
    }
  }, [subTab, reportType, loadPeriodReport]);

  const activeFunds = useMemo(() => funds.filter((f) => f.isActive !== false), [funds]);
  const pendingApprovalTxns = useMemo(
    () => transactions.filter((tx) => tx.status === 'pending_approval'),
    [transactions]
  );

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    return members.filter((m) => {
      if (memberStatusFilter !== 'all' && m.status !== memberStatusFilter) return false;
      if (!q) return true;
      return (
        m.fullName.toLowerCase().includes(q) ||
        m.memberCode.toLowerCase().includes(q) ||
        (m.phone || '').toLowerCase().includes(q) ||
        (m.village || '').toLowerCase().includes(q)
      );
    });
  }, [members, memberSearch, memberStatusFilter]);

  const filteredTransactions = useMemo(() => {
    const q = ledgerSearch.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (ledgerTypeFilter !== 'all' && tx.type !== ledgerTypeFilter) return false;
      if (!q) return true;
      return (
        tx.txnNumber.toLowerCase().includes(q) ||
        tx.partyName.toLowerCase().includes(q) ||
        tx.category.toLowerCase().includes(q) ||
        (tx.fundName || '').toLowerCase().includes(q) ||
        (tx.description || '').toLowerCase().includes(q)
      );
    });
  }, [transactions, ledgerSearch, ledgerTypeFilter]);

  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter(
      (l) =>
        l.action.toLowerCase().includes(q) ||
        l.adminName.toLowerCase().includes(q) ||
        l.entityType.toLowerCase().includes(q) ||
        (l.reason || '').toLowerCase().includes(q)
    );
  }, [auditLogs, auditSearch]);

  const memberLoginMap = useMemo(() => {
    const map = new Map<string, AdminRoleAccount>();
    for (const acc of [...adminAccounts, ...memberAccounts]) {
      if (acc.memberId) map.set(acc.memberId, acc);
    }
    return map;
  }, [adminAccounts, memberAccounts]);

  if (!isAdmin) {
    return (
      <div className="max-w-xl mx-auto mt-10 p-6 rounded-2xl bg-white dark:bg-[#121D18] border border-rose-200 dark:border-rose-900/60 text-center space-y-3">
        <Lock className="w-10 h-10 text-rose-600 mx-auto" />
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Admin Access Only</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Only authorized Committee Administrators can access the Admin Control Panel. Member accounts have read-only access.
        </p>
      </div>
    );
  }

  // ---------- HANDLERS ----------
  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiRequest<{
        ok: boolean;
        memberCode: string;
        initialPassword: string;
      }>('/api/members', {
        method: 'POST',
        body: JSON.stringify({
          fullName: newMember.fullName.trim(),
          phone: newMember.phone.trim(),
          village: newMember.village.trim(),
          memberCode: newMember.memberCode.trim() || undefined,
          monthlyAmount: Number(newMember.monthlyAmount),
          joiningDate: newMember.joiningDate,
          password: newMember.password.trim() || undefined,
        }),
      });
      onNotify(
        `Member ${res.memberCode} added successfully! Login ID: ${res.memberCode} | Initial Password: ${res.initialPassword}`
      );
      setShowAddMember(false);
      setNewMember({
        fullName: '',
        phone: '',
        village: 'Ragdih',
        memberCode: '',
        monthlyAmount: String(settings?.defaultMonthlyContribution || 500),
        joiningDate: new Date().toISOString().slice(0, 10),
        password: '',
      });
      await onRefresh();
      await loadAdminOverviewAndRoles();
    } catch (err: any) {
      onNotify(err?.message || 'Failed to add member.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateMember(e: React.FormEvent) {
    e.preventDefault();
    if (!editingMember) return;
    setSubmitting(true);
    try {
      await apiRequest(`/api/members/${editingMember.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          fullName: editMemberForm.fullName.trim(),
          phone: editMemberForm.phone.trim(),
          village: editMemberForm.village.trim(),
          monthlyAmount: Number(editMemberForm.monthlyAmount),
          status: editMemberForm.status,
          newPassword: editMemberForm.newPassword.trim() || undefined,
        }),
      });
      onNotify(`Member ${editingMember.memberCode} updated.`);
      setEditingMember(null);
      await onRefresh();
      await loadAdminOverviewAndRoles();
    } catch (err: any) {
      onNotify(err?.message || 'Failed to update member.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleMemberStatus(m: MemberSummary) {
    const nextStatus = m.status === 'active' ? 'inactive' : 'active';
    try {
      await apiRequest(`/api/members/${m.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: nextStatus }),
      });
      onNotify(`Member ${m.memberCode} marked ${nextStatus.toUpperCase()}.`);
      await onRefresh();
      await loadAdminOverviewAndRoles();
    } catch (err: any) {
      onNotify(err?.message || 'Failed to change member status.', 'error');
    }
  }

  async function handleMemberAccessUpdate(isActive: boolean) {
    if (!accessModalMember) return;
    setSubmitting(true);
    try {
      await apiRequest(`/api/admin/members/${accessModalMember.id}/access`, {
        method: 'POST',
        body: JSON.stringify({
          isActive,
          resetPassword: accessPassword.trim() || undefined,
        }),
      });
      onNotify(
        isActive
          ? `Login access enabled for ${accessModalMember.memberCode}.`
          : `Login access revoked for ${accessModalMember.memberCode}.`
      );
      setAccessModalMember(null);
      setAccessPassword('');
      await onRefresh();
      await loadAdminOverviewAndRoles();
    } catch (err: any) {
      onNotify(err?.message || 'Failed to update member login access.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSafeRemoveMember() {
    if (!removeConfirmMember) return;
    setSubmitting(true);
    try {
      const res = await apiRequest<{ ok: boolean; softDeactivated?: boolean; message?: string }>(
        `/api/members/${removeConfirmMember.id}`,
        { method: 'DELETE' }
      );
      onNotify(
        res.message ||
          (res.softDeactivated
            ? `Member ${removeConfirmMember.memberCode} deactivated & access revoked. Full payment history preserved.`
            : `Member ${removeConfirmMember.memberCode} removed safely.`)
      );
      setRemoveConfirmMember(null);
      await onRefresh();
      await loadAdminOverviewAndRoles();
    } catch (err: any) {
      onNotify(err?.message || 'Failed to remove member.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateFund(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiRequest<{ ok: boolean; fund: FundSummary }>('/api/funds', {
        method: 'POST',
        body: JSON.stringify(newFund),
      });
      if (res.fund) {
        void syncFundToFirestore(res.fund).catch(() => {});
      }
      onNotify(`New fund "${newFund.nameEn}" created safely (₹0 opening balance to keep reconciliation balanced).`);
      setShowAddFund(false);
      setNewFund({
        code: '',
        nameEn: '',
        nameHi: '',
        nameUr: '',
        scope: 'general',
        description: '',
        isRestricted: false,
        restrictedRule: '',
      });
      await onRefresh();
      await loadAdminOverviewAndRoles();
    } catch (err: any) {
      onNotify(err?.message || 'Failed to create fund.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateFund(e: React.FormEvent) {
    e.preventDefault();
    if (!editingFund) return;
    setSubmitting(true);
    try {
      const res = await apiRequest<{ ok: boolean; fund: FundSummary }>(`/api/funds/${editingFund.id}`, {
        method: 'PUT',
        body: JSON.stringify(editFundForm),
      });
      if (res.fund) {
        void syncFundToFirestore(res.fund).catch(() => {});
      }
      onNotify(`Fund "${editFundForm.nameEn}" updated.`);
      setEditingFund(null);
      await onRefresh();
      await loadAdminOverviewAndRoles();
    } catch (err: any) {
      onNotify(err?.message || 'Failed to update fund.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleFundActive(f: FundSummary) {
    const nextActive = f.isActive === false;
    try {
      const res = await apiRequest<{ ok: boolean; fund: FundSummary }>(`/api/funds/${f.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: nextActive }),
      });
      if (res.fund) {
        void syncFundToFirestore(res.fund).catch(() => {});
      }
      onNotify(`Fund "${f.nameEn}" marked ${nextActive ? 'ACTIVE' : 'INACTIVE'}.`);
      await onRefresh();
      await loadAdminOverviewAndRoles();
    } catch (err: any) {
      onNotify(err?.message || 'Failed to toggle fund status.', 'error');
    }
  }

  async function handleCreateTransaction(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiRequest<{ ok: boolean; txnNumber: string; status: string }>('/api/transactions', {
        method: 'POST',
        body: JSON.stringify({
          type: txnForm.type,
          fundId: txnForm.fundId,
          bankAccountId: txnForm.paymentMethod === 'Cash' ? null : primaryBank?.id || null,
          amount: Number(txnForm.amount),
          category: txnForm.category.trim(),
          partyName: txnForm.partyName.trim(),
          paymentMethod: txnForm.paymentMethod,
          date: txnForm.date,
          description: txnForm.description.trim(),
        }),
      });
      onNotify(
        res.status === 'pending_approval'
          ? `Entry ${res.txnNumber} queued for 2nd Administrator approval (exceeds ₹${settings?.dualApprovalLimit || 5000}).`
          : `Entry ${res.txnNumber} posted to ledger.`
      );
      setQuickTxnModal(null);
      setTxnForm((prev) => ({ ...prev, amount: '', partyName: '', description: '' }));
      await onRefresh();
      await loadAdminOverviewAndRoles();
    } catch (err: any) {
      onNotify(err?.message || 'Failed to record entry.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEditTxnMetadata(e: React.FormEvent) {
    e.preventDefault();
    if (!editingTxn) return;
    setSubmitting(true);
    try {
      await apiRequest(`/api/transactions/${editingTxn.id}`, {
        method: 'PUT',
        body: JSON.stringify(editTxnForm),
      });
      onNotify(`Metadata updated for ${editingTxn.txnNumber} and recorded in Audit Log.`);
      setEditingTxn(null);
      await onRefresh();
      await loadAdminOverviewAndRoles();
    } catch (err: any) {
      onNotify(err?.message || 'Failed to update transaction.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReverseTxn(e: React.FormEvent) {
    e.preventDefault();
    if (!reversingTxn) return;
    setSubmitting(true);
    try {
      const res = await apiRequest<{ ok: boolean; reversalTxnNumber: string }>(
        `/api/transactions/${reversingTxn.id}/reverse`,
        {
          method: 'POST',
          body: JSON.stringify({ reason: reverseReason.trim() }),
        }
      );
      onNotify(`Reversal entry ${res.reversalTxnNumber} created for ${reversingTxn.txnNumber}.`);
      setReversingTxn(null);
      setReverseReason('');
      await onRefresh();
      await loadAdminOverviewAndRoles();
    } catch (err: any) {
      onNotify(err?.message || 'Failed to reverse transaction.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApprovalDecision(e: React.FormEvent) {
    e.preventDefault();
    if (!approvalDecisionModal) return;
    setSubmitting(true);
    try {
      await apiRequest(`/api/transactions/${approvalDecisionModal.txn.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          decision: approvalDecisionModal.decision,
          reason: approvalReason.trim() || undefined,
        }),
      });
      onNotify(
        `Expense ${approvalDecisionModal.txn.txnNumber} ${
          approvalDecisionModal.decision === 'approve' ? 'APPROVED & POSTED' : 'REJECTED'
        }.`
      );
      setApprovalDecisionModal(null);
      setApprovalReason('');
      await onRefresh();
      await loadAdminOverviewAndRoles();
    } catch (err: any) {
      onNotify(err?.message || 'Failed to process approval.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUploadLogo(file: File | null) {
    if (!file) return;
    setUploadingLogo(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await apiRequest<{ ok: boolean; url: string }>('/api/uploads/image', {
        method: 'POST',
        body: JSON.stringify({ dataUrl, purpose: 'app_logo' }),
      });
      setSettingsForm((prev) => ({ ...prev, appLogoUrl: res.url }));
      onNotify('App logo uploaded. Click "Save All App Settings" to apply everywhere.');
    } catch (err: any) {
      onNotify(err?.message || 'Logo upload failed.', 'error');
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleUploadQr(file: File | null) {
    if (!file) return;
    setUploadingQr(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await apiRequest<{ ok: boolean; url: string }>('/api/uploads/image', {
        method: 'POST',
        body: JSON.stringify({ dataUrl, purpose: 'upi_qr' }),
      });
      setBankForm((prev) => ({ ...prev, qrCodeUrl: res.url }));
      onNotify('Official UPI QR Code uploaded. Click "Save Bank & UPI Settings" to publish.');
    } catch (err: any) {
      onNotify(err?.message || 'QR upload failed.', 'error');
    } finally {
      setUploadingQr(false);
    }
  }

  async function handleSaveAppSettings(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiRequest<{ ok: boolean; settings: AppSettings }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          committeeName: settingsForm.committeeName.trim(),
          committeeAddress: settingsForm.committeeAddress.trim(),
          appLogoUrl: settingsForm.appLogoUrl.trim(),
          defaultLanguage: settingsForm.defaultLanguage,
          memberLoginEnabled: settingsForm.memberLoginEnabled,
          autoBackupEnabled: settingsForm.autoBackupEnabled,
          defaultMonthlyContribution: Number(settingsForm.defaultMonthlyContribution),
          dualApprovalEnabled: settingsForm.dualApprovalEnabled,
          dualApprovalLimit: Number(settingsForm.dualApprovalLimit),
          reminderDayOfMonth: Number(settingsForm.reminderDayOfMonth),
          reminderFrequency: settingsForm.reminderFrequency,
          hideMemberPhonesForMembers: settingsForm.hideMemberPhonesForMembers,
        }),
      });
      if (res.settings) {
        void syncSettingsToFirestore(res.settings).catch(() => {});
      }
      setLang(settingsForm.defaultLanguage);
      onNotify('All Application Settings saved and logged.');
      await onRefresh();
    } catch (err: any) {
      onNotify(err?.message || 'Failed to save app settings.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveBankUpi(e: React.FormEvent) {
    e.preventDefault();
    if (!primaryBank) return;
    setSubmitting(true);
    try {
      await apiRequest(`/api/banks/${primaryBank.id}`, {
        method: 'PUT',
        body: JSON.stringify(bankForm),
      });
      void syncBankUpiToFirestore({ ...primaryBank, ...bankForm }).catch(() => {});
      onNotify('Bank Account, UPI ID & Official QR Code updated.');
      await onRefresh();
    } catch (err: any) {
      onNotify(err?.message || 'Failed to save bank/UPI settings.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateBackupSnapshot() {
    try {
      const res = await apiRequest<{ ok: boolean; fileName?: string }>('/api/backup/snapshot', {
        method: 'POST',
      });
      onNotify(`Database snapshot created: ${res.fileName || 'saved safely'}`);
      await onRefresh();
    } catch (err: any) {
      onNotify(err?.message || 'Failed to create backup snapshot.', 'error');
    }
  }

  async function handleDownloadJsonBackup() {
    try {
      const data = await apiRequest<Record<string, unknown>>('/api/backup/export-json');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SGN_Committee_Backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      onNotify('Full JSON backup downloaded.');
    } catch (err: any) {
      onNotify(err?.message || 'Failed to export backup.', 'error');
    }
  }

  async function handleCloudSync() {
    setSyncingCloud(true);
    try {
      if (!firebaseUser) {
        await onConnectFirebase();
      }
      const res = await onSyncFirestore();
      onNotify(`Synced ${res.syncedDocuments} records across ${res.syncedCollections} Firestore collections.`);
    } catch (err: any) {
      onNotify(err?.message || 'Cloud Firestore sync failed.', 'error');
    } finally {
      setSyncingCloud(false);
    }
  }

  async function handlePromoteSecondaryAdmin(e: React.FormEvent) {
    e.preventDefault();
    if (!promoteUserId) return;
    setSubmitting(true);
    try {
      const res = await apiRequest<{ ok: boolean; username: string }>('/api/admin/roles/promote', {
        method: 'POST',
        body: JSON.stringify({ userId: promoteUserId, reason: roleActionReason.trim() || undefined }),
      });
      onNotify(`User ${res.username} promoted to Secondary Administrator.`);
      setPromoteUserId('');
      setRoleActionReason('');
      await loadAdminOverviewAndRoles();
      await onRefresh();
    } catch (err: any) {
      onNotify(err?.message || 'Failed to promote member.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevokeSecondaryAdmin() {
    if (!revokeTarget) return;
    setSubmitting(true);
    try {
      await apiRequest('/api/admin/roles/revoke', {
        method: 'POST',
        body: JSON.stringify({
          userId: revokeTarget.id,
          reason: roleActionReason.trim() || 'Secondary Administrator privileges revoked by Super Admin',
        }),
      });
      onNotify(`Secondary Administrator privileges revoked for ${revokeTarget.username}.`);
      setRevokeTarget(null);
      setRoleActionReason('');
      await loadAdminOverviewAndRoles();
      await onRefresh();
    } catch (err: any) {
      onNotify(err?.message || 'Failed to revoke Secondary Admin.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function handleExportCurrentReport(format: 'pdf' | 'excel') {
    if (reportType === 'daily' || reportType === 'monthly' || reportType === 'yearly') {
      if (!periodReport) {
        onNotify('Report data is still loading. Please wait a moment.', 'error');
        return;
      }
      if (format === 'pdf') downloadFinancialReportPDF(periodReport);
      else downloadFinancialReportExcel(periodReport);
      return;
    }
    if (reportType === 'member_wise') {
      if (format === 'pdf') downloadMemberWiseReportPDF(members);
      else downloadMemberWiseReportExcel(members);
      return;
    }
    if (reportType === 'fund_wise') {
      if (format === 'pdf') downloadFundWiseReportPDF(funds);
      else downloadFundWiseReportExcel(funds);
      return;
    }
    if (reportType === 'income_expense') {
      if (format === 'pdf') downloadIncomeExpenseReportPDF(transactions);
      else downloadIncomeExpenseReportExcel(transactions);
      return;
    }
    if (reportType === 'salary') {
      if (format === 'pdf') downloadSalaryReportPDF(staff);
      else downloadSalaryReportExcel(staff);
      return;
    }
    if (reportType === 'pending_dues') {
      if (format === 'pdf') downloadPendingDuesReportPDF(members);
      else downloadPendingDuesReportExcel(members);
    }
  }

  const tabs: Array<{ key: AdminSubTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { key: 'overview', label: 'Admin Dashboard', icon: Shield },
    { key: 'members', label: 'Members', icon: Users },
    { key: 'funds', label: 'Funds', icon: Wallet },
    { key: 'ledger', label: 'Income & Expense', icon: TrendingUp },
    { key: 'settings', label: 'App & UPI Settings', icon: Building2 },
    { key: 'reports', label: '8 Reports (PDF/Excel)', icon: FileText },
    { key: 'roles', label: 'Admin Roles & Audit', icon: Crown },
  ];

  const ov = overview;

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-[#0B4F32] via-[#0F5D3B] to-[#0B4F32] text-white p-5 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-emerald-200 text-xs font-semibold uppercase tracking-wider">
            <Shield className="w-4 h-4" />
            <span>{isSuperAdmin ? 'Primary Super Admin Control Center' : 'Secondary Authorized Admin Control Center'}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Complete Admin Control Panel</h1>
          <p className="text-xs sm:text-sm text-emerald-100/90">
            Full control over Members, Funds, Income & Expense, UPI QR Settings, 8 Exportable Reports, and Dual-Admin Security.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              onRefresh();
              loadAdminOverviewAndRoles();
            }}
            className="min-h-[40px] px-3.5 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingAdminData ? 'animate-spin' : ''}`} />
            Refresh Live Data
          </button>
          <button
            type="button"
            onClick={() => onNavigate('bank')}
            className="min-h-[40px] px-3.5 rounded-xl bg-amber-400 text-slate-950 hover:bg-amber-300 text-xs font-bold inline-flex items-center gap-1.5"
          >
            <QrCode className="w-3.5 h-3.5" />
            Verify UPI Proofs ({ov?.pendingPaymentsCount ?? submissions.filter((s) => s.status === 'pending_verification').length})
          </button>
        </div>
      </div>

      {/* Sub-tab Navigation */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = subTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSubTab(tab.key)}
              className={`min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap border transition-colors ${
                active
                  ? 'bg-[#0B4F32] text-white border-[#0B4F32]'
                  : 'bg-white dark:bg-[#121D18] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ================= TAB 1: ADMIN DASHBOARD OVERVIEW (ALL 11 KPIs) ================= */}
      {subTab === 'overview' && (
        <div className="space-y-5">
          {/* 10 Primary KPI Cards + Fund-Wise Grid below (= all 11 required metrics) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <KpiCard
              label="Total Members"
              value={String(ov?.totalMembers ?? members.length)}
              sub="All registered members"
              icon={Users}
              tone="slate"
              onClick={() => setSubTab('members')}
            />
            <KpiCard
              label="Active Members"
              value={String(ov?.activeMembers ?? members.filter((m) => m.status === 'active').length)}
              sub="Contributing active"
              icon={UserCheck}
              tone="emerald"
              onClick={() => {
                setMemberStatusFilter('active');
                setSubTab('members');
              }}
            />
            <KpiCard
              label="Inactive Members"
              value={String(ov?.inactiveMembers ?? members.filter((m) => m.status === 'inactive').length)}
              sub="Paused / history preserved"
              icon={UserX}
              tone="amber"
              onClick={() => {
                setMemberStatusFilter('inactive');
                setSubTab('members');
              }}
            />
            <KpiCard
              label="Total Income"
              value={formatINR(ov?.totalIncome ?? 0, numerals)}
              sub="All verified receipts"
              icon={TrendingUp}
              tone="emerald"
              onClick={() => setSubTab('ledger')}
            />
            <KpiCard
              label="Total Expenses"
              value={formatINR(ov?.totalExpenses ?? 0, numerals)}
              sub="All approved expenses"
              icon={TrendingDown}
              tone="rose"
              onClick={() => setSubTab('ledger')}
            />
            <KpiCard
              label="Available Balance"
              value={formatINR(ov?.availableBalance ?? 0, numerals)}
              sub={`Bank ${formatINR(ov?.bankBalance ?? 0, numerals)} · Cash ${formatINR(ov?.cashBalance ?? 0, numerals)}`}
              icon={Wallet}
              tone="emerald"
              onClick={() => setSubTab('funds')}
            />
            <KpiCard
              label="Monthly Collection"
              value={formatINR(ov?.monthlyCollection ?? 0, numerals)}
              sub={ov ? formatMonthKey(ov.currentMonthKey, lang, numerals) : 'This Month'}
              icon={Calendar}
              tone="emerald"
              onClick={() => setSubTab('reports')}
            />
            <KpiCard
              label="Monthly Expenses"
              value={formatINR(ov?.monthlyExpenses ?? 0, numerals)}
              sub={ov ? formatMonthKey(ov.currentMonthKey, lang, numerals) : 'This Month'}
              icon={TrendingDown}
              tone="rose"
              onClick={() => setSubTab('reports')}
            />
            <KpiCard
              label="Pending Payments"
              value={`${ov?.pendingPaymentsCount ?? 0} UPI`}
              sub={`Dues: ${formatINR(ov?.totalOutstandingDues ?? 0, numerals)}`}
              icon={Clock}
              tone="amber"
              onClick={() => onNavigate('bank')}
            />
            <KpiCard
              label="Pending Approvals"
              value={`${ov?.pendingApprovalsCount ?? pendingApprovalTxns.length} (>₹${settings?.dualApprovalLimit || 5000})`}
              sub={formatINR(ov?.pendingApprovalsAmount ?? 0, numerals)}
              icon={ShieldAlert}
              tone="amber"
              onClick={() => setSubTab('ledger')}
            />
          </div>

          {/* Double-Entry Reconciliation & Quick Admin Shortcuts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Accounting Reconciliation</span>
                <span
                  className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                    (ov?.reconciliation || reconciliation)?.isReconciled
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'bg-rose-100 text-rose-800'
                  }`}
                >
                  {(ov?.reconciliation || reconciliation)?.isReconciled ? '100% BALANCED' : 'CHECK REQUIRED'}
                </span>
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                <div className="flex justify-between">
                  <span>Physical Bank + Cash:</span>
                  <span className="font-data font-bold text-slate-900 dark:text-slate-100">
                    {formatINR((ov?.reconciliation || reconciliation)?.totalLiquidAssets ?? 0, numerals)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Sum of All Virtual Funds:</span>
                  <span className="font-data font-bold text-slate-900 dark:text-slate-100">
                    {formatINR((ov?.reconciliation || reconciliation)?.sumOfVirtualFunds ?? 0, numerals)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Authorized Admins:</span>
                  <span className="font-data font-bold text-emerald-700 dark:text-emerald-400">
                    {ov?.authorizedAdminsCount ?? adminAccounts.length} / {ov?.maxAdminsAllowed ?? 2} Max
                  </span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-2 rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Quick Admin Actions</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setSubTab('members');
                    setShowAddMember(true);
                  }}
                  className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-left space-y-1"
                >
                  <Plus className="w-4 h-4 text-[#0B4F32] dark:text-emerald-400" />
                  <div className="text-xs font-bold">Add Member</div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSubTab('funds');
                    setShowAddFund(true);
                  }}
                  className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-left space-y-1"
                >
                  <Wallet className="w-4 h-4 text-[#0B4F32] dark:text-emerald-400" />
                  <div className="text-xs font-bold">Create New Fund</div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTxnForm((p) => ({ ...p, type: 'income', fundId: activeFunds[0]?.id || 'fund_masjid' }));
                    setQuickTxnModal({ type: 'income', fundId: activeFunds[0]?.id || 'fund_masjid' });
                  }}
                  className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-left space-y-1"
                >
                  <ArrowUpRight className="w-4 h-4 text-emerald-600" />
                  <div className="text-xs font-bold">Add Income</div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTxnForm((p) => ({ ...p, type: 'expense', fundId: activeFunds[0]?.id || 'fund_masjid', category: 'Maintenance & Bills' }));
                    setQuickTxnModal({ type: 'expense', fundId: activeFunds[0]?.id || 'fund_masjid' });
                  }}
                  className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-left space-y-1"
                >
                  <ArrowDownRight className="w-4 h-4 text-rose-600" />
                  <div className="text-xs font-bold">Record Expense</div>
                </button>
              </div>
            </div>
          </div>

          {/* 11th KPI: Fund Wise Balance Grid */}
          <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Fund-Wise Balances ({(ov?.fundWiseBalances || funds).length} Virtual Ledgers)
                </h2>
                <p className="text-xs text-slate-500">All 10 original committee funds + any custom funds created by Admin</p>
              </div>
              <button
                type="button"
                onClick={() => setSubTab('funds')}
                className="text-xs font-bold text-[#0B4F32] dark:text-emerald-400 hover:underline"
              >
                Manage All Funds →
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {(ov?.fundWiseBalances || funds).map((f) => (
                <div
                  key={f.id}
                  className={`p-3.5 rounded-xl border ${
                    f.isActive === false
                      ? 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 opacity-75'
                      : 'border-slate-200 dark:border-slate-800 bg-[#F8FAF9] dark:bg-[#0E1713]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                        {getFundLabel(f, lang)}
                      </div>
                      <div className="text-[11px] text-slate-500">{f.code} · {f.scope.toUpperCase()}</div>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        f.isActive === false
                          ? 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-400'
                          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      }`}
                    >
                      {f.isActive === false ? 'INACTIVE' : 'ACTIVE'}
                    </span>
                  </div>
                  <div className="mt-2.5 text-lg font-data font-bold text-[#0B4F32] dark:text-emerald-400">
                    {formatINR(f.currentBalance, numerals)}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                    <span>In: {formatINR(f.totalIncome, numerals)}</span>
                    <span>Out: {formatINR(f.totalExpense, numerals)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 2: MEMBER MANAGEMENT ================= */}
      {subTab === 'members' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-[#121D18] p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="Search member by name, ID, phone, village..."
                  className="w-full min-h-[40px] pl-9 pr-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
                />
              </div>
              <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                {(['all', 'active', 'inactive'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setMemberStatusFilter(st)}
                    className={`px-3 py-2 text-xs font-semibold capitalize ${
                      memberStatusFilter === st
                        ? 'bg-[#0B4F32] text-white'
                        : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowAddMember(true)}
              className="min-h-[42px] px-4 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Add New Member
            </button>
          </div>

          <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/70 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-bold">Member ID & Name</th>
                  <th className="px-4 py-3 font-bold">Mobile & Address</th>
                  <th className="px-4 py-3 font-bold text-right">Monthly Fee</th>
                  <th className="px-4 py-3 font-bold text-right">Paid / Due</th>
                  <th className="px-4 py-3 font-bold">Status & Login</th>
                  <th className="px-4 py-3 font-bold text-right">Admin Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filteredMembers.map((m) => {
                  const loginAcc = memberLoginMap.get(m.id);
                  return (
                    <tr key={m.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-900/30">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900 dark:text-slate-100">{m.fullName}</div>
                        <div className="text-[11px] font-data text-slate-500">ID: {m.memberCode} · Joined {m.joiningDate}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-data text-slate-800 dark:text-slate-200">{m.phone || '-'}</div>
                        <div className="text-[11px] text-slate-500">{m.village || '-'}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-data font-bold">
                        {formatINR(m.monthlyAmount, numerals)}
                      </td>
                      <td className="px-4 py-3 text-right font-data">
                        <div className="text-emerald-700 dark:text-emerald-400 font-semibold">
                          Paid: {formatINR(m.totalPaid, numerals)}
                        </div>
                        <div className={m.outstandingAmount > 0 ? 'text-rose-600 font-bold' : 'text-slate-400'}>
                          Due: {formatINR(m.outstandingAmount, numerals)}
                        </div>
                      </td>
                      <td className="px-4 py-3 space-y-1">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            m.status === 'active'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          {m.status.toUpperCase()}
                        </span>
                        <div className="text-[11px] text-slate-500">
                          Login: {loginAcc ? (loginAcc.isActive ? 'Enabled' : 'Revoked') : 'Active'}
                          {loginAcc?.role === 'admin_secondary' ? ' · 2nd Admin' : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMember(m);
                              setEditMemberForm({
                                fullName: m.fullName,
                                phone: m.phone,
                                village: m.village,
                                monthlyAmount: String(m.monthlyAmount),
                                status: m.status,
                                newPassword: '',
                              });
                            }}
                            title="Edit Member"
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1"
                          >
                            <Edit3 className="w-3.5 h-3.5" /> Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleMemberStatus(m)}
                            title="Toggle Active/Inactive"
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-amber-50 dark:hover:bg-amber-950/30 inline-flex items-center gap-1"
                          >
                            <Power className="w-3.5 h-3.5" /> {m.status === 'active' ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAccessModalMember(m);
                              setAccessPassword('');
                            }}
                            title="Login Access & Password"
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1"
                          >
                            <KeyRound className="w-3.5 h-3.5" /> Access
                          </button>
                          <button
                            type="button"
                            onClick={() => setRemoveConfirmMember(m)}
                            title="Remove / Revoke (Preserves History)"
                            className="px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================= TAB 3: COMPLETE FUND MANAGEMENT ================= */}
      {subTab === 'funds' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-[#121D18] p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Complete Fund Management ({funds.length} Virtual Ledgers)
              </h2>
              <p className="text-xs text-slate-500">
                All 10 original funds and transaction history are strictly preserved. Funds can be created, edited, or toggled Active/Inactive.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddFund(true)}
              className="min-h-[42px] px-4 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 shrink-0"
            >
              <Plus className="w-4 h-4" />
              Create New Fund
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {funds.map((f) => (
              <div
                key={f.id}
                className={`rounded-2xl p-4 border bg-white dark:bg-[#121D18] space-y-3 ${
                  f.isActive === false
                    ? 'border-slate-200 dark:border-slate-800 opacity-75'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{getFundLabel(f, lang)}</h3>
                      <span className="text-[10px] font-data font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        {f.code}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          f.isActive === false
                            ? 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-400'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        }`}
                      >
                        {f.isActive === false ? 'INACTIVE' : 'ACTIVE'}
                      </span>
                      {f.isRestricted && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                          RESTRICTED
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {f.description || f.restrictedRule || `Separate virtual ledger (${f.scope})`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] uppercase text-slate-500 font-semibold">Balance</div>
                    <div className="text-lg font-data font-bold text-[#0B4F32] dark:text-emerald-400">
                      {formatINR(f.currentBalance, numerals)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 text-[11px] bg-slate-50 dark:bg-slate-900/60 p-2.5 rounded-xl font-data">
                  <div>
                    <span className="text-slate-500 block">Opening</span>
                    <span className="font-semibold">{formatINR(f.openingBalance, numerals)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Income</span>
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">{formatINR(f.totalIncome, numerals)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Expense</span>
                    <span className="font-semibold text-rose-600">{formatINR(f.totalExpense, numerals)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Entries</span>
                    <span className="font-semibold">{f.transactionCount}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {f.isActive !== false && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setTxnForm((p) => ({
                            ...p,
                            type: 'income',
                            fundId: f.id,
                            category: 'Donation / Chanda',
                          }));
                          setQuickTxnModal({ type: 'income', fundId: f.id });
                        }}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add Money
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTxnForm((p) => ({
                            ...p,
                            type: 'expense',
                            fundId: f.id,
                            category: 'Fund Expense',
                          }));
                          setQuickTxnModal({ type: 'expense', fundId: f.id });
                        }}
                        className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold inline-flex items-center gap-1"
                      >
                        <TrendingDown className="w-3.5 h-3.5" /> Expense
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditingFund(f);
                      setEditFundForm({
                        nameEn: f.nameEn,
                        nameHi: f.nameHi || '',
                        nameUr: f.nameUr || '',
                        scope: f.scope,
                        description: f.description || '',
                        isRestricted: f.isRestricted,
                        restrictedRule: f.restrictedRule || '',
                        isActive: f.isActive !== false,
                      });
                    }}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <Edit3 className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleFundActive(f)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                  >
                    <Power className="w-3.5 h-3.5" /> {f.isActive === false ? 'Activate' : 'Deactivate'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================= TAB 4: INCOME & EXPENSE CONTROL ================= */}
      {subTab === 'ledger' && (
        <div className="space-y-4">
          {/* Dual-Admin Pending Approvals (> ₹5,000) */}
          {pendingApprovalTxns.length > 0 && (
            <div className="rounded-2xl bg-amber-50/90 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-bold text-sm">
                  <ShieldAlert className="w-4 h-4" />
                  <span>Pending Dual-Admin Approvals ({pendingApprovalTxns.length} expenses above ₹{settings?.dualApprovalLimit || 5000})</span>
                </div>
                <span className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                  Creator cannot self-approve
                </span>
              </div>
              <div className="space-y-2">
                {pendingApprovalTxns.map((tx) => {
                  const isCreator = tx.createdBy === user.id;
                  return (
                    <div
                      key={tx.id}
                      className="p-3 rounded-xl bg-white dark:bg-[#121D18] border border-amber-200 dark:border-amber-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="text-xs space-y-0.5">
                        <div className="font-bold text-slate-900 dark:text-slate-100">
                          {tx.txnNumber} · {formatINR(tx.amount, numerals)} · {tx.category}
                        </div>
                        <div className="text-slate-500">
                          Party: {tx.partyName} · Fund: {tx.fundName || tx.fundId} · Entered by {tx.createdByName} on {tx.date}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {isCreator ? (
                          <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-900/40">
                            Awaiting 2nd Admin
                          </span>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setApprovalDecisionModal({ txn: tx, decision: 'approve' });
                                setApprovalReason('');
                              }}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setApprovalDecisionModal({ txn: tx, decision: 'reject' });
                                setApprovalReason('');
                              }}
                              className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1"
                            >
                              <XCircle className="w-3.5 h-3.5" /> Reject
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Action Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-[#121D18] p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={ledgerSearch}
                  onChange={(e) => setLedgerSearch(e.target.value)}
                  placeholder="Search Txn #, party, category, fund..."
                  className="w-full min-h-[40px] pl-9 pr-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
                />
              </div>
              <select
                value={ledgerTypeFilter}
                onChange={(e) => setLedgerTypeFilter(e.target.value as any)}
                className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-semibold"
              >
                <option value="all">All Types</option>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
                <option value="transfer">Transfer</option>
                <option value="reversal">Reversal</option>
              </select>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setTxnForm((p) => ({
                    ...p,
                    type: 'income',
                    fundId: activeFunds[0]?.id || 'fund_masjid',
                    category: 'Donation / Chanda',
                  }));
                  setQuickTxnModal({ type: 'income', fundId: activeFunds[0]?.id || 'fund_masjid' });
                }}
                className="min-h-[40px] px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1"
              >
                <Plus className="w-4 h-4" /> Add Income
              </button>
              <button
                type="button"
                onClick={() => {
                  setTxnForm((p) => ({
                    ...p,
                    type: 'expense',
                    fundId: activeFunds[0]?.id || 'fund_masjid',
                    category: 'Maintenance & Bills',
                  }));
                  setQuickTxnModal({ type: 'expense', fundId: activeFunds[0]?.id || 'fund_masjid' });
                }}
                className="min-h-[40px] px-3.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1"
              >
                <TrendingDown className="w-4 h-4" /> Add Expense
              </button>
            </div>
          </div>

          <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/70 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-bold">Txn # & Date</th>
                  <th className="px-4 py-3 font-bold">Type & Fund</th>
                  <th className="px-4 py-3 font-bold">Category & Party</th>
                  <th className="px-4 py-3 font-bold text-right">Amount</th>
                  <th className="px-4 py-3 font-bold">Status</th>
                  <th className="px-4 py-3 font-bold text-right">Audited Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filteredTransactions.slice(0, 80).map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-900/30">
                    <td className="px-4 py-3 font-data">
                      <div className="font-bold text-slate-900 dark:text-slate-100">{tx.txnNumber}</div>
                      <div className="text-[11px] text-slate-500">{tx.date} · {tx.paymentMethod}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          tx.type === 'income'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : tx.type === 'expense'
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {tx.type}
                      </span>
                      <div className="text-[11px] text-slate-500 mt-0.5">{tx.fundName || tx.fundId}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">{tx.category}</div>
                      <div className="text-[11px] text-slate-500">{tx.partyName}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-data font-bold">
                      {formatINR(tx.amount, numerals)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          tx.status === 'approved'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : tx.status === 'pending_approval'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        {tx.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {(tx.status === 'approved' || tx.status === 'pending_approval') && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTxn(tx);
                              setEditTxnForm({
                                category: tx.category,
                                partyName: tx.partyName,
                                description: tx.description || '',
                                reason: '',
                              });
                            }}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1"
                          >
                            <Edit3 className="w-3 h-3" /> Edit Note
                          </button>
                        )}
                        {tx.status === 'approved' && (
                          <button
                            type="button"
                            onClick={() => {
                              setReversingTxn(tx);
                              setReverseReason('');
                            }}
                            className="px-2.5 py-1 rounded-lg border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 inline-flex items-center gap-1"
                          >
                            <RotateCcw className="w-3 h-3" /> Reverse
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================= TAB 5: APP & UPI SETTINGS CONTROL ================= */}
      {subTab === 'settings' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* App Branding, Governance, Language, Member Login & Backup Settings */}
          <form
            onSubmit={handleSaveAppSettings}
            className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">App Identity, Access & Governance Settings</h2>
                <p className="text-xs text-slate-500">App Name, Logo, Monthly Dues, Reminders, Language & Member Access</p>
              </div>
            </div>

            {/* App Logo Upload */}
            <div className="flex items-center gap-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
              <img
                src={settingsForm.appLogoUrl || COMMITTEE_LOGO_URL}
                alt="Committee Logo"
                referrerPolicy="no-referrer"
                className="w-14 h-14 rounded-full object-contain bg-white p-1 border border-slate-200 shrink-0"
              />
              <div className="flex-1 min-w-0 space-y-1">
                <div className="text-xs font-bold">App / Committee Logo</div>
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0B4F32] text-white text-xs font-semibold cursor-pointer hover:bg-[#093F28]">
                  <Upload className="w-3.5 h-3.5" />
                  <span>{uploadingLogo ? 'Uploading...' : 'Upload New Logo'}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => handleUploadLogo(e.target.files?.[0] || null)}
                  />
                </label>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1">App / Committee Name</label>
                <input
                  type="text"
                  required
                  value={settingsForm.committeeName}
                  onChange={(e) => setSettingsForm({ ...settingsForm, committeeName: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Committee Address</label>
                <input
                  type="text"
                  required
                  value={settingsForm.committeeAddress}
                  onChange={(e) => setSettingsForm({ ...settingsForm, committeeAddress: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Default Monthly Contribution (₹)</label>
                  <input
                    type="number"
                    min={10}
                    max={100000}
                    required
                    value={settingsForm.defaultMonthlyContribution}
                    onChange={(e) => setSettingsForm({ ...settingsForm, defaultMonthlyContribution: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-data"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Dual-Admin Approval Limit (₹)</label>
                  <input
                    type="number"
                    min={500}
                    max={10000000}
                    required
                    value={settingsForm.dualApprovalLimit}
                    onChange={(e) => setSettingsForm({ ...settingsForm, dualApprovalLimit: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-data"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Reminder Day (1–28)</label>
                  <input
                    type="number"
                    min={1}
                    max={28}
                    required
                    value={settingsForm.reminderDayOfMonth}
                    onChange={(e) => setSettingsForm({ ...settingsForm, reminderDayOfMonth: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-data"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Reminder Frequency</label>
                  <select
                    value={settingsForm.reminderFrequency}
                    onChange={(e) => setSettingsForm({ ...settingsForm, reminderFrequency: e.target.value as any })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-semibold"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="biweekly">Bi-Weekly</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Default Language</label>
                  <select
                    value={settingsForm.defaultLanguage}
                    onChange={(e) => setSettingsForm({ ...settingsForm, defaultLanguage: e.target.value as Language })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-semibold"
                  >
                    <option value="en">English</option>
                    <option value="hi">हिन्दी (Hindi)</option>
                    <option value="ur">اردو (Urdu)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2.5 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.dualApprovalEnabled}
                    onChange={(e) => setSettingsForm({ ...settingsForm, dualApprovalEnabled: e.target.checked })}
                    className="rounded border-slate-300"
                  />
                  <span>Require 2nd Administrator approval for expenses above limit</span>
                </label>
                <label className="flex items-center gap-2.5 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.memberLoginEnabled}
                    onChange={(e) => setSettingsForm({ ...settingsForm, memberLoginEnabled: e.target.checked })}
                    className="rounded border-slate-300"
                  />
                  <span>Enable Member Panel Login (uncheck to temporarily pause non-admin logins)</span>
                </label>
                <label className="flex items-center gap-2.5 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.hideMemberPhonesForMembers}
                    onChange={(e) => setSettingsForm({ ...settingsForm, hideMemberPhonesForMembers: e.target.checked })}
                    className="rounded border-slate-300"
                  />
                  <span>Mask other members&apos; mobile numbers in Member Panel (Privacy protection)</span>
                </label>
                <label className="flex items-center gap-2.5 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.autoBackupEnabled}
                    onChange={(e) => setSettingsForm({ ...settingsForm, autoBackupEnabled: e.target.checked })}
                    className="rounded border-slate-300"
                  />
                  <span>Enable Automatic Periodic Database Backups</span>
                </label>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[44px] rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-bold disabled:opacity-60"
            >
              {submitting ? 'Saving...' : 'Save All App Settings'}
            </button>
          </form>

          {/* Bank Account, UPI ID, Official UPI QR Code & Cloud/Backup Controls */}
          <div className="space-y-5">
            <form
              onSubmit={handleSaveBankUpi}
              className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5 space-y-4"
            >
              <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Official Bank Account & UPI QR Settings</h2>
                <p className="text-xs text-slate-500">Single physical bank account linked to all virtual funds & Member UPI scanner</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Bank Name</label>
                  <input
                    type="text"
                    required
                    value={bankForm.bankName}
                    onChange={(e) => setBankForm({ ...bankForm, bankName: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Account Holder Name</label>
                  <input
                    type="text"
                    required
                    value={bankForm.accountName}
                    onChange={(e) => setBankForm({ ...bankForm, accountName: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Account Number</label>
                  <input
                    type="text"
                    required
                    value={bankForm.accountNumber}
                    onChange={(e) => setBankForm({ ...bankForm, accountNumber: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-data"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">IFSC Code</label>
                  <input
                    type="text"
                    required
                    value={bankForm.ifsc}
                    onChange={(e) => setBankForm({ ...bankForm, ifsc: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-data"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Branch</label>
                  <input
                    type="text"
                    value={bankForm.branch}
                    onChange={(e) => setBankForm({ ...bankForm, branch: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Official UPI ID</label>
                  <input
                    type="text"
                    required
                    value={bankForm.upiId}
                    onChange={(e) => setBankForm({ ...bankForm, upiId: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-data"
                  />
                </div>
              </div>

              <div className="flex items-center gap-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
                {bankForm.qrCodeUrl ? (
                  <img
                    src={bankForm.qrCodeUrl}
                    alt="Official UPI QR"
                    referrerPolicy="no-referrer"
                    className="w-16 h-16 rounded-lg object-cover border border-slate-200 bg-white shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-lg border border-dashed border-slate-300 flex items-center justify-center text-slate-400">
                    <QrCode className="w-6 h-6" />
                  </div>
                )}
                <div className="space-y-1">
                  <div className="text-xs font-bold">Official Bank UPI QR Code Image</div>
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-emerald-700 text-white text-xs font-semibold cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploadingQr ? 'Uploading...' : 'Replace / Upload QR Code'}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => handleUploadQr(e.target.files?.[0] || null)}
                    />
                  </label>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || !primaryBank}
                className="w-full min-h-[42px] rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-bold disabled:opacity-60"
              >
                Save Bank & UPI Settings
              </button>
            </form>

            {/* Backup & Cloud Sync Box */}
            <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Database Backup & Firebase Cloud Sync</h3>
                <span className="text-[11px] text-slate-500">
                  Last backup: {settings?.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleString('en-IN') : 'Today'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={handleCreateBackupSnapshot}
                  className="min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                >
                  <Database className="w-4 h-4 text-[#0B4F32] dark:text-emerald-400" />
                  Server Snapshot
                </button>
                <button
                  type="button"
                  onClick={handleDownloadJsonBackup}
                  className="min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                >
                  <FileText className="w-4 h-4 text-emerald-600" />
                  Export JSON
                </button>
                <button
                  type="button"
                  disabled={syncingCloud}
                  onClick={handleCloudSync}
                  className="min-h-[42px] px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
                >
                  <Cloud className="w-4 h-4" />
                  {syncingCloud ? 'Syncing...' : 'Sync Firestore'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 6: ALL 8 REPORTS CENTER (PDF & EXCEL) ================= */}
      {subTab === 'reports' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-4 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Complete Reports & Records Center (PDF & Excel Export)
                </h2>
                <p className="text-xs text-slate-500">
                  Generate and export Daily, Monthly, Yearly, Member-Wise, Fund-Wise, Income & Expense, Salary, and Pending Dues reports.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleExportCurrentReport('pdf')}
                  className="min-h-[40px] px-3.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <FileText className="w-4 h-4" /> Export PDF
                </button>
                <button
                  type="button"
                  onClick={() => handleExportCurrentReport('excel')}
                  className="min-h-[40px] px-3.5 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <FileSpreadsheet className="w-4 h-4" /> Export Excel
                </button>
              </div>
            </div>

            {/* 8 Report Selector Buttons */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(
                [
                  { key: 'daily', label: '1. Daily Report' },
                  { key: 'monthly', label: '2. Monthly Report' },
                  { key: 'yearly', label: '3. Yearly Report' },
                  { key: 'member_wise', label: '4. Member-Wise Report' },
                  { key: 'fund_wise', label: '5. Fund-Wise Report' },
                  { key: 'income_expense', label: '6. Income & Expense' },
                  { key: 'salary', label: '7. Salary Report' },
                  { key: 'pending_dues', label: '8. Pending Dues Report' },
                ] as const
              ).map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setReportType(r.key)}
                  className={`min-h-[40px] px-3 py-2 rounded-xl text-xs font-bold border text-left transition-colors ${
                    reportType === r.key
                      ? 'bg-[#0B4F32] text-white border-[#0B4F32]'
                      : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-100'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* Period Filter Controls */}
            {reportType === 'daily' && (
              <div className="flex items-center gap-3">
                <label className="text-xs font-semibold">Select Date:</label>
                <input
                  type="date"
                  value={reportDate}
                  onChange={(e) => setReportDate(e.target.value)}
                  className="min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-data"
                />
              </div>
            )}
            {reportType === 'monthly' && (
              <div className="flex items-center gap-3">
                <label className="text-xs font-semibold">Select Month:</label>
                <input
                  type="month"
                  value={reportMonth}
                  onChange={(e) => setReportMonth(e.target.value)}
                  className="min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-data"
                />
              </div>
            )}
            {reportType === 'yearly' && (
              <div className="flex items-center gap-3">
                <label className="text-xs font-semibold">Select Year:</label>
                <input
                  type="number"
                  min={2020}
                  max={2035}
                  value={reportYear}
                  onChange={(e) => setReportYear(e.target.value)}
                  className="w-28 min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-data"
                />
              </div>
            )}
          </div>

          {/* Live Report Preview Table */}
          <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-4 overflow-x-auto">
            {['daily', 'monthly', 'yearly'].includes(reportType) && (
              loadingReport ? (
                <div className="py-8 text-center text-xs text-slate-500">Generating {reportType} report...</div>
              ) : periodReport ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50">
                      <div className="text-[11px] text-slate-500">Verified Income</div>
                      <div className="text-base font-data font-bold text-emerald-700 dark:text-emerald-400">
                        {formatINR(periodReport.totalIncome, numerals)}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50">
                      <div className="text-[11px] text-slate-500">Verified Expense</div>
                      <div className="text-base font-data font-bold text-rose-700 dark:text-rose-400">
                        {formatINR(periodReport.totalExpense, numerals)}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <div className="text-[11px] text-slate-500">Net Surplus</div>
                      <div className="text-base font-data font-bold">{formatINR(periodReport.netSurplus, numerals)}</div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <div className="text-[11px] text-slate-500">Entries in Period</div>
                      <div className="text-base font-data font-bold">{periodReport.transactions.length}</div>
                    </div>
                  </div>
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="px-3 py-2.5">Txn #</th>
                        <th className="px-3 py-2.5">Date</th>
                        <th className="px-3 py-2.5">Type</th>
                        <th className="px-3 py-2.5">Fund</th>
                        <th className="px-3 py-2.5">Party / Category</th>
                        <th className="px-3 py-2.5 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                      {periodReport.transactions.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                            No verified transactions recorded for {periodReport.periodLabel}.
                          </td>
                        </tr>
                      ) : (
                        periodReport.transactions.map((tx) => (
                          <tr key={tx.id}>
                            <td className="px-3 py-2 font-data font-semibold">{tx.txnNumber}</td>
                            <td className="px-3 py-2 font-data">{tx.date}</td>
                            <td className="px-3 py-2 uppercase font-bold">{tx.type}</td>
                            <td className="px-3 py-2">{tx.fundName || tx.fundId}</td>
                            <td className="px-3 py-2">{tx.partyName} · {tx.category}</td>
                            <td className="px-3 py-2 text-right font-data font-bold">{formatINR(tx.amount, numerals)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              ) : null
            )}

            {reportType === 'member_wise' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-3 py-2.5">ID</th>
                    <th className="px-3 py-2.5">Member Name</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5 text-right">Monthly Fee</th>
                    <th className="px-3 py-2.5 text-right">Total Paid</th>
                    <th className="px-3 py-2.5 text-right">Pending Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td className="px-3 py-2 font-data font-semibold">{m.memberCode}</td>
                      <td className="px-3 py-2 font-semibold">{m.fullName}</td>
                      <td className="px-3 py-2 uppercase">{m.status}</td>
                      <td className="px-3 py-2 text-right font-data">{formatINR(m.monthlyAmount, numerals)}</td>
                      <td className="px-3 py-2 text-right font-data text-emerald-700 dark:text-emerald-400">{formatINR(m.totalPaid, numerals)}</td>
                      <td className="px-3 py-2 text-right font-data font-bold text-rose-600">{formatINR(m.outstandingAmount, numerals)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {reportType === 'fund_wise' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-3 py-2.5">Fund</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5 text-right">Opening</th>
                    <th className="px-3 py-2.5 text-right">Income</th>
                    <th className="px-3 py-2.5 text-right">Expense</th>
                    <th className="px-3 py-2.5 text-right">Available Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {funds.map((f) => (
                    <tr key={f.id}>
                      <td className="px-3 py-2 font-semibold">{getFundLabel(f, lang)}</td>
                      <td className="px-3 py-2 uppercase">{f.isActive === false ? 'INACTIVE' : 'ACTIVE'}</td>
                      <td className="px-3 py-2 text-right font-data">{formatINR(f.openingBalance, numerals)}</td>
                      <td className="px-3 py-2 text-right font-data text-emerald-700 dark:text-emerald-400">{formatINR(f.totalIncome, numerals)}</td>
                      <td className="px-3 py-2 text-right font-data text-rose-600">{formatINR(f.totalExpense, numerals)}</td>
                      <td className="px-3 py-2 text-right font-data font-bold">{formatINR(f.currentBalance, numerals)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {reportType === 'income_expense' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-3 py-2.5">Txn #</th>
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5">Type</th>
                    <th className="px-3 py-2.5">Fund</th>
                    <th className="px-3 py-2.5">Party</th>
                    <th className="px-3 py-2.5 text-right">Amount</th>
                    <th className="px-3 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {transactions.slice(0, 50).map((tx) => (
                    <tr key={tx.id}>
                      <td className="px-3 py-2 font-data font-semibold">{tx.txnNumber}</td>
                      <td className="px-3 py-2 font-data">{tx.date}</td>
                      <td className="px-3 py-2 uppercase">{tx.type}</td>
                      <td className="px-3 py-2">{tx.fundName || tx.fundId}</td>
                      <td className="px-3 py-2">{tx.partyName}</td>
                      <td className="px-3 py-2 text-right font-data font-bold">{formatINR(tx.amount, numerals)}</td>
                      <td className="px-3 py-2 uppercase">{tx.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {reportType === 'salary' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-3 py-2.5">Staff Name</th>
                    <th className="px-3 py-2.5">Designation</th>
                    <th className="px-3 py-2.5 text-right">Monthly Salary</th>
                    <th className="px-3 py-2.5 text-right">Total Paid</th>
                    <th className="px-3 py-2.5 text-right">Pending Salary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {staff.map((s) => (
                    <tr key={s.id}>
                      <td className="px-3 py-2 font-semibold">{s.name}</td>
                      <td className="px-3 py-2">{s.designation} ({s.institution})</td>
                      <td className="px-3 py-2 text-right font-data">{formatINR(s.monthlySalary, numerals)}</td>
                      <td className="px-3 py-2 text-right font-data text-emerald-700 dark:text-emerald-400">{formatINR(s.totalPaid, numerals)}</td>
                      <td className="px-3 py-2 text-right font-data font-bold text-rose-600">{formatINR(s.totalPending, numerals)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {reportType === 'pending_dues' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-3 py-2.5">Member ID</th>
                    <th className="px-3 py-2.5">Member Name</th>
                    <th className="px-3 py-2.5">Pending Months</th>
                    <th className="px-3 py-2.5">Pending Since</th>
                    <th className="px-3 py-2.5 text-right">Total Outstanding</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {members.filter((m) => m.outstandingAmount > 0).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-emerald-700 font-semibold">
                        All members are up to date — ₹0 pending dues!
                      </td>
                    </tr>
                  ) : (
                    members
                      .filter((m) => m.outstandingAmount > 0)
                      .map((m) => (
                        <tr key={m.id}>
                          <td className="px-3 py-2 font-data font-semibold">{m.memberCode}</td>
                          <td className="px-3 py-2 font-semibold">{m.fullName}</td>
                          <td className="px-3 py-2">{m.pendingMonthsCount} months</td>
                          <td className="px-3 py-2 font-data">{m.pendingSince || '-'}</td>
                          <td className="px-3 py-2 text-right font-data font-bold text-rose-600">
                            {formatINR(m.outstandingAmount, numerals)}
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ================= TAB 7: ADMIN ROLES (MAX 2) & AUDIT LOG ================= */}
      {subTab === 'roles' && (
        <div className="space-y-5">
          {/* Authorized Administrators (Max 2) */}
          <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Authorized Administrators ({adminAccounts.length} / 2 Maximum Enforced)
                </h2>
                <p className="text-xs text-slate-500">
                  Strictly maximum 2 administrators enforced in Database triggers, Backend APIs, and Firestore Security Rules. Only Primary Super Admin can appoint or revoke Secondary Admin.
                </p>
              </div>
              <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 shrink-0">
                {isSuperAdmin ? 'You are Super Admin' : 'Secondary Admin (View Only)'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {adminAccounts.map((a, idx) => (
                <div
                  key={a.id}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 flex items-start justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Crown className={`w-4 h-4 ${a.role === 'admin_main' ? 'text-amber-500' : 'text-emerald-600'}`} />
                      <span className="text-sm font-bold">{a.fullName}</span>
                    </div>
                    <div className="text-xs font-data text-slate-500">
                      Login ID: {a.username} · Slot #{idx + 1} · {a.role === 'admin_main' ? 'Primary Super Admin' : 'Secondary Admin'}
                    </div>
                  </div>
                  {isSuperAdmin && a.role === 'admin_secondary' && (
                    <button
                      type="button"
                      onClick={() => {
                        setRevokeTarget(a);
                        setRoleActionReason('');
                      }}
                      className="px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-400 text-xs font-bold hover:bg-rose-50 dark:hover:bg-rose-950/30 shrink-0"
                    >
                      Revoke Admin
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Super Admin Promote Member -> Secondary Admin (only when slot 2 is open) */}
            {isSuperAdmin && canAddSecondaryAdmin && (
              <form
                onSubmit={handlePromoteSecondaryAdmin}
                className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/60 dark:bg-emerald-950/20 space-y-3"
              >
                <div className="text-xs font-bold text-emerald-900 dark:text-emerald-300">
                  Slot #2 Available — Appoint Secondary Administrator (Super Admin Only)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <select
                    required
                    value={promoteUserId}
                    onChange={(e) => setPromoteUserId(e.target.value)}
                    className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  >
                    <option value="">Select active member...</option>
                    {memberAccounts
                      .filter((u) => u.isActive)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.username} — {u.fullName}
                        </option>
                      ))}
                  </select>
                  <input
                    type="text"
                    value={roleActionReason}
                    onChange={(e) => setRoleActionReason(e.target.value)}
                    placeholder="Reason for appointment (audit log)"
                    className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  />
                  <button
                    type="submit"
                    disabled={submitting || !promoteUserId}
                    className="min-h-[40px] px-4 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-bold disabled:opacity-60"
                  >
                    Appoint Secondary Admin
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Searchable Immutable Audit Log */}
          <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold">Immutable Admin Audit Log ({filteredAuditLogs.length})</h3>
                <p className="text-xs text-slate-500">Every member, fund, role, settings, and financial action is permanently logged.</p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  placeholder="Filter audit trail..."
                  className="w-full min-h-[38px] pl-9 pr-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
                />
              </div>
            </div>

            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-900/70 sticky top-0 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-3 py-2.5">Timestamp</th>
                    <th className="px-3 py-2.5">Admin</th>
                    <th className="px-3 py-2.5">Action</th>
                    <th className="px-3 py-2.5">Entity</th>
                    <th className="px-3 py-2.5">Reason / Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {filteredAuditLogs.slice(0, 60).map((log) => (
                    <tr key={log.id}>
                      <td className="px-3 py-2 font-data text-[11px] whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString('en-IN')}
                      </td>
                      <td className="px-3 py-2 font-semibold">{log.adminName}</td>
                      <td className="px-3 py-2 font-data font-bold text-[#0B4F32] dark:text-emerald-400">{log.action}</td>
                      <td className="px-3 py-2 text-slate-500">{log.entityType}</td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{log.reason || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Login Activity */}
          {loginActivity.length > 0 && (
            <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-4 space-y-2">
              <h3 className="text-sm font-bold">Recent Login Activity ({loginActivity.length})</h3>
              <div className="overflow-x-auto max-h-60 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900/70 sticky top-0 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="px-3 py-2">Time</th>
                      <th className="px-3 py-2">User ID</th>
                      <th className="px-3 py-2">Role</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                    {loginActivity.slice(0, 25).map((a) => (
                      <tr key={a.id}>
                        <td className="px-3 py-1.5 font-data text-[11px]">{new Date(a.timestamp).toLocaleString('en-IN')}</td>
                        <td className="px-3 py-1.5 font-semibold">{a.username} ({a.fullName})</td>
                        <td className="px-3 py-1.5">{a.role}</td>
                        <td className="px-3 py-1.5 uppercase font-bold">{a.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================= MODALS ================= */}

      {/* Add Member Modal */}
      {showAddMember && (
        <ModalShell title="Add New Committee Member" onClose={() => setShowAddMember(false)}>
          <form onSubmit={handleAddMember} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={newMember.fullName}
                  onChange={(e) => setNewMember({ ...newMember, fullName: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Mobile Number</label>
                <input
                  type="text"
                  value={newMember.phone}
                  onChange={(e) => setNewMember({ ...newMember, phone: e.target.value })}
                  placeholder="10-digit mobile"
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-data"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Address / Village</label>
                <input
                  type="text"
                  value={newMember.village}
                  onChange={(e) => setNewMember({ ...newMember, village: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Member ID (optional — auto if blank)</label>
                <input
                  type="text"
                  value={newMember.memberCode}
                  onChange={(e) => setNewMember({ ...newMember, memberCode: e.target.value.toUpperCase() })}
                  placeholder="e.g. M015"
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-data uppercase"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Individual Monthly Fee (₹) *</label>
                <input
                  type="number"
                  min={1}
                  required
                  value={newMember.monthlyAmount}
                  onChange={(e) => setNewMember({ ...newMember, monthlyAmount: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-data"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Joining Date</label>
                <input
                  type="date"
                  value={newMember.joiningDate}
                  onChange={(e) => setNewMember({ ...newMember, joiningDate: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-data"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Initial Login Password (min 6 chars, hashed securely)</label>
              <input
                type="password"
                minLength={6}
                value={newMember.password}
                onChange={(e) => setNewMember({ ...newMember, password: e.target.value })}
                placeholder="Leave blank for default Member@123"
                className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAddMember(false)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold">
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="px-4 py-2 rounded-xl bg-[#0B4F32] text-white text-xs font-bold disabled:opacity-60">
                {submitting ? 'Creating...' : 'Create Member & Login'}
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {/* Edit Member Modal */}
      {editingMember && (
        <ModalShell title={`Edit Member (${editingMember.memberCode})`} onClose={() => setEditingMember(null)}>
          <form onSubmit={handleUpdateMember} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={editMemberForm.fullName}
                  onChange={(e) => setEditMemberForm({ ...editMemberForm, fullName: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Mobile Number</label>
                <input
                  type="text"
                  value={editMemberForm.phone}
                  onChange={(e) => setEditMemberForm({ ...editMemberForm, phone: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-data"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Address / Village</label>
                <input
                  type="text"
                  value={editMemberForm.village}
                  onChange={(e) => setEditMemberForm({ ...editMemberForm, village: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Monthly Contribution (₹)</label>
                <input
                  type="number"
                  min={1}
                  required
                  value={editMemberForm.monthlyAmount}
                  onChange={(e) => setEditMemberForm({ ...editMemberForm, monthlyAmount: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-data"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Status</label>
                <select
                  value={editMemberForm.status}
                  onChange={(e) => setEditMemberForm({ ...editMemberForm, status: e.target.value as 'active' | 'inactive' })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-semibold"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Reset Password (optional)</label>
                <input
                  type="password"
                  minLength={6}
                  value={editMemberForm.newPassword}
                  onChange={(e) => setEditMemberForm({ ...editMemberForm, newPassword: e.target.value })}
                  placeholder="Leave blank to keep current"
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditingMember(null)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold">
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="px-4 py-2 rounded-xl bg-[#0B4F32] text-white text-xs font-bold disabled:opacity-60">
                Save Member
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {/* Member Login Access Modal */}
      {accessModalMember && (
        <ModalShell title={`Login Access — ${accessModalMember.memberCode} (${accessModalMember.fullName})`} onClose={() => setAccessModalMember(null)}>
          <div className="space-y-4">
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Revoking access immediately logs out active sessions while preserving 100% of this member&apos;s contribution and receipt history.
            </p>
            <div>
              <label className="block text-xs font-semibold mb-1">Optional New Password (min 6 chars)</label>
              <input
                type="password"
                minLength={6}
                value={accessPassword}
                onChange={(e) => setAccessPassword(e.target.value)}
                placeholder="Enter new password if resetting"
                className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
              />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleMemberAccessUpdate(false)}
                className="px-3.5 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold disabled:opacity-60"
              >
                Revoke Login Access
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleMemberAccessUpdate(true)}
                className="px-3.5 py-2 rounded-xl bg-[#0B4F32] text-white text-xs font-bold disabled:opacity-60"
              >
                Enable Access / Save Password
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {/* Safe Remove Member Confirm Modal */}
      {removeConfirmMember && (
        <ModalShell title={`Remove / Revoke Member (${removeConfirmMember.memberCode})`} onClose={() => setRemoveConfirmMember(null)}>
          <div className="space-y-4">
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Are you sure you want to remove <strong>{removeConfirmMember.fullName}</strong>? If this member has any recorded payments, donations, or transactions, the system will automatically deactivate them and revoke login access while keeping 100% of financial history intact.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRemoveConfirmMember(null)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold">
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleSafeRemoveMember}
                className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold disabled:opacity-60"
              >
                Confirm Safe Removal
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {/* Create New Fund Modal */}
      {showAddFund && (
        <ModalShell title="Create New Virtual Fund" onClose={() => setShowAddFund(false)}>
          <form onSubmit={handleCreateFund} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Fund Code * (e.g. CONSTRUCT)</label>
                <input
                  type="text"
                  required
                  value={newFund.code}
                  onChange={(e) => setNewFund({ ...newFund, code: e.target.value.toUpperCase() })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-data uppercase"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Fund Scope *</label>
                <select
                  value={newFund.scope}
                  onChange={(e) => setNewFund({ ...newFund, scope: e.target.value as any })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-semibold"
                >
                  <option value="masjid">Masjid</option>
                  <option value="madrasa">Madrasa</option>
                  <option value="restricted">Restricted Purpose</option>
                  <option value="general">General</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Fund Name (English) *</label>
                <input
                  type="text"
                  required
                  value={newFund.nameEn}
                  onChange={(e) => setNewFund({ ...newFund, nameEn: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Fund Name (Hindi)</label>
                <input
                  type="text"
                  value={newFund.nameHi}
                  onChange={(e) => setNewFund({ ...newFund, nameHi: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Description / Purpose</label>
              <textarea
                rows={2}
                value={newFund.description}
                onChange={(e) => setNewFund({ ...newFund, description: e.target.value })}
                className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={newFund.isRestricted}
                onChange={(e) => setNewFund({ ...newFund, isRestricted: e.target.checked })}
              />
              <span>Restricted Purpose Fund (cannot be mixed with other funds)</span>
            </label>
            {newFund.isRestricted && (
              <input
                type="text"
                value={newFund.restrictedRule}
                onChange={(e) => setNewFund({ ...newFund, restrictedRule: e.target.value })}
                placeholder="Specify restriction rule (e.g., Construction only)"
                className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
              />
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAddFund(false)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold">
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="px-4 py-2 rounded-xl bg-[#0B4F32] text-white text-xs font-bold disabled:opacity-60">
                Create Fund
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {/* Edit Fund Modal */}
      {editingFund && (
        <ModalShell title={`Edit Fund (${editingFund.code})`} onClose={() => setEditingFund(null)}>
          <form onSubmit={handleUpdateFund} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Fund Name (English) *</label>
                <input
                  type="text"
                  required
                  value={editFundForm.nameEn}
                  onChange={(e) => setEditFundForm({ ...editFundForm, nameEn: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Fund Name (Hindi)</label>
                <input
                  type="text"
                  value={editFundForm.nameHi}
                  onChange={(e) => setEditFundForm({ ...editFundForm, nameHi: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Fund Name (Urdu)</label>
                <input
                  type="text"
                  value={editFundForm.nameUr}
                  onChange={(e) => setEditFundForm({ ...editFundForm, nameUr: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Scope</label>
                <select
                  value={editFundForm.scope}
                  onChange={(e) => setEditFundForm({ ...editFundForm, scope: e.target.value as any })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-semibold"
                >
                  <option value="masjid">Masjid</option>
                  <option value="madrasa">Madrasa</option>
                  <option value="restricted">Restricted Purpose</option>
                  <option value="general">General</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Description</label>
              <textarea
                rows={2}
                value={editFundForm.description}
                onChange={(e) => setEditFundForm({ ...editFundForm, description: e.target.value })}
                className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={editFundForm.isActive}
                onChange={(e) => setEditFundForm({ ...editFundForm, isActive: e.target.checked })}
              />
              <span>Fund is Active (can accept new transactions)</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditingFund(null)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold">
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="px-4 py-2 rounded-xl bg-[#0B4F32] text-white text-xs font-bold disabled:opacity-60">
                Save Fund Changes
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {/* Quick Income / Expense Entry Modal */}
      {quickTxnModal && (
        <ModalShell
          title={txnForm.type === 'income' ? 'Record Verified Income' : 'Record Expense Entry'}
          onClose={() => setQuickTxnModal(null)}
        >
          <form onSubmit={handleCreateTransaction} className="space-y-3">
            {txnForm.type === 'expense' && (
              <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-900 dark:text-amber-200">
                Dual-Admin Rule: Expenses above ₹{settings?.dualApprovalLimit || 5000} automatically enter the Pending Approval queue for the second administrator.
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Fund Account *</label>
                <select
                  required
                  value={txnForm.fundId}
                  onChange={(e) => setTxnForm({ ...txnForm, fundId: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-semibold"
                >
                  {activeFunds.map((f) => (
                    <option key={f.id} value={f.id}>
                      {getFundLabel(f, lang)} ({formatINR(f.currentBalance, numerals)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Amount (₹) *</label>
                <input
                  type="number"
                  min={1}
                  required
                  value={txnForm.amount}
                  onChange={(e) => setTxnForm({ ...txnForm, amount: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-data"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Category *</label>
                <input
                  type="text"
                  required
                  value={txnForm.category}
                  onChange={(e) => setTxnForm({ ...txnForm, category: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Donor / Vendor / Party Name *</label>
                <input
                  type="text"
                  required
                  value={txnForm.partyName}
                  onChange={(e) => setTxnForm({ ...txnForm, partyName: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Payment Method</label>
                <select
                  value={txnForm.paymentMethod}
                  onChange={(e) => setTxnForm({ ...txnForm, paymentMethod: e.target.value as any })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-semibold"
                >
                  <option value="UPI">UPI</option>
                  <option value="Bank">Bank Transfer</option>
                  <option value="Cash">Cash</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Date</label>
                <input
                  type="date"
                  required
                  value={txnForm.date}
                  onChange={(e) => setTxnForm({ ...txnForm, date: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-data"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Description / Bill Notes</label>
              <input
                type="text"
                value={txnForm.description}
                onChange={(e) => setTxnForm({ ...txnForm, description: e.target.value })}
                className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setQuickTxnModal(null)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold">
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className={`px-4 py-2 rounded-xl text-white text-xs font-bold disabled:opacity-60 ${
                  txnForm.type === 'income' ? 'bg-emerald-600' : 'bg-rose-600'
                }`}
              >
                {submitting ? 'Posting...' : txnForm.type === 'income' ? 'Post Income' : 'Post Expense'}
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {/* Audited Edit Metadata Modal */}
      {editingTxn && (
        <ModalShell title={`Audited Note Edit — ${editingTxn.txnNumber}`} onClose={() => setEditingTxn(null)}>
          <form onSubmit={handleEditTxnMetadata} className="space-y-3">
            <p className="text-[11px] text-slate-500">
              Accounting integrity rule: Amount ({formatINR(editingTxn.amount, numerals)}), fund, and type cannot be silently overwritten. Use Official Reversal to change monetary amounts.
            </p>
            <div>
              <label className="block text-xs font-semibold mb-1">Category</label>
              <input
                type="text"
                required
                value={editTxnForm.category}
                onChange={(e) => setEditTxnForm({ ...editTxnForm, category: e.target.value })}
                className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Party Name</label>
              <input
                type="text"
                required
                value={editTxnForm.partyName}
                onChange={(e) => setEditTxnForm({ ...editTxnForm, partyName: e.target.value })}
                className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Description</label>
              <input
                type="text"
                value={editTxnForm.description}
                onChange={(e) => setEditTxnForm({ ...editTxnForm, description: e.target.value })}
                className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Mandatory Audit Reason (min 5 chars) *</label>
              <input
                type="text"
                required
                minLength={5}
                value={editTxnForm.reason}
                onChange={(e) => setEditTxnForm({ ...editTxnForm, reason: e.target.value })}
                placeholder="Explain why this note is being corrected"
                className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditingTxn(null)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold">
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="px-4 py-2 rounded-xl bg-[#0B4F32] text-white text-xs font-bold">
                Save Audited Edit
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {/* Official Reversal Modal */}
      {reversingTxn && (
        <ModalShell title={`Official Reversal — ${reversingTxn.txnNumber}`} onClose={() => setReversingTxn(null)}>
          <form onSubmit={handleReverseTxn} className="space-y-3">
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Reversing posts an equal opposite double-entry journal record and preserves the original entry for full transparency.
            </p>
            <div>
              <label className="block text-xs font-semibold mb-1">Mandatory Reversal Reason *</label>
              <input
                type="text"
                required
                minLength={3}
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                placeholder="e.g., Duplicate entry posted in error"
                className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setReversingTxn(null)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold">
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold">
                Post Reversal Entry
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {/* Approve / Reject Expense Modal */}
      {approvalDecisionModal && (
        <ModalShell
          title={`${approvalDecisionModal.decision === 'approve' ? 'Approve' : 'Reject'} Expense (${approvalDecisionModal.txn.txnNumber})`}
          onClose={() => setApprovalDecisionModal(null)}
        >
          <form onSubmit={handleApprovalDecision} className="space-y-3">
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Amount: <strong>{formatINR(approvalDecisionModal.txn.amount, numerals)}</strong> · Party:{' '}
              <strong>{approvalDecisionModal.txn.partyName}</strong>
            </p>
            <div>
              <label className="block text-xs font-semibold mb-1">Decision Remark (Audit Log)</label>
              <input
                type="text"
                value={approvalReason}
                onChange={(e) => setApprovalReason(e.target.value)}
                placeholder="Verified bill and approved / Rejected reason"
                className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setApprovalDecisionModal(null)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold">
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className={`px-4 py-2 rounded-xl text-white text-xs font-bold ${
                  approvalDecisionModal.decision === 'approve' ? 'bg-emerald-600' : 'bg-rose-600'
                }`}
              >
                Confirm {approvalDecisionModal.decision === 'approve' ? 'Approval' : 'Rejection'}
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {/* Revoke Secondary Admin Confirm Modal */}
      {revokeTarget && (
        <ModalShell title={`Revoke Secondary Admin (${revokeTarget.username})`} onClose={() => setRevokeTarget(null)}>
          <div className="space-y-3">
            <p className="text-xs text-slate-600 dark:text-slate-400">
              This will downgrade <strong>{revokeTarget.fullName}</strong> back to read-only Member access and immediately invalidate their active admin sessions.
            </p>
            <input
              type="text"
              value={roleActionReason}
              onChange={(e) => setRoleActionReason(e.target.value)}
              placeholder="Reason for revoking Secondary Admin (Audit Log)"
              className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRevokeTarget(null)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold">
                Cancel
              </button>
              <button type="button" disabled={submitting} onClick={handleRevokeSecondaryAdmin} className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold">
                Revoke Privileges
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'emerald' | 'rose' | 'amber' | 'slate';
  onClick?: () => void;
}) {
  const toneClass =
    tone === 'emerald'
      ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40'
      : tone === 'rose'
      ? 'text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40'
      : tone === 'amber'
      ? 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40'
      : 'text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800';

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left p-3.5 rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 hover:border-[#0B4F32]/50 transition-colors space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate">{label}</span>
        <span className={`w-7 h-7 rounded-lg inline-flex items-center justify-center shrink-0 ${toneClass}`}>
          <Icon className="w-3.5 h-3.5" />
        </span>
      </div>
      <div className="text-base sm:text-lg font-data font-bold text-slate-900 dark:text-slate-100 truncate">{value}</div>
      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{sub}</div>
    </button>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5 shadow-xl max-h-[90vh] overflow-y-auto space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 px-2 py-1"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
