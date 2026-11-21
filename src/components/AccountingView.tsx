import React, { useMemo, useState } from 'react';
import {
  Plus,
  Search,
  RotateCcw,
  Upload,
  FileImage,
  X,
  AlertTriangle,
  ArrowLeftRight,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import type {
  AppSettings,
  AuthUser,
  BankAccountRecord,
  FundSummary,
  Language,
  NumeralSystem,
  ReconciliationSummary,
  TransactionRecord,
} from '../types';
import { formatINR, t, toDisplayDigits } from '../i18n/translations';

interface AccountingViewProps {
  user: AuthUser;
  lang: Language;
  numerals: NumeralSystem;
  funds: FundSummary[];
  transactions: TransactionRecord[];
  bankAccounts: BankAccountRecord[];
  reconciliation?: ReconciliationSummary | null;
  settings: AppSettings | null;
  initialSubTab?: string;
  onRefresh: () => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

const MASJID_INCOME_CATS = [
  'Monthly Member Contribution',
  'Friday/Juma Donations',
  'General Donations',
  'Special Donations',
  'Other Income',
];

const MASJID_EXPENSE_CATS = [
  'Electricity Bills',
  'Water Bills',
  'Cleaning Expenses',
  'Repairs & Maintenance',
  'Construction Expenses',
  'Imam Salary',
  'Other Expenses',
];

const MADRASA_INCOME_CATS = [
  'Monthly Contributions',
  'Madrasa Donations',
  'Ramadan Donations',
  'Zakat Collection',
  'Fitra Collection',
  'Sadqa Donations',
  'Other Contributions',
];

const MADRASA_EXPENSE_CATS = [
  "Teachers' Salaries",
  'Food Expenses',
  'Student Expenses',
  'Books & Stationery',
  'Electricity & Water',
  'Building Maintenance',
  'Other Expenses',
];

const GENERAL_INCOME_CATS = [
  'Ramadan Donations',
  'Zakat Collection',
  'Fitra Collection',
  'Sadqa Donations',
  'Rabi-ul-Awwal Collection',
  'Friday/Juma Donations',
  'General Donations',
  'Special Donations',
  'Other Income',
];

const GENERAL_EXPENSE_CATS = [
  'Student Expenses',
  'Poor & Needy Relief (Zakat/Fitra)',
  'Iftar & Ramadan Arrangements',
  'Jalsa & Langar',
  'Electricity Bills',
  'Water Bills',
  'Repairs & Maintenance',
  'Construction Expenses',
  'Food Expenses',
  'Books & Stationery',
  'Cleaning Expenses',
  'Other Expenses',
];

export const AccountingView: React.FC<AccountingViewProps> = ({
  user,
  lang,
  numerals,
  funds,
  transactions,
  bankAccounts,
  reconciliation,
  settings,
  initialSubTab,
  onRefresh,
  onNotify,
}) => {
  const isAdmin = user.role === 'admin_main' || user.role === 'admin_secondary';

  const initialTabState = (): 'funds' | 'masjid' | 'madrasa' | 'ledger' => {
    if (initialSubTab === 'ledger') return 'ledger';
    if (initialSubTab === 'masjid_general' || initialSubTab === 'masjid') return 'masjid';
    if (initialSubTab === 'madrasa_general' || initialSubTab === 'madrasa') return 'madrasa';
    return 'funds';
  };

  const [subTab, setSubTab] = useState<'funds' | 'masjid' | 'madrasa' | 'ledger'>(initialTabState);
  const [fundFilter, setFundFilter] = useState<string>(
    initialSubTab && funds.some((f) => f.id === initialSubTab) ? initialSubTab : 'all'
  );
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  // Modals
  const [showEntryModal, setShowEntryModal] = useState(initialSubTab === 'new_entry' && isAdmin);
  const [reverseTarget, setReverseTarget] = useState<TransactionRecord | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);

  // New Entry form
  const [entryType, setEntryType] = useState<'income' | 'expense' | 'transfer'>('expense');
  const [entryFundId, setEntryFundId] = useState('masjid_general');
  const [entryTargetFundId, setEntryTargetFundId] = useState('madrasa_general');
  const [entryCategory, setEntryCategory] = useState('Electricity Bills');
  const [entryAmount, setEntryAmount] = useState('');
  const [entryParty, setEntryParty] = useState('');
  const [entryMethod, setEntryMethod] = useState<'Cash' | 'UPI' | 'Bank'>('Cash');
  const [entryBankId, setEntryBankId] = useState(bankAccounts[0]?.id || 'bank_sbi_committee');
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [entryDesc, setEntryDesc] = useState('');
  const [entryReceiptUrl, setEntryReceiptUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const masjidStats = useMemo(() => {
    const f = funds.find((x) => x.id === 'masjid_general');
    const juma = funds.find((x) => x.id === 'juma');
    const txns = transactions.filter(
      (tx) => tx.fundId === 'masjid_general' || tx.fundId === 'juma' || tx.targetFundId === 'masjid_general'
    );
    return {
      opening: (f?.openingBalance || 0) + (juma?.openingBalance || 0),
      income: (f?.totalIncome || 0) + (juma?.totalIncome || 0),
      expense: (f?.totalExpense || 0) + (juma?.totalExpense || 0),
      balance: (f?.currentBalance || 0) + (juma?.currentBalance || 0),
      txns,
    };
  }, [funds, transactions]);

  const madrasaStats = useMemo(() => {
    const f = funds.find((x) => x.id === 'madrasa_general');
    const txns = transactions.filter((tx) => tx.fundId === 'madrasa_general' || tx.targetFundId === 'madrasa_general');
    return {
      opening: f?.openingBalance || 0,
      income: f?.totalIncome || 0,
      expense: f?.totalExpense || 0,
      balance: f?.currentBalance || 0,
      txns,
    };
  }, [funds, transactions]);

  const filteredTxns = useMemo(() => {
    const q = search.toLowerCase().trim();
    return transactions.filter((tx) => {
      if (fundFilter !== 'all' && tx.fundId !== fundFilter && tx.targetFundId !== fundFilter) return false;
      if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
      if (
        q &&
        !(
          tx.txnNumber.toLowerCase().includes(q) ||
          tx.partyName.toLowerCase().includes(q) ||
          tx.category.toLowerCase().includes(q) ||
          tx.description.toLowerCase().includes(q) ||
          tx.date.includes(q) ||
          String(tx.amount).includes(q)
        )
      )
        return false;
      return true;
    });
  }, [transactions, fundFilter, typeFilter, search]);

  function openNewEntry(presetFund = 'masjid_general', presetType: 'income' | 'expense' | 'transfer' = 'expense') {
    setEntryType(presetType);
    setEntryFundId(presetFund);
    setEntryTargetFundId(presetFund === 'masjid_general' ? 'madrasa_general' : 'masjid_general');
    if (presetType === 'transfer') {
      setEntryCategory('Inter-Fund Transfer');
    } else if (presetFund === 'madrasa_general') {
      setEntryCategory(presetType === 'income' ? MADRASA_INCOME_CATS[0] : MADRASA_EXPENSE_CATS[0]);
    } else {
      setEntryCategory(presetType === 'income' ? MASJID_INCOME_CATS[0] : MASJID_EXPENSE_CATS[0]);
    }
    setEntryAmount('');
    setEntryParty('');
    setEntryMethod('Cash');
    setEntryDesc('');
    setEntryReceiptUrl(null);
    setShowEntryModal(true);
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      onNotify('Receipt image must be smaller than 3 MB.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setEntryReceiptUrl(reader.result);
    };
    reader.readAsDataURL(file);
  }

  async function handleSaveEntry(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiRequest<{ txnNumber: string; needsDualApproval: boolean }>('/api/transactions', {
        method: 'POST',
        body: {
          date: entryDate,
          type: entryType,
          category: entryType === 'transfer' ? 'Inter-Fund Transfer' : entryCategory,
          fundId: entryFundId,
          targetFundId: entryType === 'transfer' ? entryTargetFundId : null,
          bankAccountId: entryMethod === 'Cash' ? null : entryBankId,
          paymentMethod: entryMethod,
          amount: Number(entryAmount),
          partyName: entryParty,
          description: entryDesc,
          receiptUrl: entryReceiptUrl,
        },
      });
      setShowEntryModal(false);
      onRefresh();
      if (res.needsDualApproval) {
        onNotify(
          `Entry ${res.txnNumber} saved as PENDING APPROVAL (exceeds ₹${settings?.dualApprovalLimit.toLocaleString('en-IN')}). Second Admin must approve.`,
          'success'
        );
      } else {
        onNotify(`Transaction ${res.txnNumber} recorded and fund balance updated.`, 'success');
      }
    } catch (err: any) {
      onNotify(err.message || 'Failed to record entry', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmReversal(e: React.FormEvent) {
    e.preventDefault();
    if (!reverseTarget) return;
    setSubmitting(true);
    try {
      const res = await apiRequest<{ reversalTxnNumber: string }>(`/api/transactions/${reverseTarget.id}/reverse`, {
        method: 'POST',
        body: { reason: reverseReason },
      });
      setReverseTarget(null);
      setReverseReason('');
      onRefresh();
      onNotify(`Original record preserved. Reversal entry ${res.reversalTxnNumber} logged.`, 'success');
    } catch (err: any) {
      onNotify(err.message || 'Reversal failed', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function fundLabel(f: FundSummary): string {
    return lang === 'hi' ? f.nameHi : lang === 'ur' ? f.nameUr : f.nameEn;
  }

  const categoryChoices = useMemo(() => {
    if (entryType === 'transfer') return ['Inter-Fund Transfer'];
    if (entryFundId === 'masjid_general') return entryType === 'income' ? MASJID_INCOME_CATS : MASJID_EXPENSE_CATS;
    if (entryFundId === 'madrasa_general') return entryType === 'income' ? MADRASA_INCOME_CATS : MADRASA_EXPENSE_CATS;
    return entryType === 'income' ? GENERAL_INCOME_CATS : GENERAL_EXPENSE_CATS;
  }, [entryType, entryFundId]);

  const willNeedDualApproval =
    entryType === 'expense' &&
    Boolean(settings?.dualApprovalEnabled) &&
    Number(entryAmount || 0) > (settings?.dualApprovalLimit || 5000);

  return (
    <div className="space-y-6">
      {/* Sub-Navigation & Primary Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-200/70 dark:bg-slate-900 overflow-x-auto">
          {(
            [
              ['funds', t(lang, 'allFundsTab')],
              ['masjid', t(lang, 'masjidTab')],
              ['madrasa', t(lang, 'madrasaTab')],
              ['ledger', t(lang, 'ledgerTab')],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSubTab(key)}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap min-h-[38px] transition-colors ${
                subTab === key
                  ? 'bg-white dark:bg-[#192822] text-[#0B4F32] dark:text-emerald-300 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => openNewEntry(subTab === 'madrasa' ? 'madrasa_general' : 'masjid_general', 'income')}
              className="min-h-[42px] px-3.5 py-2 rounded-xl border border-[#0B4F32] text-[#0B4F32] dark:text-emerald-300 dark:border-emerald-600 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
            >
              <Plus className="w-4 h-4" />
              <span>{t(lang, 'income')}</span>
            </button>
            <button
              type="button"
              onClick={() => openNewEntry(subTab === 'madrasa' ? 'madrasa_general' : 'masjid_general', 'expense')}
              className="min-h-[42px] px-3.5 py-2 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>{t(lang, 'expense')}</span>
            </button>
            <button
              type="button"
              onClick={() => openNewEntry('juma', 'transfer')}
              title="Record Inter-Fund Transfer"
              className="min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t(lang, 'transfer')}</span>
            </button>
          </div>
        )}
      </div>

      {/* Double-Entry Trial Balance & Virtual Fund Reconciliation Strip */}
      {reconciliation && (
        <div className="p-4 rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 grid grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div>
            <div className="text-slate-500 dark:text-slate-400">Double-Entry Trial Balance</div>
            <div className="font-data font-bold text-sm text-emerald-700 dark:text-emerald-400 mt-0.5">
              Dr {formatINR(reconciliation.totalDebits, numerals)} = Cr {formatINR(reconciliation.totalCredits, numerals)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {reconciliation.isBalanced ? 'Balanced' : 'Check Needed'} · {toDisplayDigits(reconciliation.journalLineCount, numerals)} journal lines
            </div>
          </div>
          <div>
            <div className="text-slate-500 dark:text-slate-400">Single Physical Bank (SBI)</div>
            <div className="font-data font-bold text-sm text-slate-900 dark:text-slate-100 mt-0.5">
              {formatINR(reconciliation.physicalBankBalance, numerals)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Reconciled Bank Ledger</div>
          </div>
          <div>
            <div className="text-slate-500 dark:text-slate-400">Cash-in-Hand Ledger</div>
            <div className="font-data font-bold text-sm text-slate-900 dark:text-slate-100 mt-0.5">
              {formatINR(reconciliation.cashBalance, numerals)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Separate Physical Cash</div>
          </div>
          <div>
            <div className="text-slate-500 dark:text-slate-400">Sum of 10 Virtual Funds</div>
            <div className="font-data font-bold text-sm text-[#0B4F32] dark:text-emerald-400 mt-0.5">
              {formatINR(reconciliation.sumOfVirtualFunds, numerals)}
            </div>
            <div className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium mt-0.5">
              {reconciliation.isReconciled ? 'Matches Bank + Cash Exactly' : 'Reconciliation Drift'}
            </div>
          </div>
        </div>
      )}

      {/* TAB 1: ALL 10 SEPARATE FUNDS */}
      {subTab === 'funds' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {funds.map((f) => (
            <div
              key={f.id}
              className="p-5 rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 flex flex-col justify-between gap-4"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{fundLabel(f)}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {f.code} · {f.isRestricted ? 'Restricted Purpose Fund' : 'General Committee Fund'}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold font-data text-[#0B4F32] dark:text-emerald-400">
                      {formatINR(f.currentBalance, numerals)}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Current Balance</div>
                  </div>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-2.5 leading-relaxed">
                  {f.restrictedRule}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
                <div>
                  <div className="text-slate-500 dark:text-slate-400">Opening</div>
                  <div className="font-data font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                    {formatINR(f.openingBalance, numerals)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500 dark:text-slate-400">Verified Income</div>
                  <div className="font-data font-semibold text-emerald-700 dark:text-emerald-400 mt-0.5">
                    +{formatINR(f.totalIncome, numerals)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500 dark:text-slate-400">Verified Expense</div>
                  <div className="font-data font-semibold text-rose-700 dark:text-rose-400 mt-0.5">
                    -{formatINR(f.totalExpense, numerals)}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 text-xs pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400">
                  {toDisplayDigits(f.transactionCount, numerals)} entries
                  {f.pendingCount > 0 ? ` · ${toDisplayDigits(f.pendingCount, numerals)} pending approval` : ''}
                  {f.transfersIn - f.transfersOut !== 0
                    ? ` · Net Transfer: ${formatINR(f.transfersIn - f.transfersOut, numerals)}`
                    : ''}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setFundFilter(f.id);
                    setSubTab('ledger');
                  }}
                  className="font-semibold text-[#0B4F32] dark:text-emerald-400 hover:underline whitespace-nowrap"
                >
                  View Ledger →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 2 & 3: DEDICATED MASJID OR MADRASA ACCOUNTING */}
      {(subTab === 'masjid' || subTab === 'madrasa') && (
        <div className="space-y-5">
          {(() => {
            const st = subTab === 'masjid' ? masjidStats : madrasaStats;
            const title =
              subTab === 'masjid'
                ? 'Noori Jama Masjid — Dedicated Income & Expenditure Account'
                : 'Madarsa Anwarool Uloom — Dedicated Income & Expenditure Account';
            const subtitle =
              subTab === 'masjid'
                ? 'Covers Masjid General Fund & Friday/Juma Collections · Electricity, Water, Cleaning, Repairs, Construction & Imam Salary'
                : 'Covers Madrasa General Fund · Monthly Contributions, Donations, Teachers Salaries, Student Food, Books & Building Maintenance';

            return (
              <>
                <div className="p-5 rounded-2xl bg-[#0B4F32] text-white">
                  <h2 className="text-lg font-bold">{title}</h2>
                  <p className="text-xs text-emerald-100/85 mt-1">{subtitle}</p>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
                    <div className="p-3 rounded-xl bg-white/10">
                      <div className="text-xs text-emerald-100">Opening Balance</div>
                      <div className="text-lg font-bold font-data mt-0.5">{formatINR(st.opening, numerals)}</div>
                    </div>
                    <div className="p-3 rounded-xl bg-white/10">
                      <div className="text-xs text-emerald-100">Total Verified Income</div>
                      <div className="text-lg font-bold font-data mt-0.5">{formatINR(st.income, numerals)}</div>
                    </div>
                    <div className="p-3 rounded-xl bg-white/10">
                      <div className="text-xs text-emerald-100">Total Verified Expenses</div>
                      <div className="text-lg font-bold font-data mt-0.5">{formatINR(st.expense, numerals)}</div>
                    </div>
                    <div className="p-3 rounded-xl bg-white/15 border border-white/20">
                      <div className="text-xs text-amber-200">Remaining Balance</div>
                      <div className="text-xl font-bold font-data mt-0.5">{formatINR(st.balance, numerals)}</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Recent Entries ({toDisplayDigits(st.txns.length, numerals)})
                    </h3>
                    <button
                      type="button"
                      onClick={() => {
                        setFundFilter(subTab === 'masjid' ? 'masjid_general' : 'madrasa_general');
                        setSubTab('ledger');
                      }}
                      className="text-xs font-semibold text-[#0B4F32] dark:text-emerald-400 hover:underline"
                    >
                      Open Full Searchable Ledger →
                    </button>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {st.txns.slice(0, 15).map((tx) => (
                      <div key={tx.id} className="px-5 py-3 flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {tx.category} — {tx.partyName}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {tx.txnNumber} · {tx.date} · {tx.paymentMethod} · By {tx.createdByName}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div
                            className={`text-sm font-bold font-data ${
                              tx.type === 'income'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : tx.type === 'expense'
                                ? 'text-rose-700 dark:text-rose-400'
                                : 'text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : '⇄ '}
                            {formatINR(tx.amount, numerals)}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">{tx.status}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* TAB 4: FULL TRANSACTION LEDGER */}
      {subTab === 'ledger' && (
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by date (YYYY-MM-DD), party name, Txn #, category, or amount..."
                className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121D18] text-sm"
              />
            </div>
            <select
              value={fundFilter}
              onChange={(e) => setFundFilter(e.target.value)}
              className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121D18] text-sm"
            >
              <option value="all">All 10 Funds</option>
              {funds.map((f) => (
                <option key={f.id} value={f.id}>
                  {fundLabel(f)}
                </option>
              ))}
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121D18] text-sm"
            >
              <option value="all">All Types</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
              <option value="transfer">Fund Transfers</option>
              <option value="reversal">Reversals</option>
            </select>
          </div>

          <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[760px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4 font-semibold">Txn # & Date</th>
                  <th className="py-3 px-4 font-semibold">Fund & Category</th>
                  <th className="py-3 px-4 font-semibold">Party & Description</th>
                  <th className="py-3 px-4 font-semibold">Method / Admin</th>
                  <th className="py-3 px-4 font-semibold text-right">Amount</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
                {filteredTxns.map((tx) => (
                  <tr
                    key={tx.id}
                    className={`hover:bg-slate-50/70 dark:hover:bg-slate-900/40 ${
                      tx.status === 'reversed' || tx.status === 'rejected' ? 'opacity-60' : ''
                    }`}
                  >
                    <td className="py-3 px-4 align-top">
                      <div className="font-data text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {tx.txnNumber}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{tx.date}</div>
                    </td>
                    <td className="py-3 px-4 align-top">
                      <div className="font-medium text-slate-900 dark:text-slate-100 text-xs">
                        {tx.fundName || tx.fundId}
                        {tx.targetFundName ? ` → ${tx.targetFundName}` : ''}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{tx.category}</div>
                    </td>
                    <td className="py-3 px-4 align-top max-w-xs">
                      <div className="font-semibold text-slate-900 dark:text-slate-100 text-xs">{tx.partyName}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                        {tx.description || '-'}
                      </div>
                    </td>
                    <td className="py-3 px-4 align-top text-xs">
                      <div className="text-slate-800 dark:text-slate-200 font-medium">{tx.paymentMethod}</div>
                      <div className="text-slate-500 dark:text-slate-400 mt-0.5">{tx.createdByName}</div>
                    </td>
                    <td className="py-3 px-4 align-top text-right">
                      <div
                        className={`font-data font-bold ${
                          tx.type === 'income'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : tx.type === 'expense'
                            ? 'text-rose-700 dark:text-rose-400'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : '⇄ '}
                        {formatINR(tx.amount, numerals)}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 capitalize">
                        {tx.status.replace('_', ' ')}
                      </div>
                    </td>
                    <td className="py-3 px-4 align-top text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {tx.receiptUrl && (
                          <button
                            type="button"
                            onClick={() => setReceiptPreview(tx.receiptUrl)}
                            title="View Bill / Receipt"
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <FileImage className="w-4 h-4" />
                          </button>
                        )}
                        {isAdmin && tx.status === 'approved' && (
                          <button
                            type="button"
                            onClick={() => {
                              setReverseTarget(tx);
                              setReverseReason('');
                            }}
                            title="Reverse entry (preserves audit history)"
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredTxns.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                      No transactions match your search criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Record Income / Expense / Transfer Modal */}
      {showEntryModal && isAdmin && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-6 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Record Financial Entry</h3>
              <button type="button" onClick={() => setShowEntryModal(false)} className="p-1 text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900 mb-4">
              {(['income', 'expense', 'transfer'] as const).map((tp) => (
                <button
                  key={tp}
                  type="button"
                  onClick={() => {
                    setEntryType(tp);
                    if (tp === 'transfer') setEntryCategory('Inter-Fund Transfer');
                    else if (tp === 'income') setEntryCategory(MASJID_INCOME_CATS[0]);
                    else setEntryCategory(MASJID_EXPENSE_CATS[0]);
                  }}
                  className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
                    entryType === tp
                      ? tp === 'expense'
                        ? 'bg-rose-600 text-white'
                        : 'bg-[#0B4F32] text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {t(lang, tp)}
                </button>
              ))}
            </div>

            <form onSubmit={handleSaveEntry} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {entryType === 'transfer' ? 'Source Fund *' : 'Fund Account *'}
                  </label>
                  <select
                    value={entryFundId}
                    onChange={(e) => setEntryFundId(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  >
                    {funds.map((f) => (
                      <option key={f.id} value={f.id}>
                        {fundLabel(f)}
                      </option>
                    ))}
                  </select>
                </div>

                {entryType === 'transfer' ? (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Destination Fund *
                    </label>
                    <select
                      value={entryTargetFundId}
                      onChange={(e) => setEntryTargetFundId(e.target.value)}
                      className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    >
                      {funds
                        .filter((f) => f.id !== entryFundId)
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {fundLabel(f)}
                          </option>
                        ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Category *</label>
                    <select
                      value={entryCategory}
                      onChange={(e) => setEntryCategory(e.target.value)}
                      className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    >
                      {categoryChoices.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {(entryFundId === 'zakat' || entryFundId === 'fitra') && entryType !== 'income' && (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Restricted Fund Rule: Zakat and Fitra funds can only be disbursed to eligible poor families or eligible students (never for electricity, construction, or general utilities).
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Amount (₹) *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={entryAmount}
                    onChange={(e) => setEntryAmount(e.target.value)}
                    placeholder="5000"
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Date *</label>
                  <input
                    type="date"
                    required
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
              </div>

              {willNeedDualApproval && (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Exceeds Dual-Approval Limit ({formatINR(settings?.dualApprovalLimit || 5000, numerals)}). This expense will stay Pending until the second Administrator approves it.
                  </span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {entryType === 'income' ? 'Received From (Donor / Source) *' : entryType === 'expense' ? 'Paid To (Person / Organization) *' : 'Committee Resolution / Reference *'}
                </label>
                <input
                  type="text"
                  required
                  value={entryParty}
                  onChange={(e) => setEntryParty(e.target.value)}
                  placeholder="Enter full name or organization"
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Payment Method *</label>
                  <select
                    value={entryMethod}
                    onChange={(e) => setEntryMethod(e.target.value as 'Cash' | 'UPI' | 'Bank')}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  >
                    <option value="Cash">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="Bank">Bank Transfer</option>
                  </select>
                </div>

                {entryMethod !== 'Cash' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Bank Account *</label>
                    <select
                      value={entryBankId}
                      onChange={(e) => setEntryBankId(e.target.value)}
                      className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    >
                      {bankAccounts.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.bankName}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Purpose & Description</label>
                <textarea
                  rows={2}
                  value={entryDesc}
                  onChange={(e) => setEntryDesc(e.target.value)}
                  placeholder="Detailed bill description or donation note"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Upload Bill / Receipt Image (Optional)
                </label>
                <label className="flex items-center justify-center gap-2 min-h-[44px] px-3 py-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900 text-xs font-medium text-slate-600 dark:text-slate-300">
                  <Upload className="w-4 h-4" />
                  <span>{entryReceiptUrl ? 'Receipt image attached (click to replace)' : 'Choose bill/receipt image'}</span>
                  <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEntryModal(false)}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium"
                >
                  {t(lang, 'cancel')}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-sm font-semibold"
                >
                  {submitting ? 'Saving...' : willNeedDualApproval ? 'Submit for 2nd Admin Approval' : 'Save Official Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reversal Modal (Preserves original record permanently) */}
      {reverseTarget && isAdmin && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-6">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{t(lang, 'reverse')}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              Financial records are never permanently erased. Reversing{' '}
              <strong className="font-data text-slate-800 dark:text-slate-200">{reverseTarget.txnNumber}</strong> (
              {formatINR(reverseTarget.amount, numerals)}) will preserve the original entry and post an audited reversal entry.
            </p>
            <form onSubmit={handleConfirmReversal} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Mandatory Reason for Reversal *
                </label>
                <textarea
                  required
                  minLength={5}
                  rows={3}
                  value={reverseReason}
                  onChange={(e) => setReverseReason(e.target.value)}
                  placeholder="e.g. Entered wrong amount; re-entering with verified bill amount."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReverseTarget(null)}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm"
                >
                  {t(lang, 'cancel')}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold"
                >
                  Confirm Audited Reversal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Receipt Image Preview Modal */}
      {receiptPreview && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setReceiptPreview(null)}>
          <div className="max-w-xl w-full bg-white dark:bg-[#121D18] rounded-2xl p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">Uploaded Bill / Receipt</span>
              <button type="button" onClick={() => setReceiptPreview(null)} className="p-1 text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <img src={receiptPreview} alt="Bill receipt" className="w-full max-h-[70vh] object-contain rounded-xl" />
          </div>
        </div>
      )}
    </div>
  );
};
