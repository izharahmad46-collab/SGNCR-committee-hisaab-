import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Lock,
  Unlock,
  ShieldAlert,
  CalendarCheck,
  X,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import type {
  AppSettings,
  AuthUser,
  Language,
  MonthlyClosingRecord,
  NumeralSystem,
  TransactionRecord,
} from '../types';
import { formatINR, formatMonthKey, t } from '../i18n/translations';

interface ApprovalsClosingViewProps {
  user: AuthUser;
  lang: Language;
  numerals: NumeralSystem;
  transactions: TransactionRecord[];
  closings: MonthlyClosingRecord[];
  settings: AppSettings | null;
  onRefresh: () => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export const ApprovalsClosingView: React.FC<ApprovalsClosingViewProps> = ({
  user,
  lang,
  numerals,
  transactions,
  closings,
  settings,
  onRefresh,
  onNotify,
}) => {
  const isAdmin = user.role === 'admin_main' || user.role === 'admin_secondary';
  const isMainAdmin = user.role === 'admin_main';

  const [approvalFilter, setApprovalFilter] = useState<'pending_approval' | 'approved' | 'rejected'>('pending_approval');
  const [closingMonth, setClosingMonth] = useState(() => {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  });
  const [reopenTarget, setReopenTarget] = useState<MonthlyClosingRecord | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [busy, setBusy] = useState(false);

  const highValueTxns = useMemo(() => {
    const limit = settings?.dualApprovalLimit || 5000;
    return transactions.filter((tx) => {
      if (approvalFilter === 'pending_approval') return tx.status === 'pending_approval';
      if (approvalFilter === 'rejected') return tx.status === 'rejected';
      return tx.status === 'approved' && tx.type === 'expense' && tx.amount > limit;
    });
  }, [transactions, approvalFilter, settings]);

  async function handleDecision(id: string, decision: 'approve' | 'reject') {
    setBusy(true);
    try {
      await apiRequest(`/api/transactions/${id}/approve`, {
        method: 'POST',
        body: {
          decision,
          reason: decision === 'approve' ? 'Approved by second authorized administrator' : 'Rejected by second administrator',
        },
      });
      onRefresh();
      onNotify(
        decision === 'approve'
          ? 'Expense approved and reflected in official fund & bank balances.'
          : 'Expense rejected.',
        'success'
      );
    } catch (err: any) {
      onNotify(err.message || 'Approval action failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleCloseMonth() {
    setBusy(true);
    try {
      await apiRequest('/api/closings/close', {
        method: 'POST',
        body: { monthKey: closingMonth },
      });
      onRefresh();
      onNotify(`Month ${closingMonth} has been closed and locked. Statement published for members.`, 'success');
    } catch (err: any) {
      onNotify(err.message || 'Failed to close month', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleReopenMonth(e: React.FormEvent) {
    e.preventDefault();
    if (!reopenTarget) return;
    setBusy(true);
    try {
      await apiRequest('/api/closings/reopen', {
        method: 'POST',
        body: { monthKey: reopenTarget.monthKey, reason: reopenReason },
      });
      setReopenTarget(null);
      setReopenReason('');
      onRefresh();
      onNotify(`Month ${reopenTarget.monthKey} reopened and logged in audit trail.`, 'success');
    } catch (err: any) {
      onNotify(err.message || 'Failed to reopen month', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* SECTION 1: TWO-ADMIN APPROVAL WORKFLOW */}
      <section className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Two-Admin Approval Workflow (Threshold: {formatINR(settings?.dualApprovalLimit || 5000, numerals)})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Expenses above ₹5,000 require approval from the second administrator. Creators cannot self-approve.
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900 shrink-0">
            {(
              [
                ['pending_approval', 'Pending'],
                ['approved', 'Approved'],
                ['rejected', 'Rejected'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setApprovalFilter(k)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold min-h-[36px] whitespace-nowrap ${
                  approvalFilter === k
                    ? 'bg-white dark:bg-[#192822] text-[#0B4F32] dark:text-emerald-300 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {highValueTxns.map((tx) => {
            const isCreator = tx.createdBy === user.id;
            return (
              <div key={tx.id} className="py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-data text-xs font-bold text-slate-900 dark:text-slate-100">{tx.txnNumber}</span>
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-100">· {tx.category} — {tx.partyName}</span>
                    <span className="text-sm font-bold font-data text-rose-700 dark:text-rose-400">
                      {formatINR(tx.amount, numerals)}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Fund: {tx.fundName || tx.fundId} · Date: {tx.date} · Method: {tx.paymentMethod} · Created by:{' '}
                    <strong className="text-slate-700 dark:text-slate-300">{tx.createdByName}</strong>
                  </div>
                  {tx.description && (
                    <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">{tx.description}</div>
                  )}
                  {tx.approvedByName && (
                    <div className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
                      {tx.status === 'rejected' ? 'Rejected' : 'Approved'} by {tx.approvedByName}
                      {tx.rejectionReason ? ` — ${tx.rejectionReason}` : ''}
                    </div>
                  )}
                </div>

                {tx.status === 'pending_approval' && isAdmin && (
                  <div className="shrink-0">
                    {isCreator ? (
                      <div className="px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-800 dark:text-amber-300 inline-flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 shrink-0" />
                        <span>Self-approval blocked — Awaiting 2nd Admin</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleDecision(tx.id, 'approve')}
                          className="min-h-[42px] px-4 py-2 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>{t(lang, 'approve')}</span>
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleDecision(tx.id, 'reject')}
                          className="min-h-[42px] px-3.5 py-2 rounded-xl border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <XCircle className="w-4 h-4" />
                          <span>{t(lang, 'reject')}</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {highValueTxns.length === 0 && (
            <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No {approvalFilter.replace('_', ' ')} high-value expenses in this queue.
            </div>
          )}
        </div>
      </section>

      {/* SECTION 2: MONTHLY ACCOUNT CLOSING & LOCKING */}
      <section className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Monthly Financial Account Closing & Locking
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Lock verified monthly statements to prevent unauthorized retroactive edits. Only the Primary Administrator (ADMIN-01) can reopen a closed month with an audit reason.
            </p>
          </div>

          {isAdmin && (
            <div className="flex items-center gap-2 shrink-0">
              <input
                type="month"
                value={closingMonth}
                onChange={(e) => setClosingMonth(e.target.value)}
                className="min-h-[42px] px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
              <button
                type="button"
                disabled={busy}
                onClick={handleCloseMonth}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <CalendarCheck className="w-4 h-4" />
                <span>{t(lang, 'closeMonth')}</span>
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {closings.map((cl) => (
            <div
              key={cl.monthKey}
              className="p-4 rounded-xl bg-[#F6F8F7] dark:bg-[#0D1612] border border-slate-200 dark:border-slate-800 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {cl.isLocked ? (
                    <Lock className="w-4 h-4 text-[#0B4F32] dark:text-emerald-400" />
                  ) : (
                    <Unlock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  )}
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {formatMonthKey(cl.monthKey, lang, numerals)}
                  </h3>
                  <span
                    className={`text-xs font-semibold ${
                      cl.isLocked ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    · {cl.isLocked ? t(lang, 'locked') : t(lang, 'open')}
                  </span>
                </div>

                {cl.isLocked && isMainAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      setReopenTarget(cl);
                      setReopenReason('');
                    }}
                    className="text-xs font-semibold text-amber-700 dark:text-amber-400 hover:underline whitespace-nowrap"
                  >
                    {t(lang, 'reopenMonth')}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Income:</span>{' '}
                  <strong className="font-data text-emerald-700 dark:text-emerald-400">{formatINR(cl.totalIncome, numerals)}</strong>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Expense:</span>{' '}
                  <strong className="font-data text-rose-700 dark:text-rose-400">{formatINR(cl.totalExpense, numerals)}</strong>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Pending Dues:</span>{' '}
                  <strong className="font-data text-slate-800 dark:text-slate-200">{formatINR(cl.outstandingContributions, numerals)}</strong>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Pending Salaries:</span>{' '}
                  <strong className="font-data text-slate-800 dark:text-slate-200">{formatINR(cl.pendingSalaries, numerals)}</strong>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400">
                  Closed by {cl.closedByName || '-'}
                </span>
                <span className="font-data font-bold text-slate-900 dark:text-slate-100">
                  Closing: {formatINR(cl.closingBalance, numerals)}
                </span>
              </div>

              {cl.reopenReason && (
                <div className="text-[11px] text-amber-700 dark:text-amber-400">
                  Reopened by {cl.reopenedByName}: {cl.reopenReason}
                </div>
              )}
            </div>
          ))}
          {closings.length === 0 && (
            <div className="col-span-full py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No months have been closed yet.
            </div>
          )}
        </div>
      </section>

      {/* Reopen Month Modal (Main Admin Only) */}
      {reopenTarget && isMainAdmin && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Reopen Closed Month ({reopenTarget.monthKey})
              </h3>
              <button type="button" onClick={() => setReopenTarget(null)} className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              Special Primary Administrator (ADMIN-01) authorization required. Every reopening is permanently logged with your identity and reason.
            </p>
            <form onSubmit={handleReopenMonth} className="space-y-3">
              <textarea
                required
                minLength={5}
                rows={3}
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                placeholder="State the exact accounting correction reason..."
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setReopenTarget(null)} className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm">
                  {t(lang, 'cancel')}
                </button>
                <button type="submit" disabled={busy} className="min-h-[44px] px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold">
                  Confirm Audited Reopen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
