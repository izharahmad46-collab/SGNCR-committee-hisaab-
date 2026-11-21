import React, { useMemo, useState } from 'react';
import {
  Crown,
  Send,
  Bell,
  MessageSquare,
  Plus,
  X,
  CheckCircle2,
  ExternalLink,
  CalendarClock,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import type {
  AppSettings,
  AuthUser,
  CommitteeMemberRecord,
  Language,
  MemberSummary,
  NotificationRecord,
  NumeralSystem,
  ReminderLogRecord,
} from '../types';
import { formatINR, formatMonthKey, t, toDisplayDigits } from '../i18n/translations';

interface CommitteeRemindersViewProps {
  user: AuthUser;
  lang: Language;
  numerals: NumeralSystem;
  mode: 'committee' | 'reminders';
  positions: CommitteeMemberRecord[];
  members: MemberSummary[];
  reminders: ReminderLogRecord[];
  notifications: NotificationRecord[];
  settings: AppSettings | null;
  onRefresh: () => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export const CommitteeRemindersView: React.FC<CommitteeRemindersViewProps> = ({
  user,
  lang,
  numerals,
  mode,
  positions,
  members,
  reminders,
  notifications,
  settings,
  onRefresh,
  onNotify,
}) => {
  const isAdmin = user.role === 'admin_main' || user.role === 'admin_secondary';

  // Change committee position modal
  const [showChangePos, setShowChangePos] = useState(false);
  const [posRole, setPosRole] = useState<'sadar' | 'secretary' | 'treasurer' | 'vice_president' | 'member'>('sadar');
  const [posName, setPosName] = useState('');
  const [posPhone, setPosPhone] = useState('+91 ');
  const [posStart, setPosStart] = useState(new Date().toISOString().slice(0, 10));
  const [posEnd, setPosEnd] = useState(`${new Date().getFullYear() + 2}-${new Date().toISOString().slice(5, 10)}`);
  const [posReason, setPosReason] = useState('');

  // Announcement form
  const [annTitle, setAnnTitle] = useState('');
  const [annMsg, setAnnMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const activePositions = useMemo(() => positions.filter((p) => p.isActive), [positions]);
  const pastPositions = useMemo(() => positions.filter((p) => !p.isActive), [positions]);
  const unpaidMembers = useMemo(
    () => members.filter((m) => m.status === 'active' && m.outstandingAmount > 0),
    [members]
  );

  function designationLabel(p: CommitteeMemberRecord): string {
    return lang === 'hi' ? p.designationHi : lang === 'ur' ? p.designationUr : p.designationEn;
  }

  async function handleSavePosition(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiRequest('/api/committee', {
        method: 'POST',
        body: {
          roleKey: posRole,
          fullName: posName,
          phone: posPhone,
          appointmentDate: posStart,
          termStart: posStart,
          termEnd: posEnd,
          reason: posReason,
        },
      });
      setShowChangePos(false);
      setPosName('');
      setPosReason('');
      onRefresh();
      onNotify('Committee office holder updated and logged permanently in history.', 'success');
    } catch (err: any) {
      onNotify(err.message || 'Failed to update committee position', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleSendReminder(memberId?: string, channel: 'app' | 'whatsapp' | 'sms' = 'app') {
    setBusy(true);
    try {
      const res = await apiRequest<{ count: number }>('/api/reminders/send', {
        method: 'POST',
        body: { memberId, channel },
      });
      onRefresh();
      onNotify(`Sent ${channel.toUpperCase()} reminder to ${res.count} unpaid member(s).`, 'success');
    } catch (err: any) {
      onNotify(err.message || 'Failed to send reminder', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleRunScheduledJob() {
    setBusy(true);
    try {
      const res = await apiRequest<{
        ok: boolean;
        result: {
          monthKey: string;
          duesGenerated: number;
          remindersSent: number;
          skippedAlreadyReminded: number;
        };
      }>('/api/scheduler/run-reminders', {
        method: 'POST',
        body: {},
      });
      onRefresh();
      const r = res.result;
      onNotify(
        `5th-of-Month Job (${r.monthKey}): ${r.duesGenerated} dues synced · ${r.remindersSent} reminder(s) sent · ${r.skippedAlreadyReminded} duplicate(s) skipped.`,
        'success'
      );
    } catch (err: any) {
      onNotify(err.message || 'Failed to run scheduled reminder job', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handlePostAnnouncement(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiRequest('/api/notifications/announce', {
        method: 'POST',
        body: { title: annTitle, message: annMsg },
      });
      setAnnTitle('');
      setAnnMsg('');
      onRefresh();
      onNotify('Committee announcement published to all members.', 'success');
    } catch (err: any) {
      onNotify(err.message || 'Failed to post announcement', 'error');
    } finally {
      setBusy(false);
    }
  }

  function buildWhatsAppLink(m: MemberSummary): string {
    const cleanPhone = m.phone.replace(/[^\d]/g, '');
    const text = `Assalamu Alaikum ${m.fullName} (${m.memberCode}), your S.G.N Committee Noori Jama Masjid & Madarsa Anwarool Uloom contribution of Rs.${m.outstandingAmount} is pending for ${m.pendingMonthsCount} month(s): ${m.pendingMonths.join(', ')}. Kindly deposit via official UPI QR or committee counter.`;
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
  }

  if (mode === 'committee') {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Current Committee Office Holders
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Official Sadar (President), Secretary, Treasurer, Vice President, and Executive Committee Members.
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowChangePos(true)}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Change Sadar / Office Holder</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {activePositions.map((p) => (
            <div
              key={p.id}
              className="p-5 rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-[#0B4F32] dark:text-emerald-400">
                    {designationLabel(p)}
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5">{p.fullName}</h3>
                </div>
                <Crown className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
              </div>

              <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div>Contact: <span className="font-data text-slate-800 dark:text-slate-200">{p.phone || '-'}</span></div>
                <div>Appointed: {p.appointmentDate}</div>
                <div>Term: {p.termStart} to {p.termEnd}</div>
                <div className="text-emerald-700 dark:text-emerald-400 font-semibold pt-1">Active Office Holder</div>
              </div>
            </div>
          ))}
        </div>

        {/* Previous Office Holders Archive */}
        <section className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3">
            Previous Office Holders & Historical Record
          </h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {pastPositions.map((p) => (
              <div key={p.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div>
                  <strong className="text-slate-900 dark:text-slate-100 text-sm">{p.fullName}</strong>
                  <span className="text-slate-500 dark:text-slate-400"> · {designationLabel(p)}</span>
                </div>
                <div className="text-slate-500 dark:text-slate-400">
                  Term: {p.termStart} to {p.termEnd} · Updated by {p.updatedByName}
                </div>
              </div>
            ))}
            {pastPositions.length === 0 && (
              <div className="py-6 text-center text-xs text-slate-500">No archived office holders yet.</div>
            )}
          </div>
        </section>

        {/* Change Office Holder Modal */}
        {showChangePos && isAdmin && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Update Committee Position</h3>
                <button type="button" onClick={() => setShowChangePos(false)} className="p-1 text-slate-400">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleSavePosition} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Position *</label>
                  <select
                    value={posRole}
                    onChange={(e) => setPosRole(e.target.value as any)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  >
                    <option value="sadar">Sadar (President)</option>
                    <option value="secretary">Secretary</option>
                    <option value="treasurer">Treasurer (Khazanchi)</option>
                    <option value="vice_president">Vice President (Naib Sadar)</option>
                    <option value="member">Executive Committee Member</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Full Name *</label>
                  <input required value={posName} onChange={(e) => setPosName(e.target.value)} className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Mobile Number</label>
                  <input value={posPhone} onChange={(e) => setPosPhone(e.target.value)} className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Term Start</label>
                    <input type="date" value={posStart} onChange={(e) => setPosStart(e.target.value)} className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Term End</label>
                    <input type="date" value={posEnd} onChange={(e) => setPosEnd(e.target.value)} className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Resolution / Reason *</label>
                  <input required value={posReason} onChange={(e) => setPosReason(e.target.value)} placeholder="e.g. Elected in General Body Meeting" className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setShowChangePos(false)} className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm">
                    {t(lang, 'cancel')}
                  </button>
                  <button type="submit" disabled={busy} className="min-h-[44px] px-5 py-2 rounded-xl bg-[#0B4F32] text-white text-sm font-semibold">
                    Save & Log Change
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // REMINDERS & NOTIFICATIONS MODE
  return (
    <div className="space-y-6">
      {/* Unpaid Members Reminder Control */}
      <section className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Automatic Payment Reminders ({toDisplayDigits(unpaidMembers.length, numerals)} Unpaid Members)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Scheduled on Day {toDisplayDigits(settings?.reminderDayOfMonth || 5, numerals)} of every month ({settings?.reminderFrequency || 'monthly'}). Reminders automatically stop as soon as payment is recorded.
            </p>
          </div>
          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={busy}
                onClick={handleRunScheduledJob}
                className="min-h-[44px] px-3.5 py-2 rounded-xl border border-[#0B4F32] text-[#0B4F32] dark:text-emerald-300 dark:border-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <CalendarClock className="w-4 h-4" />
                <span>Run 5th-of-Month Job</span>
              </button>
              {unpaidMembers.length > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleSendReminder(undefined, 'app')}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap"
                >
                  <Send className="w-4 h-4" />
                  <span>Send Bulk App Reminder ({toDisplayDigits(unpaidMembers.length, numerals)})</span>
                </button>
              )}
            </div>
          )}
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {unpaidMembers.map((m) => (
            <div key={m.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {m.fullName} ({m.memberCode}) ·{' '}
                  <span className="font-data text-rose-700 dark:text-rose-400">
                    {formatINR(m.outstandingAmount, numerals)}
                  </span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Pending {toDisplayDigits(m.pendingMonthsCount, numerals)} month(s):{' '}
                  {m.pendingMonths.map((mk) => formatMonthKey(mk, lang, numerals)).join(', ')}
                </div>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleSendReminder(m.id, 'app')}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                  >
                    App Alert
                  </button>
                  <a
                    href={buildWhatsAppLink(m)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => handleSendReminder(m.id, 'whatsapp')}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap"
                  >
                    <span>WhatsApp</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
          ))}
          {unpaidMembers.length === 0 && (
            <div className="py-6 text-center text-sm text-emerald-700 dark:text-emerald-400 inline-flex items-center justify-center gap-2 w-full">
              <CheckCircle2 className="w-4 h-4" />
              <span>All active committee members are up to date!</span>
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Notifications & Admin Announcements */}
        <section className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-[#0B4F32] dark:text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Committee Notifications & Announcements
            </h3>
          </div>

          {isAdmin && (
            <form onSubmit={handlePostAnnouncement} className="p-3.5 rounded-xl bg-[#F6F8F7] dark:bg-[#0D1612] border border-slate-200 dark:border-slate-800 space-y-2.5">
              <input
                required
                value={annTitle}
                onChange={(e) => setAnnTitle(e.target.value)}
                placeholder="Announcement headline (e.g. Monthly Committee Meeting)"
                className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
              />
              <textarea
                required
                rows={2}
                value={annMsg}
                onChange={(e) => setAnnMsg(e.target.value)}
                placeholder="Message to broadcast to all members..."
                className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
              />
              <button
                type="submit"
                disabled={busy}
                className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-[#0B4F32] text-white text-xs font-semibold"
              >
                Publish Announcement
              </button>
            </form>
          )}

          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-96 overflow-y-auto">
            {notifications.map((n) => (
              <div key={n.id} className="py-3">
                <div className="text-xs font-bold text-slate-900 dark:text-slate-100">{n.title}</div>
                <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">{n.message}</div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {new Date(n.createdAt).toLocaleString('en-IN')} · {n.type.replace('_', ' ')}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Reminder History Log */}
        <section className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-[#0B4F32] dark:text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Reminder History</h3>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[28rem] overflow-y-auto">
            {reminders.map((r) => (
              <div key={r.id} className="py-3">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <strong className="text-slate-900 dark:text-slate-100">{r.targetMemberName}</strong>
                  <span
                    className={`font-semibold ${
                      r.status === 'stopped_paid'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {r.status === 'stopped_paid' ? 'Stopped (Paid)' : `Sent (${r.channel.toUpperCase()})`}
                  </span>
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">{r.message}</div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {new Date(r.sentAt).toLocaleString('en-IN')} · By {r.sentByName} · Due: {formatINR(r.outstandingAmount, numerals)}
                </div>
              </div>
            ))}
            {reminders.length === 0 && (
              <div className="py-8 text-center text-xs text-slate-500">No reminders sent yet.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
