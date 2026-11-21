import React, { useMemo, useState } from 'react';
import {
  Search,
  Plus,
  ChevronDown,
  ChevronUp,
  Download,
  IndianRupee,
  Edit3,
  UserX,
  Check,
  X,
  RefreshCw,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { downloadMemberReceiptPDF } from '../lib/exports';
import type {
  AuthUser,
  BankAccountRecord,
  FundSummary,
  Language,
  MemberSummary,
  NumeralSystem,
} from '../types';
import { formatINR, formatMonthKey, t, toDisplayDigits } from '../i18n/translations';

interface MembersViewProps {
  user: AuthUser;
  lang: Language;
  numerals: NumeralSystem;
  members: MemberSummary[];
  funds: FundSummary[];
  bankAccounts: BankAccountRecord[];
  initialFilter?: string;
  onRefresh: () => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export const MembersView: React.FC<MembersViewProps> = ({
  user,
  lang,
  numerals,
  members,
  funds,
  bankAccounts,
  initialFilter,
  onRefresh,
  onNotify,
}) => {
  const isAdmin = user.role === 'admin_main' || user.role === 'admin_secondary';
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'partial' | 'paid' | 'inactive'>(
    initialFilter === 'pending' ? 'pending' : 'all'
  );
  const [expandedId, setExpandedId] = useState<string | null>(members[0]?.id || null);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [editMember, setEditMember] = useState<MemberSummary | null>(null);
  const [collectMember, setCollectMember] = useState<MemberSummary | null>(null);

  // Add/Edit form state
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formVillage, setFormVillage] = useState('');
  const [formMonthly, setFormMonthly] = useState('500');
  const [formJoinDate, setFormJoinDate] = useState(new Date().toISOString().slice(0, 10));
  const [formStatus, setFormStatus] = useState<'active' | 'inactive'>('active');
  const [submitting, setSubmitting] = useState(false);

  // Contribution form state (supports both full & partial per-month payments)
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [monthAmounts, setMonthAmounts] = useState<Record<string, string>>({});
  const [payMethod, setPayMethod] = useState<'Cash' | 'UPI' | 'Bank'>('Cash');
  const [payBankId, setPayBankId] = useState(bankAccounts[0]?.id || 'bank_sbi_committee');
  const [payFundId, setPayFundId] = useState('masjid_general');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payNotes, setPayNotes] = useState('');
  const [generatingDues, setGeneratingDues] = useState(false);

  const totals = useMemo(() => {
    const active = members.filter((m) => m.status === 'active');
    return {
      totalMembers: members.length,
      activeMembers: active.length,
      expectedMonthly: active.reduce((s, m) => s + m.monthlyAmount, 0),
      totalPaid: members.reduce((s, m) => s + m.totalPaid, 0),
      totalOutstanding: members.reduce((s, m) => s + m.outstandingAmount, 0),
      pendingCount: active.filter((m) => m.outstandingAmount > 0).length,
    };
  }, [members]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return members.filter((m) => {
      if (statusFilter === 'pending' && !(m.status === 'active' && m.outstandingAmount > 0)) return false;
      if (
        statusFilter === 'partial' &&
        !(m.status === 'active' && m.monthHistory.some((mh) => mh.status === 'partial'))
      )
        return false;
      if (statusFilter === 'paid' && !(m.status === 'active' && m.outstandingAmount === 0)) return false;
      if (statusFilter === 'inactive' && m.status !== 'inactive') return false;
      if (
        q &&
        !(
          m.fullName.toLowerCase().includes(q) ||
          m.memberCode.toLowerCase().includes(q) ||
          m.village.toLowerCase().includes(q) ||
          m.phone.toLowerCase().includes(q)
        )
      )
        return false;
      return true;
    });
  }, [members, search, statusFilter]);

  function openAddModal() {
    setFormName('');
    setFormPhone('+91 ');
    setFormVillage('Ragdih');
    setFormMonthly('500');
    setFormJoinDate(new Date().toISOString().slice(0, 10));
    setShowAddModal(true);
  }

  function openEditModal(m: MemberSummary) {
    setEditMember(m);
    setFormName(m.fullName);
    setFormPhone(m.phone);
    setFormVillage(m.village);
    setFormMonthly(String(m.monthlyAmount));
    setFormJoinDate(m.joiningDate);
    setFormStatus(m.status);
  }

  function openCollectModal(m: MemberSummary) {
    setCollectMember(m);
    const defaultMonths = m.pendingMonths.length > 0 ? [m.pendingMonths[0]] : [new Date().toISOString().slice(0, 7)];
    setSelectedMonths(defaultMonths);
    const initAmounts: Record<string, string> = {};
    for (const mh of m.monthHistory) {
      if (mh.remaining > 0) initAmounts[mh.monthKey] = String(mh.remaining);
    }
    for (const mk of defaultMonths) {
      if (!initAmounts[mk]) initAmounts[mk] = String(m.monthlyAmount);
    }
    setMonthAmounts(initAmounts);
    setPayMethod('Cash');
    setPayFundId('masjid_general');
    setPayBankId(bankAccounts[0]?.id || 'bank_sbi_committee');
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayNotes('');
  }

  async function handleGenerateMonthlyDues() {
    setGeneratingDues(true);
    try {
      const res = await apiRequest<{ monthKey: string; generatedCount: number }>('/api/contributions/generate', {
        method: 'POST',
        body: {},
      });
      onRefresh();
      onNotify(
        res.generatedCount > 0
          ? `Generated ${res.generatedCount} new monthly due record(s) up to ${res.monthKey}.`
          : `All monthly dues up to ${res.monthKey} are already up to date (0 duplicates created).`,
        'success'
      );
    } catch (err: any) {
      onNotify(err.message || 'Failed to generate monthly dues', 'error');
    } finally {
      setGeneratingDues(false);
    }
  }

  async function handleSaveNewMember(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiRequest<{ memberCode: string; defaultPassword: string }>('/api/members', {
        method: 'POST',
        body: {
          fullName: formName,
          phone: formPhone,
          village: formVillage,
          monthlyAmount: Number(formMonthly),
          joiningDate: formJoinDate,
        },
      });
      setShowAddModal(false);
      onRefresh();
      onNotify(`Member ${res.memberCode} added. Login password: ${res.defaultPassword}`, 'success');
    } catch (err: any) {
      onNotify(err.message || 'Failed to add member', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateMember(e: React.FormEvent) {
    e.preventDefault();
    if (!editMember) return;
    setSubmitting(true);
    try {
      await apiRequest(`/api/members/${editMember.id}`, {
        method: 'PUT',
        body: {
          fullName: formName,
          phone: formPhone,
          village: formVillage,
          monthlyAmount: Number(formMonthly),
          joiningDate: formJoinDate,
          status: formStatus,
        },
      });
      setEditMember(null);
      onRefresh();
      onNotify(`Updated member ${editMember.memberCode}`, 'success');
    } catch (err: any) {
      onNotify(err.message || 'Failed to update member', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivateMember(m: MemberSummary) {
    try {
      await apiRequest(`/api/members/${m.id}`, { method: 'DELETE' });
      onRefresh();
      onNotify(`${m.fullName} updated (financial history preserved)`, 'success');
    } catch (err: any) {
      onNotify(err.message || 'Action failed', 'error');
    }
  }

  async function handleRecordContribution(e: React.FormEvent) {
    e.preventDefault();
    if (!collectMember || selectedMonths.length === 0) return;
    const monthPayments = selectedMonths
      .map((mk) => ({
        monthKey: mk,
        amount: Number(monthAmounts[mk] ?? collectMember.monthlyAmount),
      }))
      .filter((mp) => mp.amount > 0);
    if (monthPayments.length === 0) {
      onNotify('Enter a positive ₹ amount for at least one selected month.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest<{ txnNumber: string; totalAmount: number }>(
        `/api/members/${collectMember.id}/contributions`,
        {
          method: 'POST',
          body: {
            monthPayments,
            paymentMethod: payMethod,
            bankAccountId: payMethod === 'Cash' ? null : payBankId,
            fundId: payFundId,
            date: payDate,
            notes: payNotes,
          },
        }
      );
      setCollectMember(null);
      onRefresh();
      onNotify(`Recorded ₹${res.totalAmount.toLocaleString('en-IN')} · Receipt ${res.txnNumber}`, 'success');
    } catch (err: any) {
      onNotify(err.message || 'Failed to record contribution', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function toggleMonth(mk: string) {
    setSelectedMonths((prev) => {
      if (prev.includes(mk)) return prev.filter((x) => x !== mk);
      if (collectMember && !monthAmounts[mk]) {
        const mh = collectMember.monthHistory.find((x) => x.monthKey === mk);
        setMonthAmounts((cur) => ({ ...cur, [mk]: String(mh?.remaining || collectMember.monthlyAmount) }));
      }
      return [...prev, mk];
    });
  }

  return (
    <div className="space-y-6">
      {/* Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">Active Members / Monthly Expected</div>
          <div className="text-xl font-bold font-data text-slate-900 dark:text-slate-100 mt-1">
            {toDisplayDigits(totals.activeMembers, numerals)} · {formatINR(totals.expectedMonthly, numerals)}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">{t(lang, 'contributionsReceived')}</div>
          <div className="text-xl font-bold font-data text-emerald-700 dark:text-emerald-400 mt-1">
            {formatINR(totals.totalPaid, numerals)}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">{t(lang, 'outstandingContributions')}</div>
          <div className="text-xl font-bold font-data text-rose-700 dark:text-rose-400 mt-1">
            {formatINR(totals.totalOutstanding, numerals)}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">Members With Pending Dues</div>
          <div className="text-xl font-bold font-data text-amber-700 dark:text-amber-400 mt-1">
            {toDisplayDigits(totals.pendingCount, numerals)} / {toDisplayDigits(totals.activeMembers, numerals)}
          </div>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, Member ID (M001), or village..."
            className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121D18] text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0B4F32]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-200/70 dark:bg-slate-900 overflow-x-auto">
            {(['all', 'pending', 'partial', 'paid', 'inactive'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setStatusFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap min-h-[36px] ${
                  statusFilter === f
                    ? 'bg-white dark:bg-[#192822] text-[#0B4F32] dark:text-emerald-300 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {t(lang, f)}
              </button>
            ))}
          </div>

          {isAdmin && (
            <>
              <button
                type="button"
                disabled={generatingDues}
                onClick={handleGenerateMonthlyDues}
                className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#121D18] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${generatingDues ? 'animate-spin' : ''}`} />
                <span>{generatingDues ? 'Syncing...' : 'Generate Dues'}</span>
              </button>
              <button
                type="button"
                onClick={openAddModal}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>{t(lang, 'addMember')}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Member Directory List */}
      <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800">
        {filtered.map((m) => {
          const isExpanded = expandedId === m.id;
          return (
            <div key={m.id} className="p-4 sm:p-5">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : m.id)}
                  className="text-left flex items-start sm:items-center gap-3.5 flex-1 min-w-0"
                >
                  <div className="w-11 h-11 rounded-full bg-emerald-900/10 dark:bg-emerald-400/10 text-[#0B4F32] dark:text-emerald-300 font-bold text-sm flex items-center justify-center shrink-0">
                    {m.memberCode}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-base font-bold text-slate-900 dark:text-slate-100">
                        {m.fullName}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        · {m.village} · {m.phone}
                      </span>
                      {m.status === 'inactive' && (
                        <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                          · {t(lang, 'inactive')}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-400 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>
                        Monthly: <strong className="font-data text-slate-900 dark:text-slate-200">{formatINR(m.monthlyAmount, numerals)}</strong>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {t(lang, 'paidMonths')}: <strong className="font-data text-emerald-700 dark:text-emerald-400">{formatINR(m.totalPaid, numerals)}</strong>
                      </span>
                      <span aria-hidden="true">·</span>
                      {m.outstandingAmount > 0 ? (
                        <span className="text-rose-700 dark:text-rose-400 font-semibold">
                          {t(lang, 'outstanding')}: <span className="font-data">{formatINR(m.outstandingAmount, numerals)}</span> ({toDisplayDigits(m.pendingMonthsCount, numerals)} {t(lang, 'monthsPending')} · {t(lang, 'pendingSince')}: {m.pendingSince ? formatMonthKey(m.pendingSince, lang, numerals) : '-'})
                        </span>
                      ) : (
                        <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                          {m.status === 'active' ? t(lang, 'upToDate') : 'Inactive Account'}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-slate-400 shrink-0">
                    {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </span>
                </button>

                {isAdmin && (
                  <div className="flex items-center gap-2 shrink-0">
                    {m.status === 'active' && (
                      <button
                        type="button"
                        onClick={() => openCollectModal(m)}
                        className="min-h-[40px] px-3.5 py-2 rounded-lg bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                      >
                        <IndianRupee className="w-3.5 h-3.5" />
                        <span>{t(lang, 'recordContribution')}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openEditModal(m)}
                      aria-label={`Edit ${m.fullName}`}
                      className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    {m.status === 'active' && (
                      <button
                        type="button"
                        onClick={() => handleDeactivateMember(m)}
                        aria-label={`Deactivate ${m.fullName}`}
                        title="Deactivate member (preserves history)"
                        className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                      >
                        <UserX className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Expanded Monthly Contribution Matrix */}
              {isExpanded && (
                <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800/80">
                  <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2.5">
                    Monthly Payment Ledger (Joined {m.joiningDate})
                  </div>
                  {m.monthHistory.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">No active billing months.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                      {m.monthHistory.map((mh) => (
                        <div
                          key={mh.monthKey}
                          className={`p-3 rounded-xl border ${
                            mh.status === 'paid'
                              ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/80 dark:border-emerald-900/50'
                              : mh.status === 'partial'
                              ? 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200/80 dark:border-amber-900/50'
                              : 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200/80 dark:border-rose-900/50'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                              {formatMonthKey(mh.monthKey, lang, numerals)}
                            </span>
                            <span
                              className={`text-[11px] font-semibold ${
                                mh.status === 'paid'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : mh.status === 'partial'
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-rose-700 dark:text-rose-400'
                              }`}
                            >
                              {mh.status === 'paid'
                                ? 'Paid'
                                : mh.status === 'partial'
                                ? 'Partial'
                                : mh.dueStatus === 'overdue'
                                ? 'Overdue'
                                : 'Not Paid'}
                            </span>
                          </div>
                          <div className="mt-1.5 text-sm font-bold font-data text-slate-900 dark:text-slate-100">
                            {mh.status === 'paid'
                              ? formatINR(mh.paid, numerals)
                              : `${formatINR(mh.paid, numerals)} / ${formatINR(mh.expected, numerals)}`}
                          </div>
                          {mh.status === 'paid' ? (
                            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                              <span>{mh.paidDate} · {mh.paymentMethod}</span>
                              <button
                                type="button"
                                onClick={() => downloadMemberReceiptPDF(m, mh)}
                                className="inline-flex items-center gap-1 font-semibold text-[#0B4F32] dark:text-emerald-400 hover:underline"
                              >
                                <Download className="w-3 h-3" />
                                <span>PDF</span>
                              </button>
                            </div>
                          ) : (
                            <div className="mt-2 text-[11px] text-rose-700 dark:text-rose-400">
                              Due: {formatINR(mh.remaining, numerals)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            No committee members match the current search or filter.
          </div>
        )}
      </div>

      {/* Add Member Modal (Admin only) */}
      {showAddModal && isAdmin && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{t(lang, 'addMember')}</h3>
              <button type="button" onClick={() => setShowAddModal(false)} className="p-1 text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveNewMember} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Mobile Number *</label>
                  <input
                    type="text"
                    required
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Monthly Amount (₹) *</label>
                  <input
                    type="number"
                    min={50}
                    required
                    value={formMonthly}
                    onChange={(e) => setFormMonthly(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Village / Mohalla *</label>
                  <input
                    type="text"
                    required
                    value={formVillage}
                    onChange={(e) => setFormVillage(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Joining Date *</label>
                  <input
                    type="date"
                    required
                    value={formJoinDate}
                    onChange={(e) => setFormJoinDate(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                A Read-Only Member Login account (Member ID + default password <span className="font-data">Member@123</span>) will be generated automatically.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium"
                >
                  {t(lang, 'cancel')}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-sm font-semibold"
                >
                  {submitting ? 'Saving...' : t(lang, 'saveChanges')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Member Modal */}
      {editMember && isAdmin && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Edit Member ({editMember.memberCode})
              </h3>
              <button type="button" onClick={() => setEditMember(null)} className="p-1 text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleUpdateMember} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Mobile Number</label>
                  <input
                    type="text"
                    required
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Monthly Amount (₹)</label>
                  <input
                    type="number"
                    min={50}
                    required
                    value={formMonthly}
                    onChange={(e) => setFormMonthly(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Village</label>
                  <input
                    type="text"
                    required
                    value={formVillage}
                    onChange={(e) => setFormVillage(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Status</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as 'active' | 'inactive')}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditMember(null)}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium"
                >
                  {t(lang, 'cancel')}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-sm font-semibold"
                >
                  {submitting ? 'Updating...' : t(lang, 'saveChanges')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Contribution Modal */}
      {collectMember && isAdmin && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  {t(lang, 'recordContribution')}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {collectMember.fullName} ({collectMember.memberCode}) · {formatINR(collectMember.monthlyAmount, numerals)}/month
                </p>
              </div>
              <button type="button" onClick={() => setCollectMember(null)} className="p-1 text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRecordContribution} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">
                  Select Months & Amount to Record (Full or Partial Payment) *
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(collectMember.pendingMonths.length > 0
                    ? collectMember.pendingMonths
                    : [new Date().toISOString().slice(0, 7)]
                  ).map((mk) => {
                    const checked = selectedMonths.includes(mk);
                    const mh = collectMember.monthHistory.find((x) => x.monthKey === mk);
                    return (
                      <button
                        key={mk}
                        type="button"
                        onClick={() => toggleMonth(mk)}
                        className={`min-h-[44px] px-3 py-2 rounded-xl border text-left transition-colors ${
                          checked
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 border-[#0B4F32] text-[#0B4F32] dark:text-emerald-300'
                            : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 text-xs font-semibold">
                          <span>{formatMonthKey(mk, lang, numerals)}</span>
                          {checked && <Check className="w-3.5 h-3.5 shrink-0" />}
                        </div>
                        <div className="text-[11px] font-data opacity-80">
                          Due: {formatINR(mh?.remaining ?? collectMember.monthlyAmount, numerals)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {selectedMonths.length > 0 && (
                <div className="space-y-2 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40">
                  <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                    Exact Payment Per Month (edit to record partial payment)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {selectedMonths.map((mk) => {
                      const mh = collectMember.monthHistory.find((x) => x.monthKey === mk);
                      const maxDue = mh?.remaining ?? collectMember.monthlyAmount;
                      return (
                        <div key={mk} className="flex items-center justify-between gap-2 bg-white dark:bg-[#121D18] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                          <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                            {formatMonthKey(mk, lang, numerals)}
                            <span className="block text-[10px] font-normal text-slate-500">
                              Rem: {formatINR(maxDue, numerals)}
                            </span>
                          </div>
                          <input
                            type="number"
                            min={1}
                            required
                            value={monthAmounts[mk] ?? String(maxDue)}
                            onChange={(e) =>
                              setMonthAmounts((cur) => ({ ...cur, [mk]: e.target.value }))
                            }
                            className="w-24 px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-data font-bold text-right"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="p-3 rounded-xl bg-[#F6F8F7] dark:bg-[#0D1612] flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Total Payment ({selectedMonths.length} month{selectedMonths.length === 1 ? '' : 's'})
                </span>
                <span className="text-lg font-bold font-data text-[#0B4F32] dark:text-emerald-400">
                  {formatINR(
                    selectedMonths.reduce(
                      (sum, mk) => sum + Number(monthAmounts[mk] ?? collectMember.monthlyAmount ?? 0),
                      0
                    ),
                    numerals
                  )}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Fund Account</label>
                  <select
                    value={payFundId}
                    onChange={(e) => setPayFundId(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  >
                    {funds
                      .filter((f) => f.id === 'masjid_general' || f.id === 'madrasa_general')
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.nameEn}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Payment Method</label>
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as 'Cash' | 'UPI' | 'Bank')}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  >
                    <option value="Cash">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="Bank">Bank Transfer</option>
                  </select>
                </div>
              </div>

              {payMethod !== 'Cash' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Deposited Into Bank</label>
                  <select
                    value={payBankId}
                    onChange={(e) => setPayBankId(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  >
                    {bankAccounts.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.bankName} — {b.accountName}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Date</label>
                  <input
                    type="date"
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Remarks (Optional)</label>
                  <input
                    type="text"
                    value={payNotes}
                    onChange={(e) => setPayNotes(e.target.value)}
                    placeholder="UTR or counter note"
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCollectMember(null)}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium"
                >
                  {t(lang, 'cancel')}
                </button>
                <button
                  type="submit"
                  disabled={submitting || selectedMonths.length === 0}
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] disabled:opacity-50 text-white text-sm font-semibold"
                >
                  {submitting ? 'Recording...' : 'Confirm & Issue Receipt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
