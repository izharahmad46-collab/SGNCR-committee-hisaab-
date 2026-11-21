import type { User as FirebaseUser } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  PRIMARY_ADMIN_EMAIL,
} from '../firebase';
import type {
  AppSettings,
  AuditLogRecord,
  BankAccountRecord,
  CommitteeMemberRecord,
  FundSummary,
  MemberSummary,
  MonthlyClosingRecord,
  NotificationRecord,
  PaymentSubmissionRecord,
  StaffSummary,
  TransactionRecord,
} from '../types';

export interface CloudSyncPayload {
  settings: AppSettings | null;
  funds: FundSummary[];
  members: MemberSummary[];
  transactions: TransactionRecord[];
  staff: StaffSummary[];
  bankAccounts: BankAccountRecord[];
  submissions: PaymentSubmissionRecord[];
  positions: CommitteeMemberRecord[];
  closings: MonthlyClosingRecord[];
  notifications: NotificationRecord[];
  auditLogs: AuditLogRecord[];
}

export interface CloudStatusSnapshot {
  connected: boolean;
  email: string | null;
  isFirebaseAdmin: boolean;
  fundsCount: number;
  membersCount: number;
  transactionsCount: number;
  auditLogsCount: number;
  lastSyncedAt: string | null;
}

function sanitizeId(raw: string): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120);
  return cleaned || `doc_${Date.now()}`;
}

function clip(val: unknown, maxLen: number): string {
  return String(val ?? '').trim().slice(0, maxLen);
}

function maskPhone(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 4) return '******';
  return `******${digits.slice(-4)}`;
}

function isPrimaryFirebaseAdmin(fbUser: FirebaseUser | null): boolean {
  return Boolean(
    fbUser &&
      fbUser.emailVerified &&
      fbUser.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase()
  );
}

