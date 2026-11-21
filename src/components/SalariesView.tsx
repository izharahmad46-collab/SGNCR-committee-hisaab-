import React, { useMemo, useState } from 'react';
import { Plus, IndianRupee, Clock, ChevronDown, ChevronUp, X } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type {
  AuthUser,
  BankAccountRecord,
  Language,
  NumeralSystem,
  StaffSummary,
} from '../types';
import { formatINR, formatMonthKey, t, toDisplayDigits } from '../i18n/translations';

interface SalariesViewProps {
  user: AuthUser;
  lang: Language;
  numerals: NumeralSystem;
  staff: StaffSummary[];
  bankAccounts: BankAccountRecord[];
  onRefresh: () => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export const SalariesView: React.FC<SalariesViewProps> = ({
  user,
  lang,
  numerals,
  staff,
  bankAccounts,
  onRefresh,
  onNotify,
}) => {
  const isAdmin = user.role === 'admin_main' || user.role === 'admin_secondary';
  const [filterInst, setFilterInst] = useState<'all' | 'masjid' | 'madrasa'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(staff[0]?.id || null);

  // Modals
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [payTarget, setPayTarget] = useState<StaffSummary | null>(null);

  // Add Staff form
  const [sName, setSName] = useState('');
  const [sDesig, setSDesig] = useState('');
  const [sInst, setSInst] = useState<'masjid' | 'madrasa'>('madrasa');
  const [sSalary, setSSalary] = useState('8000');
  const [sPhone, setSPhone] = useState('+91 ');
  const [sJoin, setSJoin] = useState(new Date().toISOString().slice(0, 10));

  // Pay Salary form
  const [payMonth, setPayMonth] = useState(new Date().toISOString().slice(0, 7));
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'Cash' | 'UPI' | 'Bank'>('Bank');
  const [payBankId, setPayBankId] = useState(bankAccounts[0]?.id || 'bank_sbi_committee');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payRef, setPayRef] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const totals = useMemo(() => {
    return {
      totalPayable: staff.reduce((s, x) => s + x.totalPayable, 0),
      totalPaid: staff.reduce((s, x) => s + x.totalPaid, 0),
      totalPending: staff.reduce((s, x) => s + x.totalPending, 0),
      monthlyPayroll: staff.filter((x) => x.status === 'active').reduce((s, x) => s + x.monthlySalary, 0),
    };
  }, [staff]);

  const filtered = useMemo(
    () => staff.filter((s) => filterInst === 'all' || s.institution === filterInst),
    [staff, filterInst]
  );

  function openPayModal(s: StaffSummary) {
    setPayTarget(s);
    const pendingRow = s.monthlyHistory.find((m) => m.remaining > 0);
    setPayMonth(pendingRow ? pendingRow.monthKey : new Date().toISOString().slice(0, 7));
    setPayAmount(String(pendingRow ? pendingRow.remaining : s.monthlySalary));
    setPayMethod('Bank');
    setPayBankId(bankAccounts[0]?.id || 'bank_sbi_committee');
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayRef('');
  }

