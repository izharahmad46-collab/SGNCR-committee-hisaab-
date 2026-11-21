import crypto from 'crypto';
import {
  db,
  addAuditLog,
  addNotification,
  computeMembers,
  getAppSettings,
  getCurrentMonthKey,
  syncContributionsDuesForAllMembers,
} from './db.ts';

export interface ScheduledReminderRunResult {
  monthKey: string;
  dayOfMonth: number;
  reminderDayConfigured: number;
  duesGenerated: number;
  remindersSent: number;
  skippedAlreadyReminded: number;
  ranBecause: string;
}

/**
 * Runs the 5th-of-month automatic dues & payment reminder engine.
 * Guarantees ZERO duplicate monthly dues and ZERO duplicate reminders for the same member & month.
 */
export function runMonthlyAutomationJob(options?: {
  forceRun?: boolean;
  simulatedDate?: Date;
  triggeredByAdminId?: string;
  triggeredByName?: string;
}): ScheduledReminderRunResult {
  const now = options?.simulatedDate || new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const dayOfMonth = now.getDate();
  const settings = getAppSettings();
  const reminderDay = settings.reminderDayOfMonth || 5;

  // Step 1: Always generate monthly dues for active members (UNIQUE(member_id, month_key) prevents duplicates)
  const { generatedCount } = syncContributionsDuesForAllMembers(monthKey);

  // Step 2: Run 5th-of-month payment reminders only on/after configured reminder day (unless explicitly forceRun)
  if (!options?.forceRun && dayOfMonth < reminderDay) {
    return {
      monthKey,
      dayOfMonth,
      reminderDayConfigured: reminderDay,
      duesGenerated: generatedCount,
      remindersSent: 0,
      skippedAlreadyReminded: 0,
      ranBecause: `Scheduled for day ${reminderDay}; today is day ${dayOfMonth}`,
    };
  }

  const members = computeMembers(false).filter((m) => m.status === 'active' && m.outstandingAmount > 0);
  const checkExisting = db.prepare(
    `SELECT 1 FROM reminder_logs WHERE target_member_id = ? AND reminder_month_key = ? LIMIT 1`
  );
  const insReminder = db.prepare(
    `INSERT INTO reminder_logs (
      id, sent_at, sent_by_name, channel, target_member_id, target_member_name, target_phone,
      reminder_month_key, pending_months_json, outstanding_amount, message, status
    ) VALUES (?, ?, ?, 'app', ?, ?, ?, ?, ?, ?, ?, 'sent')`
  );

  let remindersSent = 0;
  let skippedAlreadyReminded = 0;
  const sentAt = now.toISOString();
  const senderName = options?.triggeredByName || 'Automated 5th-of-Month Scheduler';

  const tx = db.transaction(() => {
    for (const m of members) {
      const alreadySent = checkExisting.get(m.id, monthKey);
      if (alreadySent) {
        skippedAlreadyReminded += 1;
        continue;
      }

      const message = `Assalamu Alaikum ${m.fullName} (${m.memberCode}), automatic monthly reminder (${monthKey}): Your pending Masjid & Madrasa contribution is ₹${m.outstandingAmount.toLocaleString('en-IN')} across ${m.pendingMonthsCount} month(s) [${m.pendingMonths.join(', ')}]. Please deposit via official committee UPI QR or counter.`;

      insReminder.run(
        crypto.randomUUID(),
        sentAt,
        senderName,
        m.id,
        m.fullName,
        m.phone,
        monthKey,
        JSON.stringify(m.pendingMonths),
        m.outstandingAmount,
        message
      );

      addNotification({
        type: 'monthly_due',
        title: `Monthly Payment Reminder (${monthKey}) — ₹${m.outstandingAmount.toLocaleString('en-IN')} Due`,
        message,
        targetRole: 'member',
        targetMemberId: m.id,
      });

      remindersSent += 1;
    }
  });

  tx();

  if (remindersSent > 0 || generatedCount > 0) {
    addAuditLog({
      adminId: options?.triggeredByAdminId || 'system_scheduler',
      adminName: senderName,
      action: 'SCHEDULED_MONTHLY_REMINDERS_RUN',
      entityType: 'scheduler',
      entityId: monthKey,
      afterData: {
        monthKey,
        duesGenerated: generatedCount,
        remindersSent,
        skippedAlreadyReminded,
      },
      reason: `Automated 5th-of-month dues & unpaid reminder cycle for ${monthKey}`,
    });
  }

  return {
    monthKey,
    dayOfMonth,
    reminderDayConfigured: reminderDay,
    duesGenerated: generatedCount,
    remindersSent,
    skippedAlreadyReminded,
    ranBecause: options?.forceRun ? 'Manual scheduler execution' : `Automatic run on day ${dayOfMonth} (>= ${reminderDay})`,
  };
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startMonthlyScheduler(onUpdate?: (eventType: string) => void): void {
  // Run once on server startup (safe & idempotent due to duplicate guards)
  const initial = runMonthlyAutomationJob();
  if (initial.remindersSent > 0 || initial.duesGenerated > 0) {
    onUpdate?.('reminders');
  }

  // Re-check every 6 hours while server is running
  if (schedulerInterval) clearInterval(schedulerInterval);
  schedulerInterval = setInterval(() => {
    const res = runMonthlyAutomationJob();
    if (res.remindersSent > 0 || res.duesGenerated > 0) {
      onUpdate?.('reminders');
    }
  }, 6 * 60 * 60 * 1000);
}