export async function isFirebaseAdminUser(fbUser: FirebaseUser | null): Promise<boolean> {
  if (!fbUser || !fbUser.emailVerified) return false;
  if (isPrimaryFirebaseAdmin(fbUser)) return true;
  const path = `admins/${fbUser.uid}`;
  try {
    const snap = await getDoc(doc(db, 'admins', fbUser.uid));
    if (!snap.exists()) return false;
    const role = snap.data()?.role;
    return role === 'admin_main' || role === 'admin_secondary';
  } catch (error) {
    // Non-admins may not have an admins doc; only escalate unexpected failures
    const msg = error instanceof Error ? error.message.toLowerCase() : '';
    if (msg.includes('permission')) return false;
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function ensureFirebaseUserProfile(
  fbUser: FirebaseUser,
  memberCode?: string
): Promise<{ role: 'admin_main' | 'admin_secondary' | 'member' }> {
  const uid = sanitizeId(fbUser.uid);
  const userPath = `users/${uid}`;
  const isPrimary = isPrimaryFirebaseAdmin(fbUser);

  let existingSnap;
  try {
    existingSnap = await getDoc(doc(db, 'users', uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  if (!existingSnap.exists()) {
    const role: 'admin_main' | 'member' = isPrimary ? 'admin_main' : 'member';
    const payload: Record<string, unknown> = {
      uid,
      email: clip(fbUser.email || `${uid}@committee.local`, 254),
      displayName: clip(fbUser.displayName || fbUser.email?.split('@')[0] || 'Committee User', 120),
      role,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (memberCode) {
      payload.memberCode = clip(memberCode, 32);
    }
    try {
      await setDoc(doc(db, 'users', uid), payload);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, userPath);
    }

    if (isPrimary) {
      const adminPath = `admins/${uid}`;
      try {
        const adminSnap = await getDoc(doc(db, 'admins', uid));
        if (!adminSnap.exists()) {
          await setDoc(doc(db, 'admins', uid), {
            uid,
            email: clip(fbUser.email || PRIMARY_ADMIN_EMAIL, 254),
            fullName: clip(fbUser.displayName || 'Primary Administrator', 120),
            role: 'admin_main',
            slot: 1,
            assignedByUid: uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, adminPath);
      }
    }
    return { role };
  }

  const data = existingSnap.data();
  const storedRole = data?.role;
  if (storedRole === 'admin_main' || storedRole === 'admin_secondary') {
    return { role: storedRole };
  }
  return { role: isPrimary ? 'admin_main' : 'member' };
}

export async function syncCommitteeLedgerToFirestore(
  payload: CloudSyncPayload,
  fbUser: FirebaseUser
): Promise<{ syncedCollections: number; syncedDocuments: number }> {
  const allowed = await isFirebaseAdminUser(fbUser);
  if (!allowed) {
    throw new Error('Only authorized Firebase Administrators can push records to Cloud Firestore.');
  }

  let syncedDocuments = 0;

  // Helper to commit batches safely under 450 operations per batch
  let batch = writeBatch(db);
  let opsInBatch = 0;

  async function commitCurrentBatch(pathLabel: string) {
    if (opsInBatch === 0) return;
    try {
      await batch.commit();
      syncedDocuments += opsInBatch;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, pathLabel);
    }
    batch = writeBatch(db);
    opsInBatch = 0;
  }

  async function queueSet(colName: string, docId: string, data: Record<string, unknown>) {
    batch.set(doc(db, colName, docId), data);
    opsInBatch += 1;
    if (opsInBatch >= 400) {
      await commitCurrentBatch(colName);
    }
  }

  // 1. App Settings
  if (payload.settings) {
    const s = payload.settings;
    const settingsDoc: Record<string, unknown> = {
      committeeName: clip(s.committeeName || 'S.G.N Committee Noori Jama Masjid & Madarsa Anwarool Uloom', 200),
      committeeAddress: clip(
        s.committeeAddress || 'At Ragdih, PO Chalkusha, District Hazaribagh, Jharkhand - 825109, India',
        300
      ),
      defaultLanguage: s.defaultLanguage === 'hi' || s.defaultLanguage === 'ur' ? s.defaultLanguage : 'en',
      memberLoginEnabled: s.memberLoginEnabled !== false,
      autoBackupEnabled: s.autoBackupEnabled !== false,
      dualApprovalEnabled: Boolean(s.dualApprovalEnabled),
      dualApprovalLimit: Math.max(500, Math.min(10000000, Number(s.dualApprovalLimit || 5000))),
      reminderDayOfMonth: Math.max(1, Math.min(28, Math.round(Number(s.reminderDayOfMonth || 5)))),
      reminderFrequency:
        s.reminderFrequency === 'weekly' || s.reminderFrequency === 'biweekly' ? s.reminderFrequency : 'monthly',
      defaultMonthlyContribution: Math.max(10, Math.min(100000, Number(s.defaultMonthlyContribution || 500))),
      hideMemberPhonesForMembers: Boolean(s.hideMemberPhonesForMembers),
      isDemoDataActive: Boolean(s.isDemoDataActive),
      lastSyncedBy: clip(fbUser.email || fbUser.uid, 128),
      updatedAt: serverTimestamp(),
    };
    if (s.appLogoUrl && s.appLogoUrl.length <= 500 && !s.appLogoUrl.startsWith('data:')) {
      settingsDoc.appLogoUrl = clip(s.appLogoUrl, 500);
    }
    await queueSet('app_settings', 'default', settingsDoc);
  }

  // 2. Virtual Funds (all 10 existing + any custom ledgers)
  for (const f of payload.funds) {
    const id = sanitizeId(f.id);
    await queueSet('funds', id, {
      id,
      code: clip(f.code, 32),
      nameEn: clip(f.nameEn, 120),
      nameHi: clip(f.nameHi, 120),
      nameUr: clip(f.nameUr, 120),
      scope: ['masjid', 'madrasa', 'restricted', 'general'].includes(f.scope) ? f.scope : 'general',
      isRestricted: Boolean(f.isRestricted),
      restrictedRule: clip(f.restrictedRule, 300),
      description: clip(f.description || '', 400),
      isActive: f.isActive !== false,
      openingBalance: Number(f.openingBalance || 0),
      totalIncome: Math.max(0, Number(f.totalIncome || 0)),
      totalExpense: Math.max(0, Number(f.totalExpense || 0)),
      transfersIn: Math.max(0, Number(f.transfersIn || 0)),
      transfersOut: Math.max(0, Number(f.transfersOut || 0)),
      currentBalance: Number(f.currentBalance || 0),
      updatedAt: serverTimestamp(),
    });
  }

  // 3. Committee Members (masked phones only for PII protection) + Monthly Contributions
  for (const m of payload.members) {
    const id = sanitizeId(m.id);
    const joiningDate = clip(m.joiningDate, 10).length === 10 ? clip(m.joiningDate, 10) : '2025-01-01';
    const memberDoc: Record<string, unknown> = {
      id,
      memberCode: clip(m.memberCode, 32),
      fullName: clip(m.fullName, 120),
      phoneMasked: maskPhone(m.phone),
      village: clip(m.village, 160),
      monthlyAmount: Math.max(1, Math.min(1000000, Number(m.monthlyAmount || 500))),
      joiningDate,
      status: m.status === 'inactive' ? 'inactive' : 'active',
      totalExpected: Math.max(0, Number(m.totalExpected || 0)),
      totalPaid: Math.max(0, Number(m.totalPaid || 0)),
      outstandingAmount: Math.max(0, Number(m.outstandingAmount || 0)),
      pendingMonthsCount: Math.max(0, Math.min(600, Math.round(Number(m.pendingMonthsCount || 0)))),
      isDemo: Boolean(m.isDemo),
      updatedAt: serverTimestamp(),
    };
    if (m.pendingSince) {
      memberDoc.pendingSince = clip(m.pendingSince, 16);
    }
    await queueSet('members', id, memberDoc);

    // Sync recent 12 months of contributions per member
    for (const mh of (m.monthHistory || []).slice(-12)) {
      if (!/^[0-9]{4}-[0-9]{2}$/.test(mh.monthKey)) continue;
      const cid = sanitizeId(`${id}_${mh.monthKey}`);
      const cStatus =
        mh.dueStatus && ['paid', 'partial', 'unpaid', 'overdue'].includes(mh.dueStatus)
          ? mh.dueStatus
          : mh.status;
      const cDoc: Record<string, unknown> = {
        id: cid,
        memberId: id,
        memberCode: clip(m.memberCode, 32),
        memberName: clip(m.fullName, 120),
        monthKey: mh.monthKey,
        expectedAmount: Math.max(1, Math.min(1000000, Number(mh.expected || m.monthlyAmount || 500))),
        paidAmount: Math.max(0, Math.min(1000000, Number(mh.paid || 0))),
        remainingAmount: Math.max(0, Math.min(1000000, Number(mh.remaining || 0))),
        status: ['paid', 'partial', 'unpaid', 'overdue'].includes(cStatus) ? cStatus : 'unpaid',
        updatedAt: serverTimestamp(),
      };
      if (mh.paidDate) cDoc.paidDate = clip(mh.paidDate, 32);
      if (mh.txnNumber) cDoc.txnNumber = clip(mh.txnNumber, 48);
      await queueSet('contributions', cid, cDoc);
    }
  }

  // 4. Bank Accounts
  for (const b of payload.bankAccounts) {
    const id = sanitizeId(b.id);
    const bDoc: Record<string, unknown> = {
      id,
      bankName: clip(b.bankName, 120),
      accountName: clip(b.accountName, 160),
      accountNumber: clip(b.accountNumber, 40).padEnd(4, '0'),
      ifsc: clip(b.ifsc, 20).padEnd(4, '0'),
      branch: clip(b.branch, 120),
      upiId: clip(b.upiId, 120),
      fundScope: clip(b.fundScope, 120),
      openingBalance: Number(b.openingBalance || 0),
      currentBalance: Number(b.currentBalance || 0),
      instructions: clip(b.instructions, 500),
      isActive: Boolean(b.isActive),
      isDemo: Boolean(b.isDemo),
      updatedAt: serverTimestamp(),
    };
    if (b.qrCodeUrl && b.qrCodeUrl.length <= 500 && !b.qrCodeUrl.startsWith('data:')) {
      bDoc.qrCodeUrl = clip(b.qrCodeUrl, 500);
    }
    await queueSet('bank_accounts', id, bDoc);
  }

  // 5. Staff Salaries
  for (const st of payload.staff) {
    const id = sanitizeId(st.id);
    const jDate = clip(st.joiningDate, 10).length === 10 ? clip(st.joiningDate, 10) : '2025-01-01';
    await queueSet('salaries', id, {
      id,
      name: clip(st.name, 120),
      designation: clip(st.designation, 100),
      institution: st.institution === 'madrasa' ? 'madrasa' : 'masjid',
      fundId: sanitizeId(st.fundId),
      monthlySalary: Math.max(1, Math.min(1000000, Number(st.monthlySalary || 1000))),
      joiningDate: jDate,
      status: st.status === 'inactive' ? 'inactive' : 'active',
      totalPayable: Math.max(0, Number(st.totalPayable || 0)),
      totalPaid: Math.max(0, Number(st.totalPaid || 0)),
      totalPending: Math.max(0, Number(st.totalPending || 0)),
      maxPendingDays: Math.max(0, Math.round(Number(st.maxPendingDays || 0))),
      isDemo: Boolean(st.isDemo),
      updatedAt: serverTimestamp(),
    });
  }

  // 6. Committee Positions
  for (const pos of payload.positions) {
    const id = sanitizeId(pos.id);
    await queueSet('committee_members', id, {
      id,
      roleKey: ['sadar', 'secretary', 'treasurer', 'vice_president', 'member'].includes(pos.roleKey)
        ? pos.roleKey
        : 'member',
      designationEn: clip(pos.designationEn, 120),
      designationHi: clip(pos.designationHi, 120),
      designationUr: clip(pos.designationUr, 120),
      fullName: clip(pos.fullName, 120),
      appointmentDate: clip(pos.appointmentDate, 32),
      termStart: clip(pos.termStart, 32),
      termEnd: clip(pos.termEnd, 32),
      isActive: Boolean(pos.isActive),
      updatedByName: clip(pos.updatedByName, 120),
      isDemo: Boolean(pos.isDemo),
      updatedAt: serverTimestamp(),
    });
  }

  await commitCurrentBatch('core_ledgers');

  // 7. Monthly Closings (respecting locked-month rules)
  for (const cl of payload.closings) {
    if (!/^[0-9]{4}-[0-9]{2}$/.test(cl.monthKey)) continue;
    const ref = doc(db, 'monthly_closings', cl.monthKey);
    const path = `monthly_closings/${cl.monthKey}`;
    try {
      const snap = await getDoc(ref);
      if (snap.exists() && snap.data()?.isLocked === true && cl.isLocked === true) {
        continue;
      }
      const clDoc: Record<string, unknown> = {
        monthKey: cl.monthKey,
        isLocked: Boolean(cl.isLocked),
        totalIncome: Math.max(0, Number(cl.totalIncome || 0)),
        totalExpense: Math.max(0, Number(cl.totalExpense || 0)),
        outstandingContributions: Math.max(0, Number(cl.outstandingContributions || 0)),
        pendingSalaries: Math.max(0, Number(cl.pendingSalaries || 0)),
        closingBalance: Number(cl.closingBalance || 0),
        updatedAt: serverTimestamp(),
      };
      if (cl.closedByName) clDoc.closedByName = clip(cl.closedByName, 120);
      if (cl.reopenReason && cl.reopenReason.trim().length >= 5) {
        clDoc.reopenReason = clip(cl.reopenReason, 400);
      }
      await setDoc(ref, clDoc);
      syncedDocuments += 1;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  // 8. Transactions (preserve create-only createdAt and update only status transitions)
  for (const txn of payload.transactions.slice(0, 120)) {
    const id = sanitizeId(txn.id);
    const ref = doc(db, 'transactions', id);
    const path = `transactions/${id}`;
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        const tDate = clip(txn.date, 10).length === 10 ? clip(txn.date, 10) : '2026-01-01';
        const mKey = /^[0-9]{4}-[0-9]{2}$/.test(txn.monthKey) ? txn.monthKey : tDate.slice(0, 7);
        const tDoc: Record<string, unknown> = {
          id,
          txnNumber: clip(txn.txnNumber, 48),
          date: tDate,
          monthKey: mKey,
          type: ['income', 'expense', 'transfer', 'reversal'].includes(txn.type) ? txn.type : 'income',
          category: clip(txn.category || 'General', 80),
          fundId: sanitizeId(txn.fundId),
          paymentMethod: ['Cash', 'UPI', 'Bank'].includes(txn.paymentMethod) ? txn.paymentMethod : 'Cash',
          amount: Math.max(0.01, Math.min(100000000, Number(txn.amount || 1))),
          partyName: clip(txn.partyName || 'Committee Member', 160),
          description: clip(txn.description, 500),
          status: ['approved', 'pending_approval', 'rejected', 'reversed'].includes(txn.status)
            ? txn.status
            : 'approved',
          createdBy: clip(txn.createdBy || fbUser.uid, 128),
          createdByName: clip(txn.createdByName || 'Administrator', 120),
          isDemo: Boolean(txn.isDemo),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (txn.targetFundId) tDoc.targetFundId = sanitizeId(txn.targetFundId);
        if (txn.bankAccountId) tDoc.bankAccountId = sanitizeId(txn.bankAccountId);
        if (txn.approvedBy) tDoc.approvedBy = clip(txn.approvedBy, 128);
        if (txn.approvedByName) tDoc.approvedByName = clip(txn.approvedByName, 120);
        await setDoc(ref, tDoc);
        syncedDocuments += 1;

        // Mirror pending >₹5,000 expense into /approvals collection
        if (txn.status === 'pending_approval') {
          const appRef = doc(db, 'approvals', id);
          const appSnap = await getDoc(appRef);
          if (!appSnap.exists()) {
            await setDoc(appRef, {
              id,
              txnId: id,
              txnNumber: clip(txn.txnNumber, 48),
              amount: Math.max(0.01, Math.min(100000000, Number(txn.amount || 1))),
              fundId: sanitizeId(txn.fundId),
              partyName: clip(txn.partyName || 'Vendor', 160),
              status: 'pending',
              createdByUid: fbUser.uid,
              createdByName: clip(txn.createdByName || fbUser.displayName || 'Administrator', 120),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            syncedDocuments += 1;
          }
        }
      } else {
        const curStatus = snap.data()?.status;
        if (
          curStatus !== txn.status &&
          (curStatus === 'pending_approval' || curStatus === 'approved') &&
          ['approved', 'rejected', 'reversed'].includes(txn.status)
        ) {
          const upd: Record<string, unknown> = {
            status: txn.status,
            updatedAt: serverTimestamp(),
          };
          if (txn.approvedBy) upd.approvedBy = clip(txn.approvedBy, 128);
          if (txn.approvedByName) upd.approvedByName = clip(txn.approvedByName, 120);
          await updateDoc(ref, upd);
          syncedDocuments += 1;
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  // 9. Payment Submissions (never upload large base64 screenshots to Firestore; store URL reference + UTR)
  for (const sub of payload.submissions.slice(0, 60)) {
    const id = sanitizeId(sub.id);
    const ref = doc(db, 'payment_submissions', id);
    const path = `payment_submissions/${id}`;
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        const subDoc: Record<string, unknown> = {
          id,
          memberId: sanitizeId(sub.memberId),
          memberCode: clip(sub.memberCode || 'DONOR', 32),
          memberName: clip(sub.memberName || 'Committee Member', 120),
          submittedByUid: fbUser.uid,
          paymentCategory: sub.paymentCategory === 'donation' ? 'donation' : 'monthly_contribution',
          amount: Math.max(1, Math.min(10000000, Number(sub.amount || 1))),
          fundId: sanitizeId(sub.fundId),
          utrReference: clip(sub.utrReference || 'UTR000', 80).padEnd(6, '0'),
          notes: clip(sub.notes, 400),
          status: ['pending_verification', 'verified', 'rejected'].includes(sub.status)
            ? sub.status
            : 'pending_verification',
          bankVerifiedConfirmed: Boolean(sub.bankVerifiedConfirmed),
          isDemo: Boolean(sub.isDemo),
          submittedAt: clip(sub.submittedAt || new Date().toISOString(), 40),
          updatedAt: serverTimestamp(),
        };
        if (sub.screenshotUrl && sub.screenshotUrl.length <= 500 && !sub.screenshotUrl.startsWith('data:')) {
          subDoc.screenshotUrl = clip(sub.screenshotUrl, 500);
        }
        if (sub.verifiedByName) subDoc.verifiedByName = clip(sub.verifiedByName, 120);
        if (sub.rejectionNote) subDoc.rejectionNote = clip(sub.rejectionNote, 400);
        if (sub.linkedTxnNumber) subDoc.linkedTxnNumber = clip(sub.linkedTxnNumber, 48);
        if (sub.receiptNumber) subDoc.receiptNumber = clip(sub.receiptNumber, 48);
        await setDoc(ref, subDoc);
        syncedDocuments += 1;
      } else if (
        snap.data()?.status === 'pending_verification' &&
        (sub.status === 'verified' || sub.status === 'rejected')
      ) {
        const upd: Record<string, unknown> = {
          status: sub.status,
          bankVerifiedConfirmed: Boolean(sub.bankVerifiedConfirmed),
          updatedAt: serverTimestamp(),
        };
        if (sub.verifiedByName) upd.verifiedByName = clip(sub.verifiedByName, 120);
        if (sub.rejectionNote) upd.rejectionNote = clip(sub.rejectionNote, 400);
        if (sub.linkedTxnNumber) upd.linkedTxnNumber = clip(sub.linkedTxnNumber, 48);
        if (sub.receiptNumber) upd.receiptNumber = clip(sub.receiptNumber, 48);
        await updateDoc(ref, upd);
        syncedDocuments += 1;
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  // 10. Notifications (append new notifications only)
  for (const n of payload.notifications.slice(0, 60)) {
    const id = sanitizeId(n.id);
    const ref = doc(db, 'notifications', id);
    const path = `notifications/${id}`;
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        const nDoc: Record<string, unknown> = {
          id,
          type: clip(n.type || 'announcement', 60),
          title: clip(n.title || 'Notice', 160),
          message: clip(n.message || 'Committee update', 1000),
          targetRole: ['all', 'admin', 'member'].includes(n.targetRole) ? n.targetRole : 'all',
          isRead: Boolean(n.isRead),
          createdAt: serverTimestamp(),
        };
        if (n.targetMemberId) nDoc.targetMemberId = sanitizeId(n.targetMemberId);
        await setDoc(ref, nDoc);
        syncedDocuments += 1;
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }

  // 11. Immutable Audit Logs (strictly append-only; NEVER update existing logs)
  for (const log of payload.auditLogs.slice(0, 80)) {
    const id = sanitizeId(log.id);
    const ref = doc(db, 'audit_logs', id);
    const path = `audit_logs/${id}`;
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        const lDoc: Record<string, unknown> = {
          id,
          timestamp: clip(log.timestamp || new Date().toISOString(), 40),
          adminId: clip(log.adminId || fbUser.uid, 128),
          adminName: clip(log.adminName || 'Administrator', 120),
          action: clip(log.action || 'RECORD_EVENT', 80),
          entityType: clip(log.entityType || 'system', 80),
          entityId: clip(log.entityId || id, 120),
          createdAt: serverTimestamp(),
        };
        if (log.beforeData) lDoc.beforeData = clip(log.beforeData, 4000);
        if (log.afterData) lDoc.afterData = clip(log.afterData, 4000);
        if (log.reason) lDoc.reason = clip(log.reason, 500);
        await setDoc(ref, lDoc);
        syncedDocuments += 1;
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }

  return { syncedCollections: 13, syncedDocuments };
}

export async function fetchCloudStatus(fbUser: FirebaseUser | null): Promise<CloudStatusSnapshot> {
  if (!fbUser || !fbUser.emailVerified) {
    return {
      connected: false,
      email: null,
      isFirebaseAdmin: false,
      fundsCount: 0,
      membersCount: 0,
      transactionsCount: 0,
      auditLogsCount: 0,
      lastSyncedAt: null,
    };
  }

  const isAdmin = await isFirebaseAdminUser(fbUser);

  try {
    const [fundsSnap, membersSnap, txnsSnap, auditSnap, settingsSnap] = await Promise.all([
      getDocs(collection(db, 'funds')),
      getDocs(collection(db, 'members')),
      getDocs(collection(db, 'transactions')),
      getDocs(collection(db, 'audit_logs')),
      getDoc(doc(db, 'app_settings', 'default')),
    ]);

    const updatedAt = settingsSnap.exists() ? settingsSnap.data()?.updatedAt : null;
    const lastSyncedAt =
      updatedAt && typeof updatedAt.toDate === 'function' ? updatedAt.toDate().toISOString() : null;

    return {
      connected: true,
      email: fbUser.email,
      isFirebaseAdmin: isAdmin,
      fundsCount: fundsSnap.size,
      membersCount: membersSnap.size,
      transactionsCount: txnsSnap.size,
      auditLogsCount: auditSnap.size,
      lastSyncedAt,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'funds,members,transactions,audit_logs');
  }
}

export function subscribeToFirestoreUpdates(onChange: () => void): Unsubscribe {
  if (!auth.currentUser || !auth.currentUser.emailVerified) {
    return () => {};
  }

  let initialSkipped = false;
  return onSnapshot(
    doc(db, 'app_settings', 'default'),
    () => {
      if (!initialSkipped) {
        initialSkipped = true;
        return;
      }
      onChange();
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, 'app_settings/default');
    }
  );
}

export async function syncPaymentSubmissionToFirestore(sub: {
  id: string;
  memberId: string;
  memberCode: string;
  memberName: string;
  paymentCategory: 'monthly_contribution' | 'donation';
  amount: number;
  fundId: string;
  utrReference: string;
  screenshotUrl?: string;
  notes?: string;
  status: 'pending_verification' | 'verified' | 'rejected';
  verifiedByName?: string | null;
  rejectionNote?: string | null;
  linkedTxnNumber?: string | null;
  receiptNumber?: string | null;
  bankVerifiedConfirmed?: boolean;
  submittedAt: string;
}): Promise<boolean> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return false;

  const id = sanitizeId(sub.id);
  const path = `payment_submissions/${id}`;
  const ref = doc(db, 'payment_submissions', id);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const payload: Record<string, unknown> = {
        id,
        memberId: sanitizeId(sub.memberId),
        memberCode: clip(sub.memberCode || 'DONOR', 32),
        memberName: clip(sub.memberName || 'Committee Member', 120),
        submittedByUid: fbUser.uid,
        paymentCategory: sub.paymentCategory === 'donation' ? 'donation' : 'monthly_contribution',
        amount: Math.max(1, Math.min(10000000, Number(sub.amount || 1))),
        fundId: sanitizeId(sub.fundId),
        utrReference: clip(sub.utrReference || 'UTR000', 80).padEnd(6, '0'),
        notes: clip(sub.notes || '', 400),
        status: sub.status,
        bankVerifiedConfirmed: Boolean(sub.bankVerifiedConfirmed),
        isDemo: false,
        submittedAt: clip(sub.submittedAt || new Date().toISOString(), 40),
        updatedAt: serverTimestamp(),
      };
      if (sub.screenshotUrl && sub.screenshotUrl.length <= 500 && !sub.screenshotUrl.startsWith('data:')) {
        payload.screenshotUrl = clip(sub.screenshotUrl, 500);
      }
      if (sub.verifiedByName) payload.verifiedByName = clip(sub.verifiedByName, 120);
      if (sub.rejectionNote) payload.rejectionNote = clip(sub.rejectionNote, 400);
      if (sub.linkedTxnNumber) payload.linkedTxnNumber = clip(sub.linkedTxnNumber, 48);
      if (sub.receiptNumber) payload.receiptNumber = clip(sub.receiptNumber, 48);
      await setDoc(ref, payload);
      return true;
    }

    if (snap.data()?.status === 'pending_verification' && (sub.status === 'verified' || sub.status === 'rejected')) {
      const upd: Record<string, unknown> = {
        status: sub.status,
        bankVerifiedConfirmed: Boolean(sub.bankVerifiedConfirmed),
        updatedAt: serverTimestamp(),
      };
      if (sub.verifiedByName) upd.verifiedByName = clip(sub.verifiedByName, 120);
      if (sub.rejectionNote) upd.rejectionNote = clip(sub.rejectionNote, 400);
      if (sub.linkedTxnNumber) upd.linkedTxnNumber = clip(sub.linkedTxnNumber, 48);
      if (sub.receiptNumber) upd.receiptNumber = clip(sub.receiptNumber, 48);
      await updateDoc(ref, upd);
      return true;
    }
    return false;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncBankUpiToFirestore(bank: BankAccountRecord): Promise<boolean> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return false;
  const admin = await isFirebaseAdminUser(fbUser);
  if (!admin) return false;

  const id = sanitizeId(bank.id);
  const path = `bank_accounts/${id}`;
  const payload: Record<string, unknown> = {
    id,
    bankName: clip(bank.bankName, 120),
    accountName: clip(bank.accountName, 160),
    accountNumber: clip(bank.accountNumber, 40).padEnd(4, '0'),
    ifsc: clip(bank.ifsc, 20).padEnd(4, '0'),
    branch: clip(bank.branch, 120),
    upiId: clip(bank.upiId, 120),
    fundScope: clip(bank.fundScope, 120),
    openingBalance: Number(bank.openingBalance || 0),
    currentBalance: Number(bank.currentBalance || 0),
    instructions: clip(bank.instructions, 500),
    isActive: Boolean(bank.isActive),
    isDemo: Boolean(bank.isDemo),
    updatedAt: serverTimestamp(),
  };
  if (bank.qrCodeUrl && bank.qrCodeUrl.length <= 500 && !bank.qrCodeUrl.startsWith('data:')) {
    payload.qrCodeUrl = clip(bank.qrCodeUrl, 500);
  }

  try {
    await setDoc(doc(db, 'bank_accounts', id), payload);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncFundToFirestore(fund: FundSummary): Promise<boolean> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return false;
  const admin = await isFirebaseAdminUser(fbUser);
  if (!admin) return false;

  const id = sanitizeId(fund.id);
  const path = `funds/${id}`;
  try {
    await setDoc(doc(db, 'funds', id), {
      id,
      code: clip(fund.code, 32),
      nameEn: clip(fund.nameEn, 120),
      nameHi: clip(fund.nameHi, 120),
      nameUr: clip(fund.nameUr, 120),
      scope: ['masjid', 'madrasa', 'restricted', 'general'].includes(fund.scope) ? fund.scope : 'general',
      isRestricted: Boolean(fund.isRestricted),
      restrictedRule: clip(fund.restrictedRule, 300),
      description: clip(fund.description || '', 400),
      isActive: fund.isActive !== false,
      openingBalance: Number(fund.openingBalance || 0),
      totalIncome: Math.max(0, Number(fund.totalIncome || 0)),
      totalExpense: Math.max(0, Number(fund.totalExpense || 0)),
      transfersIn: Math.max(0, Number(fund.transfersIn || 0)),
      transfersOut: Math.max(0, Number(fund.transfersOut || 0)),
      currentBalance: Number(fund.currentBalance || 0),
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncSettingsToFirestore(settings: AppSettings): Promise<boolean> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return false;
  const admin = await isFirebaseAdminUser(fbUser);
  if (!admin) return false;

  const path = 'app_settings/default';
  const payload: Record<string, unknown> = {
    committeeName: clip(settings.committeeName || 'S.G.N Committee Noori Jama Masjid & Madarsa Anwarool Uloom', 200),
    committeeAddress: clip(
      settings.committeeAddress || 'At Ragdih, PO Chalkusha, District Hazaribagh, Jharkhand - 825109, India',
      300
    ),
    defaultLanguage: settings.defaultLanguage === 'hi' || settings.defaultLanguage === 'ur' ? settings.defaultLanguage : 'en',
    memberLoginEnabled: settings.memberLoginEnabled !== false,
    autoBackupEnabled: settings.autoBackupEnabled !== false,
    dualApprovalEnabled: Boolean(settings.dualApprovalEnabled),
    dualApprovalLimit: Math.max(500, Math.min(10000000, Number(settings.dualApprovalLimit || 5000))),
    reminderDayOfMonth: Math.max(1, Math.min(28, Math.round(Number(settings.reminderDayOfMonth || 5)))),
    reminderFrequency:
      settings.reminderFrequency === 'weekly' || settings.reminderFrequency === 'biweekly'
        ? settings.reminderFrequency
        : 'monthly',
    defaultMonthlyContribution: Math.max(10, Math.min(100000, Number(settings.defaultMonthlyContribution || 500))),
    hideMemberPhonesForMembers: Boolean(settings.hideMemberPhonesForMembers),
    isDemoDataActive: Boolean(settings.isDemoDataActive),
    lastSyncedBy: clip(fbUser.email || fbUser.uid, 128),
    updatedAt: serverTimestamp(),
  };
  if (settings.appLogoUrl && settings.appLogoUrl.length <= 500 && !settings.appLogoUrl.startsWith('data:')) {
    payload.appLogoUrl = clip(settings.appLogoUrl, 500);
  }
  try {
    await setDoc(doc(db, 'app_settings', 'default'), payload);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