  async function handleAddStaff(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest('/api/salaries/staff', {
        method: 'POST',
        body: {
          name: sName,
          designation: sDesig,
          institution: sInst,
          monthlySalary: Number(sSalary),
          joiningDate: sJoin,
          phone: sPhone,
        },
      });
      setShowAddStaff(false);
      setSName('');
      setSDesig('');
      onRefresh();
      onNotify('Staff member added to payroll.', 'success');
    } catch (err: any) {
      onNotify(err.message || 'Failed to add staff', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePaySalary(e: React.FormEvent) {
    e.preventDefault();
    if (!payTarget) return;
    setSubmitting(true);
    try {
      const res = await apiRequest<{ txnNumber: string }>('/api/salaries/pay', {
        method: 'POST',
        body: {
          staffId: payTarget.id,
          monthKey: payMonth,
          amount: Number(payAmount),
          paymentDate: payDate,
          paymentMethod: payMethod,
          bankAccountId: payMethod === 'Cash' ? null : payBankId,
          reference: payRef,
        },
      });
      setPayTarget(null);
      onRefresh();
      onNotify(`Salary payment recorded (${res.txnNumber}) and posted to ${payTarget.institution} fund.`, 'success');
    } catch (err: any) {
      onNotify(err.message || 'Failed to pay salary', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Payroll KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">Monthly Payroll Obligation</div>
          <div className="text-xl font-bold font-data text-slate-900 dark:text-slate-100 mt-1">
            {formatINR(totals.monthlyPayroll, numerals)}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">Total Salary Payable</div>
          <div className="text-xl font-bold font-data text-slate-900 dark:text-slate-100 mt-1">
            {formatINR(totals.totalPayable, numerals)}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">Total Salary Paid</div>
          <div className="text-xl font-bold font-data text-emerald-700 dark:text-emerald-400 mt-1">
            {formatINR(totals.totalPaid, numerals)}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">{t(lang, 'pendingSalaries')}</div>
          <div className="text-xl font-bold font-data text-amber-700 dark:text-amber-400 mt-1">
            {formatINR(totals.totalPending, numerals)}
          </div>
        </div>
      </div>

      {/* Filter & Add Staff */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-200/70 dark:bg-slate-900">
          {(
            [
              ['all', 'All Staff'],
              ['masjid', 'Masjid (Imam & Muazzin)'],
              ['madrasa', 'Madrasa Teachers'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilterInst(key)}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold min-h-[38px] whitespace-nowrap transition-colors ${
                filterInst === key
                  ? 'bg-white dark:bg-[#192822] text-[#0B4F32] dark:text-emerald-300 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowAddStaff(true)}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Add Imam / Teacher</span>
          </button>
        )}
      </div>

      {/* Staff List */}
      <div className="space-y-4">
        {filtered.map((s) => {
          const isExp = expandedId === s.id;
          return (
            <div
              key={s.id}
              className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5"
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={() => setExpandedId(isExp ? null : s.id)}
                  className="text-left flex-1 min-w-0"
                >
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{s.name}</h3>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      · {s.designation} · {s.institution === 'masjid' ? 'Noori Jama Masjid' : 'Madarsa Anwarool Uloom'}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span className="text-slate-600 dark:text-slate-400">
                      Monthly Salary: <strong className="font-data text-slate-900 dark:text-slate-100">{formatINR(s.monthlySalary, numerals)}</strong>
                    </span>
                    <span className="text-slate-600 dark:text-slate-400">
                      Paid: <strong className="font-data text-emerald-700 dark:text-emerald-400">{formatINR(s.totalPaid, numerals)}</strong>
                    </span>
                    {s.totalPending > 0 ? (
                      <span className="text-amber-700 dark:text-amber-400 font-semibold inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        Remaining: <span className="font-data">{formatINR(s.totalPending, numerals)}</span>
                        <span>
                          ({toDisplayDigits(s.maxPendingDays, numerals)} days pending · {s.pendingMonths.map((m) => formatMonthKey(m, lang, numerals)).join(', ')})
                        </span>
                      </span>
                    ) : (
                      <span className="text-emerald-700 dark:text-emerald-400 font-medium">All Salaries Paid</span>
                    )}
                  </div>
                </button>

                <div className="flex items-center gap-2 shrink-0">
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => openPayModal(s)}
                      className="min-h-[42px] px-4 py-2 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <IndianRupee className="w-3.5 h-3.5" />
                      <span>{t(lang, 'recordSalary')}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExp ? null : s.id)}
                    className="min-h-[42px] min-w-[42px] inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500"
                  >
                    {isExp ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {isExp && (
                <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
                  <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    Monthly Salary History (Joined {s.joiningDate})
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {s.monthlyHistory.map((mh) => (
                      <div
                        key={mh.monthKey}
                        className="p-3.5 rounded-xl bg-[#F6F8F7] dark:bg-[#0D1612] border border-slate-200/70 dark:border-slate-800"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-slate-900 dark:text-slate-100">
                            {formatMonthKey(mh.monthKey, lang, numerals)}
                          </span>
                          <span
                            className={`font-semibold ${
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
                              ? `Partial (${toDisplayDigits(mh.pendingDays, numerals)}d)`
                              : `Pending (${toDisplayDigits(mh.pendingDays, numerals)}d)`}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                          <span>Payable: <strong className="font-data text-slate-900 dark:text-slate-100">{formatINR(mh.payable, numerals)}</strong></span>
                          <span>Paid: <strong className="font-data text-emerald-700 dark:text-emerald-400">{formatINR(mh.paid, numerals)}</strong></span>
                        </div>
                        {mh.remaining > 0 && (
                          <div className="text-xs font-semibold text-amber-700 dark:text-amber-400 mt-1">
                            Remaining: <span className="font-data">{formatINR(mh.remaining, numerals)}</span>
                          </div>
                        )}
                        {mh.payments.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-slate-200/70 dark:border-slate-800 space-y-1">
                            {mh.payments.map((p) => (
                              <div key={p.id} className="text-[11px] text-slate-500 dark:text-slate-400">
                                {p.paymentDate} · {formatINR(p.amount, numerals)} via {p.paymentMethod} · Ref: {p.reference || p.txnNumber}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Staff Modal */}
      {showAddStaff && isAdmin && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Add Imam / Madrasa Teacher</h3>
              <button type="button" onClick={() => setShowAddStaff(false)} className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddStaff} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={sName}
                  onChange={(e) => setSName(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Designation *</label>
                  <input
                    type="text"
                    required
                    value={sDesig}
                    onChange={(e) => setSDesig(e.target.value)}
                    placeholder="Imam / Hifz Teacher"
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Institution *</label>
                  <select
                    value={sInst}
                    onChange={(e) => setSInst(e.target.value as 'masjid' | 'madrasa')}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  >
                    <option value="masjid">Noori Jama Masjid</option>
                    <option value="madrasa">Madarsa Anwarool Uloom</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Monthly Salary (₹) *</label>
                  <input
                    type="number"
                    min={500}
                    required
                    value={sSalary}
                    onChange={(e) => setSSalary(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Joining Date *</label>
                  <input
                    type="date"
                    required
                    value={sJoin}
                    onChange={(e) => setSJoin(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Phone</label>
                <input
                  type="text"
                  value={sPhone}
                  onChange={(e) => setSPhone(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowAddStaff(false)} className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm">
                  {t(lang, 'cancel')}
                </button>
                <button type="submit" disabled={submitting} className="min-h-[44px] px-5 py-2 rounded-xl bg-[#0B4F32] text-white text-sm font-semibold">
                  {submitting ? 'Adding...' : 'Add Staff'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pay Salary Modal */}
      {payTarget && isAdmin && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{t(lang, 'recordSalary')}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {payTarget.name} · {payTarget.designation} ({formatINR(payTarget.monthlySalary, numerals)}/mo)
                </p>
              </div>
              <button type="button" onClick={() => setPayTarget(null)} className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handlePaySalary} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Salary Month *</label>
                  <input
                    type="month"
                    required
                    value={payMonth}
                    onChange={(e) => setPayMonth(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Amount Paying (₹) *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Payment Method</label>
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as 'Cash' | 'UPI' | 'Bank')}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  >
                    <option value="Bank">Bank Transfer</option>
                    <option value="UPI">UPI</option>
                    <option value="Cash">Cash</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Payment Date</label>
                  <input
                    type="date"
                    required
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
              </div>
              {payMethod !== 'Cash' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">From Bank Account</label>
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
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Payment Reference / UTR</label>
                <input
                  type="text"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  placeholder="NEFT/UPI Ref or Voucher No."
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setPayTarget(null)} className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm">
                  {t(lang, 'cancel')}
                </button>
                <button type="submit" disabled={submitting} className="min-h-[44px] px-5 py-2 rounded-xl bg-[#0B4F32] text-white text-sm font-semibold">
                  {submitting ? 'Recording...' : 'Confirm Salary Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
