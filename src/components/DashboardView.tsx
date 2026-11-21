import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import {
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Building2,
  QrCode,
  FileSpreadsheet,
} from 'lucide-react';
import type {
  AuthUser,
  DashboardSummary,
  FundSummary,
  Language,
  NumeralSystem,
  TransactionRecord,
} from '../types';
import {
  COMMITTEE_TITLE,
  COMMITTEE_ADDRESS,
  formatINR,
  formatMonthKey,
  t,
  toDisplayDigits,
} from '../i18n/translations';

interface DashboardViewProps {
  user: AuthUser;
  lang: Language;
  numerals: NumeralSystem;
  summary: DashboardSummary | null;
  funds: FundSummary[];
  recentTransactions: TransactionRecord[];
  onNavigate: (tab: string, subContext?: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  user,
  lang,
  numerals,
  summary,
  funds,
  recentTransactions,
  onNavigate,
}) => {
  const isAdmin = user.role === 'admin_main' || user.role === 'admin_secondary';

  if (!summary) {
    return (
      <div className="space-y-4">
        <div className="h-32 rounded-2xl bg-slate-200/70 dark:bg-slate-800/60 animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-slate-200/70 dark:bg-slate-800/60 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const primaryKpis = [
    {
      label: t(lang, 'totalBankBalance'),
      value: formatINR(summary.totalBankBalance, numerals),
      sub: 'Single Physical Bank (SBI)',
      tone: 'emerald',
      action: () => onNavigate('bank'),
    },
    {
      label: t(lang, 'totalCashBalance'),
      value: formatINR(summary.totalCashBalance, numerals),
      sub: 'Committee Cash-in-Hand',
      tone: 'teal',
      action: () => onNavigate('accounts'),
    },
    {
      label: t(lang, 'monthlyIncome'),
      value: formatINR(summary.monthlyIncome, numerals),
      sub: formatMonthKey(summary.currentMonthKey, lang, numerals),
      tone: 'emerald',
      action: () => onNavigate('accounts', 'ledger'),
    },
    {
      label: t(lang, 'monthlyExpenses'),
      value: formatINR(summary.monthlyExpense, numerals),
      sub: formatMonthKey(summary.currentMonthKey, lang, numerals),
      tone: 'rose',
      action: () => onNavigate('accounts', 'ledger'),
    },
    {
      label: t(lang, 'contributionsReceived'),
      value: formatINR(summary.totalContributionsReceived, numerals),
      sub: `${formatINR(summary.monthlyContributionsReceived, numerals)} this month`,
      tone: 'emerald',
      action: () => onNavigate('members'),
    },
    {
      label: t(lang, 'outstandingContributions'),
      value: formatINR(summary.totalOutstandingContributions, numerals),
      sub: `${toDisplayDigits(summary.outstandingMemberCount, numerals)} members pending`,
      tone: 'amber',
      action: () => onNavigate('members', 'pending'),
    },
    {
      label: t(lang, 'pendingSalaries'),
      value: formatINR(summary.totalPendingSalaries, numerals),
      sub: 'Imam & Madrasa Teachers',
      tone: 'amber',
      action: () => onNavigate('salaries'),
    },
    {
      label: t(lang, 'totalBalance'),
      value: formatINR(summary.totalBalance, numerals),
      sub: summary.reconciliation?.isReconciled
        ? 'Reconciled · 10 Virtual Funds'
        : 'Verified Bank + Cash',
      tone: 'slate',
      action: () => onNavigate('reports'),
    },
  ];

  const fundBalances = [
    { id: 'masjid_general', label: t(lang, 'masjidBalance'), amount: summary.masjidBalance, scope: 'Masjid' },
    { id: 'madrasa_general', label: t(lang, 'madrasaBalance'), amount: summary.madrasaBalance, scope: 'Madrasa' },
    { id: 'ramadan', label: t(lang, 'ramadanBalance'), amount: summary.ramadanBalance, scope: 'Restricted' },
    { id: 'zakat', label: t(lang, 'zakatBalance'), amount: summary.zakatBalance, scope: 'Restricted' },
    { id: 'fitra', label: t(lang, 'fitraBalance'), amount: summary.fitraBalance, scope: 'Restricted' },
    { id: 'sadqa', label: t(lang, 'sadqaBalance'), amount: summary.sadqaBalance, scope: 'Restricted' },
    { id: 'rabi_ul_awwal', label: t(lang, 'rabiBalance'), amount: summary.rabiUlAwwalBalance, scope: 'Restricted' },
    { id: 'juma', label: t(lang, 'jumaBalance'), amount: summary.jumaBalance, scope: 'Masjid' },
  ];

  return (
    <div className="space-y-6">
      {/* Institutional Hero Header Card */}
      <section className="rounded-2xl bg-[#0B4F32] text-white p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
        <div className="min-w-0">
          <p className="text-xs text-emerald-200/90 font-medium">
            {isAdmin
              ? user.role === 'admin_main'
                ? t(lang, 'adminMainBadge')
                : t(lang, 'adminSecBadge')
              : t(lang, 'readOnlyBadge')}
            <span aria-hidden="true"> · </span>
            <span>{user.fullName}</span>
          </p>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight mt-1 text-white">
            {COMMITTEE_TITLE}
          </h1>
          <p className="text-xs sm:text-sm text-emerald-100/85 mt-1">
            {COMMITTEE_ADDRESS}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {isAdmin ? (
            <>
              <button
                type="button"
                onClick={() => onNavigate('accounts', 'new_entry')}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-white text-[#0B4F32] hover:bg-emerald-50 text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>{t(lang, 'newTransaction')}</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('members', 'collect')}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-800/80 hover:bg-emerald-800 text-white border border-white/15 text-sm font-medium inline-flex items-center gap-2 whitespace-nowrap transition-colors"
              >
                <span>{t(lang, 'recordContribution')}</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onNavigate('bank')}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-white text-[#0B4F32] hover:bg-emerald-50 text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors"
              >
                <QrCode className="w-4 h-4" />
                <span>{t(lang, 'navBankQr')}</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-800/80 hover:bg-emerald-800 text-white border border-white/15 text-sm font-medium inline-flex items-center gap-2 whitespace-nowrap transition-colors"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>{t(lang, 'navReports')}</span>
              </button>
            </>
          )}
        </div>
      </section>

      {/* Admin Action Alerts (Dual Approval & Screenshot Verification) */}
      {(summary.pendingApprovalsCount > 0 || summary.pendingVerificationsCount > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {summary.pendingApprovalsCount > 0 && (
            <button
              type="button"
              onClick={() => onNavigate('approvals')}
              className="text-left p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 flex items-center justify-between gap-4 hover:bg-amber-100/70 dark:hover:bg-amber-950/50 transition-colors"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-amber-950 dark:text-amber-200">
                    {toDisplayDigits(summary.pendingApprovalsCount, numerals)} Expense Pending Dual-Admin Approval
                  </div>
                  <div className="text-xs text-amber-800/90 dark:text-amber-300/80 mt-0.5">
                    Excluded from official balances until verified by the second administrator.
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
            </button>
          )}
          {summary.pendingVerificationsCount > 0 && (
            <button
              type="button"
              onClick={() => onNavigate('bank')}
              className="text-left p-4 rounded-xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/60 flex items-center justify-between gap-4 hover:bg-sky-100/70 dark:hover:bg-sky-950/50 transition-colors"
            >
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-sky-700 dark:text-sky-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-sky-950 dark:text-sky-200">
                    {toDisplayDigits(summary.pendingVerificationsCount, numerals)} Member Payment Proof Awaiting Verification
                  </div>
                  <div className="text-xs text-sky-800/90 dark:text-sky-300/80 mt-0.5">
                    Uploaded screenshots never update official accounts until verified by an admin.
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-sky-700 dark:text-sky-400 shrink-0" />
            </button>
          )}
        </div>
      )}

      {/* Primary KPI Grid (8 core financial indicators) */}
      <section>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {primaryKpis.map((kpi) => {
            const valueColor =
              kpi.tone === 'rose'
                ? 'text-rose-700 dark:text-rose-400'
                : kpi.tone === 'amber'
                ? 'text-amber-700 dark:text-amber-400'
                : kpi.tone === 'emerald'
                ? 'text-[#0B4F32] dark:text-emerald-400'
                : 'text-slate-900 dark:text-slate-100';

            return (
              <button
                key={kpi.label}
                type="button"
                onClick={kpi.action}
                className="text-left p-4 rounded-xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 hover:border-[#0B4F32]/50 dark:hover:border-emerald-600/60 transition-colors"
              >
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
                  {kpi.label}
                </div>
                <div className={`text-2xl font-bold font-data mt-1.5 tracking-tight ${valueColor}`}>
                  {kpi.value}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">
                  {kpi.sub}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Dedicated Separate Fund Balances Grid (Masjid, Madrasa, Ramadan, Zakat, Fitra, Sadqa, Rabi-ul-Awwal, Juma) */}
      <section className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Separate Fund Accounts ({toDisplayDigits(funds.length, numerals)} Funds)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Restricted-purpose funds (Zakat, Fitra, Ramadan, Sadqa) are tracked separately and never mixed.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('accounts')}
            className="text-xs font-semibold text-[#0B4F32] dark:text-emerald-400 hover:underline whitespace-nowrap shrink-0 inline-flex items-center gap-1"
          >
            <span>{t(lang, 'viewAll')}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {fundBalances.map((fb) => (
            <button
              key={fb.id}
              type="button"
              onClick={() => onNavigate('accounts', fb.id)}
              className="text-left p-3.5 rounded-xl bg-[#F6F8F7] dark:bg-[#0D1612] border border-slate-200/80 dark:border-slate-800 hover:border-[#0B4F32] dark:hover:border-emerald-500 transition-colors"
            >
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="truncate font-medium">{fb.label}</span>
              </div>
              <div className="text-lg font-bold font-data text-slate-900 dark:text-slate-100 mt-1">
                {formatINR(fb.amount, numerals)}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {fb.scope} Account
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Chart + Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Income vs Expenditure Chart */}
        <section className="lg:col-span-7 rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {t(lang, 'incomeVsExpense')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Verified approved entries over the last 6 months (INR)
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-300 shrink-0">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#0B4F32]" />
                {t(lang, 'income')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-rose-600" />
                {t(lang, 'expense')}
              </span>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.monthlyChart} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `₹${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`}
                />
                <Tooltip
                  formatter={(value: any) => formatINR(Number(value), numerals)}
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid rgba(148,163,184,0.25)',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="income" name={t(lang, 'income')} fill="#0B4F32" radius={[6, 6, 0, 0]} maxBarSize={28} />
                <Bar dataKey="expense" name={t(lang, 'expense')} fill="#E11D48" radius={[6, 6, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Recent Financial Transactions */}
        <section className="lg:col-span-5 rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5 flex flex-col">
          <div className="flex items-center justify-between gap-4 mb-3">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {t(lang, 'recentTransactions')}
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('accounts', 'ledger')}
              className="text-xs font-semibold text-[#0B4F32] dark:text-emerald-400 hover:underline whitespace-nowrap"
            >
              {t(lang, 'viewAll')}
            </button>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800/80 flex-1">
            {recentTransactions.slice(0, 7).map((tx) => (
              <div key={tx.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    {tx.partyName}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {tx.category}
                    <span aria-hidden="true"> · </span>
                    {tx.date}
                    <span aria-hidden="true"> · </span>
                    {tx.paymentMethod}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div
                    className={`text-sm font-bold font-data ${
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
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {tx.status === 'pending_approval' ? 'Pending Approval' : tx.txnNumber}
                  </div>
                </div>
              </div>
            ))}
            {recentTransactions.length === 0 && (
              <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                <Building2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
                No transactions recorded yet.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
