import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  Copy,
  Check,
  Upload,
  CheckCircle2,
  XCircle,
  Edit3,
  X,
  ShieldAlert,
  Eye,
  QrCode,
  ExternalLink,
  FileDown,
  Lock,
  AlertTriangle,
  Receipt,
  ZoomIn,
  Clock,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { uploadImageToFirebaseStorage } from '../firebase';
import { syncBankUpiToFirestore, syncPaymentSubmissionToFirestore } from '../lib/firestoreSync';
import { downloadDonationReceiptPDF } from '../lib/exports';
import type {
  AuthUser,
  BankAccountRecord,
  FundSummary,
  Language,
  MemberSummary,
  NumeralSystem,
  PaymentSubmissionRecord,
  ReconciliationSummary,
} from '../types';
import {
  COMMITTEE_ADDRESS,
  COMMITTEE_LOGO_URL,
  COMMITTEE_TITLE,
  formatINR,
  formatMonthKey,
  t,
} from '../i18n/translations';

const OFFICIAL_BOI_QR_FALLBACK = '/assets/aistudio/IMG-20261120-WA0010_4f735eaa.jpg';

interface BankQrViewProps {
  user: AuthUser;
  lang: Language;
  numerals: NumeralSystem;
  bankAccounts: BankAccountRecord[];
  cashBalance: number;
  reconciliation?: ReconciliationSummary | null;
  submissions: PaymentSubmissionRecord[];
  members: MemberSummary[];
  funds: FundSummary[];
  onRefresh: () => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read file.'));
    };
    reader.onerror = () => reject(new Error('File read error.'));
    reader.readAsDataURL(file);
  });
}

export const BankQrView: React.FC<BankQrViewProps> = ({
  user,
  lang,
  numerals,
  bankAccounts,
  cashBalance,
  reconciliation,
  submissions,
  members,
  funds,
  onRefresh,
  onNotify,
}) => {
  const isAdmin = user.role === 'admin_main' || user.role === 'admin_secondary';
  const primaryBank = bankAccounts[0] || null;
  const currentMember = members.find((m) => m.id === user.memberId) || members[0];

  const [generatedQrUrl, setGeneratedQrUrl] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewImg, setPreviewImg] = useState<{ url: string; title: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending_verification' | 'verified' | 'rejected'>('all');

  // Donate / Pay Contribution Form state
  const [paymentCategory, setPaymentCategory] = useState<'monthly_contribution' | 'donation'>('monthly_contribution');
  const [subMemberId, setSubMemberId] = useState(currentMember?.id || '');
  const [subFundId, setSubFundId] = useState('masjid_general');
  const [subAmount, setSubAmount] = useState(String(currentMember?.monthlyAmount || 500));
  const [subMonthsText, setSubMonthsText] = useState(
    currentMember?.pendingMonths?.[0] || new Date().toISOString().slice(0, 7)
  );
  const [subUtr, setSubUtr] = useState('');
  const [subNotes, setSubNotes] = useState('');
  const [subScreenshotUrl, setSubScreenshotUrl] = useState('');
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastPendingReceipt, setLastPendingReceipt] = useState<{
    utr: string;
    amount: number;
    fundName: string;
  } | null>(null);

  // Admin UPI Settings modal state
  const [showEditBank, setShowEditBank] = useState(false);
  const [bName, setBName] = useState('');
  const [bAccName, setBAccName] = useState('');
  const [bAccNum, setBAccNum] = useState('');
  const [bIfsc, setBIfsc] = useState('');
  const [bBranch, setBBranch] = useState('');
  const [bUpi, setBUpi] = useState('');
  const [bQrUrl, setBQrUrl] = useState('');
  const [bInstr, setBInstr] = useState('');
  const [uploadingQr, setUploadingQr] = useState(false);

  // Admin Manual Bank Verification modal state
  const [verifyModalSub, setVerifyModalSub] = useState<PaymentSubmissionRecord | null>(null);
  const [verifyDecision, setVerifyDecision] = useState<'verify' | 'reject'>('verify');
  const [bankStatementChecked, setBankStatementChecked] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  // Verified Digital Receipt modal state
  const [receiptModalSub, setReceiptModalSub] = useState<PaymentSubmissionRecord | null>(null);

  useEffect(() => {
    if (currentMember && !subMemberId) {
      setSubMemberId(currentMember.id);
      setSubAmount(String(currentMember.monthlyAmount || 500));
      setSubMonthsText(currentMember.pendingMonths?.[0] || new Date().toISOString().slice(0, 7));
    }
  }, [currentMember, subMemberId]);

  useEffect(() => {
    let active = true;
    async function genFallbackQr() {
      if (!primaryBank?.upiId) return;
      const amtNum = Number(subAmount);
      const amtPart = Number.isFinite(amtNum) && amtNum > 0 ? `&am=${amtNum}` : '';
      const upiUrl = `upi://pay?pa=${encodeURIComponent(primaryBank.upiId)}&pn=${encodeURIComponent(
        primaryBank.accountName
      )}${amtPart}&cu=INR`;
      try {
        const data = await QRCode.toDataURL(upiUrl, {
          width: 240,
          margin: 1,
          color: { dark: '#0B4F32', light: '#FFFFFF' },
        });
        if (active) setGeneratedQrUrl(data);
      } catch {
        // ignore
      }
    }
    genFallbackQr();
    return () => {
      active = false;
    };
  }, [primaryBank?.upiId, primaryBank?.accountName, subAmount]);

  const selectedFund = funds.find((f) => f.id === subFundId) || funds[0];

  function fundLabel(fund?: FundSummary | null): string {
    if (!fund) return '';
    if (lang === 'hi') return fund.nameHi || fund.nameEn;
    if (lang === 'ur') return fund.nameUr || fund.nameEn;
    return fund.nameEn;
  }

  function copyValue(key: string, val: string) {
    navigator.clipboard?.writeText(val);
    setCopiedId(key);
    setTimeout(() => setCopiedId(null), 1600);
  }

  function buildUpiUri(scheme: 'upi' | 'gpay' | 'phonepe' | 'paytm'): string {
    const pa = primaryBank?.upiId || 'boim-617606410026@boi';
    const pn = primaryBank?.accountName || 'MADRASA ANWAROOL ULOOM RAGDIH';
    const amtNum = Number(subAmount);
    const amtParam = Number.isFinite(amtNum) && amtNum > 0 ? `&am=${amtNum}` : '';
    const noteText = `${selectedFund?.code || 'MASJID'} ${currentMember?.memberCode || user.username}`;
    const query = `pa=${encodeURIComponent(pa)}&pn=${encodeURIComponent(pn)}${amtParam}&cu=INR&tn=${encodeURIComponent(
      noteText
    )}`;
    if (scheme === 'gpay') return `tez://upi/pay?${query}`;
    if (scheme === 'phonepe') return `phonepe://pay?${query}`;
    if (scheme === 'paytm') return `paytmmp://pay?${query}`;
    return `upi://pay?${query}`;
  }

  async function uploadSafeImage(file: File, purpose: 'upi_qr' | 'payment_receipt'): Promise<string> {
    if (!/^image\/(png|jpeg|jpg|webp)$/.test(file.type)) {
      throw new Error('Only PNG, JPG, JPEG, or WebP images are allowed.');
    }
    if (file.size > 3 * 1024 * 1024) {
      throw new Error('Image file must be smaller than 3 MB.');
    }

    // 1. Attempt Firebase Storage upload when authenticated in Firebase
    const storageFolder = purpose === 'upi_qr' ? 'upi_qr' : 'payment_receipts';
    const firebaseUrl = await uploadImageToFirebaseStorage(file, storageFolder);
    if (firebaseUrl) {
      return firebaseUrl;
    }

    // 2. Fallback to secure authenticated backend upload endpoint (/api/uploads/image)
    const dataUrl = await readFileAsDataUrl(file);
    const res = await apiRequest<{ url: string }>('/api/uploads/image', {
      method: 'POST',
      body: { dataUrl, purpose },
    });
    return res.url;
  }

  async function handleReceiptFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingReceipt(true);
    try {
      const url = await uploadSafeImage(file, 'payment_receipt');
      setSubScreenshotUrl(url);
      onNotify('Payment receipt image uploaded securely.', 'success');
    } catch (err: any) {
      onNotify(err?.message || 'Failed to upload receipt image.', 'error');
    } finally {
      setUploadingReceipt(false);
    }
  }

  async function handleQrFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingQr(true);
    try {
      const url = await uploadSafeImage(file, 'upi_qr');
      setBQrUrl(url);
      onNotify('Official UPI QR image uploaded. Click Save Changes to publish.', 'success');
    } catch (err: any) {
      onNotify(err?.message || 'Failed to upload QR code image.', 'error');
    } finally {
      setUploadingQr(false);
    }
  }

  async function handleSubmitPaymentProof(e: React.FormEvent) {
    e.preventDefault();
    const cleanUtr = subUtr.trim().replace(/\s+/g, '');
    if (!/^[a-zA-Z0-9-]{6,40}$/.test(cleanUtr) || /^(\d)\1+$/.test(cleanUtr)) {
      onNotify('Please enter a valid 6–40 character UPI Transaction ID / UTR Number.', 'error');
      return;
    }
    if (!subScreenshotUrl) {
      onNotify('Please upload your UPI payment receipt or screenshot before submitting.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const months =
        paymentCategory === 'monthly_contribution'
          ? subMonthsText
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
      const memberTarget = isAdmin ? subMemberId : user.memberId || currentMember?.id || '';
      const resolvedMember = members.find((m) => m.id === memberTarget);

      const res = await apiRequest<{
        id: string;
        status: 'pending_verification';
        fundName: string;
        utrReference: string;
        submittedAt: string;
      }>('/api/submissions', {
        method: 'POST',
        body: {
          memberId: memberTarget || undefined,
          paymentCategory,
          amount: Number(subAmount),
          months: paymentCategory === 'monthly_contribution' ? (months.length > 0 ? months : [new Date().toISOString().slice(0, 7)]) : [],
          fundId: subFundId,
          utrReference: cleanUtr,
          screenshotUrl: subScreenshotUrl,
          notes: subNotes,
        },
      });

      // Mirror submission to Firebase Cloud Firestore when authenticated in Firebase
      void syncPaymentSubmissionToFirestore({
        id: res.id,
        memberId: memberTarget || user.id,
        memberCode: resolvedMember?.memberCode || user.username,
        memberName: resolvedMember?.fullName || user.fullName,
        paymentCategory,
        amount: Number(subAmount),
        fundId: subFundId,
        utrReference: res.utrReference,
        screenshotUrl: subScreenshotUrl,
        notes: subNotes,
        status: 'pending_verification',
        bankVerifiedConfirmed: false,
        submittedAt: res.submittedAt,
      }).catch(() => {});

      setLastPendingReceipt({
        utr: res.utrReference,
        amount: Number(subAmount),
        fundName: res.fundName,
      });
      setSubUtr('');
      setSubNotes('');
      setSubScreenshotUrl('');
      onRefresh();
      onNotify(
        'Payment proof submitted with status PENDING VERIFICATION. Balances will update only after Admin verifies the Bank Statement.',
        'success'
      );
    } catch (err: any) {
      onNotify(err?.message || 'Failed to submit payment proof.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function openVerifyModal(sub: PaymentSubmissionRecord, decision: 'verify' | 'reject') {
    setVerifyModalSub(sub);
    setVerifyDecision(decision);
    setBankStatementChecked(false);
    setRejectionReason(
      decision === 'reject' ? 'UTR / amount not found in Bank of India statement.' : ''
    );
  }

  async function handleConfirmVerification(e: React.FormEvent) {
    e.preventDefault();
    if (!verifyModalSub) return;

    if (verifyDecision === 'verify' && !bankStatementChecked) {
      onNotify('Please confirm that you verified this UTR in the real Bank of India statement.', 'error');
      return;
    }
    if (verifyDecision === 'reject' && rejectionReason.trim().length < 5) {
      onNotify('Please enter a clear rejection reason (at least 5 characters).', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiRequest<{ ok: boolean; status: 'verified' | 'rejected'; txnNumber?: string; receiptNumber?: string }>(
        `/api/submissions/${verifyModalSub.id}/verify`,
        {
          method: 'POST',
          body: {
            decision: verifyDecision,
            bankStatementChecked: verifyDecision === 'verify' ? bankStatementChecked : false,
            rejectionNote: verifyDecision === 'reject' ? rejectionReason.trim() : undefined,
          },
        }
      );

      // Sync verified/rejected state to Firebase Cloud Firestore if signed into Firebase
      void syncPaymentSubmissionToFirestore({
        id: verifyModalSub.id,
        memberId: verifyModalSub.memberId,
        memberCode: verifyModalSub.memberCode,
        memberName: verifyModalSub.memberName,
        paymentCategory: verifyModalSub.paymentCategory || 'monthly_contribution',
        amount: verifyModalSub.amount,
        fundId: verifyModalSub.fundId,
        utrReference: verifyModalSub.utrReference,
        screenshotUrl: verifyModalSub.screenshotUrl,
        notes: verifyModalSub.notes,
        status: res.status,
        verifiedByName: user.fullName,
        rejectionNote: verifyDecision === 'reject' ? rejectionReason.trim() : null,
        linkedTxnNumber: res.txnNumber || null,
        receiptNumber: res.receiptNumber || null,
        bankVerifiedConfirmed: verifyDecision === 'verify',
        submittedAt: verifyModalSub.submittedAt,
      }).catch(() => {});

      setVerifyModalSub(null);
      onRefresh();
      if (verifyDecision === 'verify') {
        onNotify(
          `Approved against bank statement! Official Receipt ${res.receiptNumber} (${res.txnNumber}) issued.`,
          'success'
        );
      } else {
        onNotify('Payment submission rejected and logged in Audit Trail.', 'success');
      }
    } catch (err: any) {
      onNotify(err?.message || 'Verification action failed.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function openEditBankModal() {
    if (!primaryBank) return;
    setBName(primaryBank.bankName);
    setBAccName(primaryBank.accountName);
    setBAccNum(primaryBank.accountNumber);
    setBIfsc(primaryBank.ifsc);
    setBBranch(primaryBank.branch);
    setBUpi(primaryBank.upiId);
    setBQrUrl(primaryBank.qrCodeUrl || OFFICIAL_BOI_QR_FALLBACK);
    setBInstr(primaryBank.instructions);
    setShowEditBank(true);
  }

  async function handleUpdateBank(e: React.FormEvent) {
    e.preventDefault();
    if (!primaryBank) return;
    setSubmitting(true);
    try {
      await apiRequest(`/api/banks/${primaryBank.id}`, {
        method: 'PUT',
        body: {
          bankName: bName,
          accountName: bAccName,
          accountNumber: bAccNum,
          ifsc: bIfsc,
          branch: bBranch,
          upiId: bUpi,
          qrCodeUrl: bQrUrl,
          instructions: bInstr,
        },
      });

      void syncBankUpiToFirestore({
        ...primaryBank,
        bankName: bName,
        accountName: bAccName,
        accountNumber: bAccNum,
        ifsc: bIfsc.toUpperCase(),
        branch: bBranch,
        upiId: bUpi,
        qrCodeUrl: bQrUrl,
        instructions: bInstr,
      }).catch(() => {});

      setShowEditBank(false);
      onRefresh();
      onNotify('Official Bank UPI Settings & QR Code updated and recorded in Audit Log.', 'success');
    } catch (err: any) {
      onNotify(err?.message || 'Failed to update UPI settings.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const officialQrDisplayUrl = primaryBank?.qrCodeUrl || OFFICIAL_BOI_QR_FALLBACK || generatedQrUrl;
  const filteredSubmissions = submissions.filter((s) =>
    statusFilter === 'all' ? true : s.status === statusFilter
  );
  const pendingCount = submissions.filter((s) => s.status === 'pending_verification').length;

  return (
    <div className="space-y-6">
      {/* Safety Banner (No UPI PIN / No OTP / Manual Bank Verification Required) */}
      <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800/70 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-950 dark:text-amber-200 leading-relaxed space-y-1">
            <p className="font-semibold">{t(lang, 'safetyNoPinNotice')}</p>
          </div>
        </div>
        {isAdmin && primaryBank && (
          <button
            type="button"
            onClick={openEditBankModal}
            className="min-h-[42px] px-4 py-2 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
          >
            <Edit3 className="w-4 h-4" />
            <span>{t(lang, 'upiSettingsTitle')}</span>
          </button>
        )}
      </div>

      {/* Main 2-Column Interactive Layout: Left = Large Official UPI QR + Bank Details, Right = Donate / Pay Contribution Form */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Official Bank of India UPI QR Standee & Details */}
        <section className="xl:col-span-5 rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-5 py-4 bg-[#0B4F32] text-white flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <QrCode className="w-5 h-5 shrink-0 text-amber-300" />
              <div className="min-w-0">
                <h2 className="text-sm font-bold truncate">{t(lang, 'scanAndPayHeading')}</h2>
                <p className="text-[11px] text-emerald-100 truncate">
                  {primaryBank?.bankName || 'Bank of India'} · {primaryBank?.accountName || 'MADRASA ANWAROOL ULOOM RAGDIH'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                setPreviewImg({
                  url: officialQrDisplayUrl,
                  title: `${primaryBank?.bankName || 'Bank of India'} — Official Committee UPI QR`,
                })
              }
              className="min-h-[34px] px-2.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-[11px] font-semibold inline-flex items-center gap-1 shrink-0"
            >
              <ZoomIn className="w-3.5 h-3.5" />
              <span>Zoom</span>
            </button>
          </div>

          <div className="p-5 space-y-5">
            {/* Large, Crystal-Clear Official UPI QR Standee */}
            <div className="flex flex-col items-center justify-center p-4 rounded-2xl bg-[#F6F8F7] dark:bg-[#0D1612] border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() =>
                  setPreviewImg({
                    url: officialQrDisplayUrl,
                    title: `${primaryBank?.bankName || 'Bank of India'} — Official Committee UPI QR`,
                  })
                }
                className="group relative rounded-xl overflow-hidden bg-white p-2 border border-slate-200 shadow-xs"
              >
                <img
                  src={officialQrDisplayUrl}
                  alt="Official Committee Bank UPI QR Code"
                  referrerPolicy="no-referrer"
                  className="w-60 sm:w-64 max-h-80 object-contain rounded-lg"
                />
              </button>

              <div className="mt-3 text-center space-y-1">
                <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  {primaryBank?.accountName || 'MADRASA ANWAROOL ULOOM RAGDIH'}
                </div>
                <button
                  type="button"
                  onClick={() => copyValue('upi_hero', primaryBank?.upiId || 'boim-617606410026@boi')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-xs font-data font-bold text-[#0B4F32] dark:text-emerald-300"
                >
                  <span>{primaryBank?.upiId || 'boim-617606410026@boi'}</span>
                  {copiedId === 'upi_hero' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* Official Bank Details Table */}
            {primaryBank && (
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">Bank Name</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100 text-right">{primaryBank.bankName}</span>
                </div>
                <div className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">Account Holder</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100 text-right">{primaryBank.accountName}</span>
                </div>
                <div className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">Account Number</span>
                  <button
                    type="button"
                    onClick={() => copyValue('acc_num', primaryBank.accountNumber)}
                    className="font-data font-semibold text-slate-900 dark:text-slate-100 inline-flex items-center gap-1.5 hover:text-[#0B4F32]"
                  >
                    <span>{primaryBank.accountNumber}</span>
                    {copiedId === 'acc_num' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">IFSC Code</span>
                  <button
                    type="button"
                    onClick={() => copyValue('acc_ifsc', primaryBank.ifsc)}
                    className="font-data font-semibold text-slate-900 dark:text-slate-100 inline-flex items-center gap-1.5 hover:text-[#0B4F32]"
                  >
                    <span>{primaryBank.ifsc}</span>
                    {copiedId === 'acc_ifsc' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">Branch</span>
                  <span className="text-slate-700 dark:text-slate-300 text-right">{primaryBank.branch}</span>
                </div>
                <div className="pt-2 flex items-center justify-between">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Verified Bank Balance</span>
                  <span className="text-lg font-bold font-data text-[#0B4F32] dark:text-emerald-400">
                    {formatINR(primaryBank.currentBalance, numerals)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* RIGHT COLUMN: Member "Donate / Pay Contribution" Flow */}
        <section className="xl:col-span-7 rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-5">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {t(lang, 'donatePayTitle')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Select your fund, scan the official QR or launch your UPI app, then submit the UTR number and screenshot for manual bank verification.
            </p>
          </div>

          {/* Pending Verification Confirmation Banner (NEVER a fake "Payment Successful" screen!) */}
          {lastPendingReceipt && (
            <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/35 border border-amber-300 dark:border-amber-800 text-xs text-amber-950 dark:text-amber-200 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold inline-flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                  <span>{t(lang, 'pendingAdminVerification')}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setLastPendingReceipt(null)}
                  className="text-amber-700 dark:text-amber-300"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p>
                UTR <strong className="font-data">{lastPendingReceipt.utr}</strong> for{' '}
                <strong className="font-data">{formatINR(lastPendingReceipt.amount, numerals)}</strong> ({lastPendingReceipt.fundName}) has been recorded as <strong>Pending Verification</strong>. Your Digital Receipt and updated balance will appear once the Committee Admin verifies the credit in the Bank of India statement.
              </p>
            </div>
          )}

          <form onSubmit={handleSubmitPaymentProof} className="space-y-4">
            {/* Step 1: Payment Purpose Toggle */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {t(lang, 'paymentPurposeLabel')}
              </label>
              <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => {
                    setPaymentCategory('monthly_contribution');
                    if (currentMember) setSubAmount(String(currentMember.monthlyAmount || 500));
                  }}
                  className={`min-h-[42px] px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                    paymentCategory === 'monthly_contribution'
                      ? 'bg-[#0B4F32] text-white'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {t(lang, 'monthlyCommitteeFee')}
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentCategory('donation')}
                  className={`min-h-[42px] px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                    paymentCategory === 'donation'
                      ? 'bg-[#0B4F32] text-white'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {t(lang, 'fundDonationType')}
                </button>
              </div>
            </div>

            {/* Admin can select which member the submission belongs to */}
            {isAdmin && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Member / Donor *
                </label>
                <select
                  value={subMemberId}
                  onChange={(e) => {
                    setSubMemberId(e.target.value);
                    const picked = members.find((m) => m.id === e.target.value);
                    if (picked && paymentCategory === 'monthly_contribution') {
                      setSubAmount(String(picked.monthlyAmount));
                      setSubMonthsText(picked.pendingMonths?.[0] || new Date().toISOString().slice(0, 7));
                    }
                  }}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.memberCode} — {m.fullName}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Step 2: Select Donation Fund (All 10 Separate Ledgers) */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t(lang, 'selectDonationFund')} *
              </label>
              <select
                value={subFundId}
                onChange={(e) => setSubFundId(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium"
              >
                {funds.map((f) => (
                  <option key={f.id} value={f.id}>
                    {fundLabel(f)} {f.isRestricted ? ' [Restricted]' : ''}
                  </option>
                ))}
              </select>
              {selectedFund?.isRestricted && (
                <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-800 dark:text-amber-300">
                  <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{t(lang, 'restrictedFundNote')}</span>
                </div>
              )}
            </div>

            {/* Step 3: Amount & Month(s) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Amount (₹) *
                </label>
                <input
                  type="number"
                  min={1}
                  max={10000000}
                  required
                  value={subAmount}
                  onChange={(e) => setSubAmount(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data font-bold"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[200, 500, 1000, 2100, 5000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setSubAmount(String(amt))}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-data font-semibold hover:border-[#0B4F32] dark:hover:border-emerald-500"
                    >
                      ₹{amt.toLocaleString('en-IN')}
                    </button>
                  ))}
                </div>
              </div>

              {paymentCategory === 'monthly_contribution' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Month(s) (YYYY-MM) *
                  </label>
                  <input
                    type="text"
                    required
                    value={subMonthsText}
                    onChange={(e) => setSubMonthsText(e.target.value)}
                    placeholder="2026-11"
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Separate multiple months with comma (e.g. 2026-10, 2026-11)
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Donation Note (Optional)
                  </label>
                  <input
                    type="text"
                    value={subNotes}
                    onChange={(e) => setSubNotes(e.target.value)}
                    placeholder="e.g. Zakat / Ramadan / Masjid Aid"
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
              )}
            </div>

            {/* Step 4: Launch Official UPI Apps (GPay / PhonePe / Paytm / Any UPI App) */}
            <div className="p-3.5 rounded-xl bg-[#F6F8F7] dark:bg-[#0D1612] border border-slate-200 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  {t(lang, 'payViaUpiApps')}
                </span>
                <span className="text-[11px] font-data text-[#0B4F32] dark:text-emerald-400 font-semibold">
                  {formatINR(Number(subAmount) || 0, numerals)} → {primaryBank?.upiId || 'boim-617606410026@boi'}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(
                  [
                    ['gpay', 'Google Pay'],
                    ['phonepe', 'PhonePe'],
                    ['paytm', 'Paytm'],
                    ['upi', 'Any UPI App'],
                  ] as const
                ).map(([scheme, label]) => (
                  <a
                    key={scheme}
                    href={buildUpiUri(scheme)}
                    className="min-h-[42px] px-3 py-2 rounded-xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-700 hover:border-[#0B4F32] dark:hover:border-emerald-500 text-xs font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <span>{label}</span>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                  </a>
                ))}
              </div>
            </div>

            {/* Step 5: Enter UPI Transaction ID / UTR & Upload Payment Screenshot */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t(lang, 'utrNumberLabel')} *
                </label>
                <input
                  type="text"
                  required
                  minLength={6}
                  maxLength={40}
                  value={subUtr}
                  onChange={(e) => setSubUtr(e.target.value)}
                  placeholder="e.g. 432619884512"
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t(lang, 'uploadReceiptScreenshot')} *
                </label>
                <label className="flex items-center justify-center gap-2 min-h-[44px] px-3 py-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-[#0B4F32] cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-200">
                  <Upload className="w-4 h-4 shrink-0 text-[#0B4F32] dark:text-emerald-400" />
                  <span className="truncate">
                    {uploadingReceipt
                      ? 'Uploading...'
                      : subScreenshotUrl
                      ? 'Receipt uploaded (click to replace)'
                      : 'Choose PNG / JPG screenshot'}
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleReceiptFileChange}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {subScreenshotUrl && (
              <div className="flex items-center gap-3 p-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-800/60">
                <img
                  src={subScreenshotUrl}
                  alt="Uploaded receipt preview"
                  className="w-12 h-12 rounded-lg object-cover border border-slate-200"
                />
                <div className="flex-1 min-w-0 text-xs">
                  <div className="font-semibold text-emerald-900 dark:text-emerald-300">Receipt attached securely</div>
                  <div className="text-[11px] text-slate-500 truncate">{subScreenshotUrl}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setSubScreenshotUrl('')}
                  className="p-1.5 text-slate-400 hover:text-rose-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {paymentCategory === 'monthly_contribution' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Remarks (Optional)
                </label>
                <input
                  type="text"
                  value={subNotes}
                  onChange={(e) => setSubNotes(e.target.value)}
                  placeholder="Optional payment note"
                  className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || uploadingReceipt}
              className="w-full min-h-[48px] px-5 py-2.5 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors"
            >
              <Upload className="w-4 h-4" />
              <span>{submitting ? 'Submitting...' : t(lang, 'submitPendingVerification')}</span>
            </button>
          </form>
        </section>
      </div>

      {/* Bank Reconciliation vs Cash-in-Hand vs 10 Virtual Funds */}
      <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Bank Reconciliation & 10 Separate Virtual Funds
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Verified {primaryBank?.bankName || 'Bank'} Balance + Cash-in-Hand reconciles to the exact rupee with all 10 separate fund ledgers.
            </p>
          </div>
          {reconciliation && (
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
              {reconciliation.isReconciled ? 'Reconciled · Double-Entry Balanced' : 'Reconciliation Check Required'}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3.5 rounded-xl bg-[#F6F8F7] dark:bg-[#0D1612] border border-slate-200/80 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400">
              Physical Bank Balance ({primaryBank?.bankName || 'Bank of India'})
            </div>
            <div className="text-lg font-bold font-data text-[#0B4F32] dark:text-emerald-400 mt-0.5">
              {formatINR(reconciliation?.physicalBankBalance ?? (primaryBank?.currentBalance || 0), numerals)}
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-[#F6F8F7] dark:bg-[#0D1612] border border-slate-200/80 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400">Committee Cash-in-Hand</div>
            <div className="text-lg font-bold font-data text-slate-900 dark:text-slate-100 mt-0.5">
              {formatINR(cashBalance, numerals)}
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-[#F6F8F7] dark:bg-[#0D1612] border border-slate-200/80 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400">Sum of 10 Virtual Funds</div>
            <div className="text-lg font-bold font-data text-[#0B4F32] dark:text-emerald-400 mt-0.5">
              {formatINR(
                reconciliation?.sumOfVirtualFunds ?? funds.reduce((s, f) => s + f.currentBalance, 0),
                numerals
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Payment Verification Queue (Admin) / My UPI Submissions & Digital Receipts (Member) */}
      <section className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {isAdmin ? `Admin UPI Payment Verification Queue (${pendingCount} Pending)` : 'My UPI Donations & Payment Receipts'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {isAdmin
                ? 'Cross-check every UTR in the Bank of India statement before approving. Every approval & rejection is recorded in the Audit Log.'
                : 'Track verification status and download Official Digital Receipts once verified by an administrator.'}
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900 w-fit">
            {(
              [
                ['all', t(lang, 'all')],
                ['pending_verification', t(lang, 'pending')],
                ['verified', 'Approved'],
                ['rejected', 'Rejected'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold min-h-[34px] ${
                  statusFilter === key
                    ? 'bg-white dark:bg-[#192822] text-[#0B4F32] dark:text-emerald-300 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {filteredSubmissions.map((sub) => {
            const matchedFund = funds.find((f) => f.id === sub.fundId);
            const resolvedFundName = matchedFund ? fundLabel(matchedFund) : sub.fundName || sub.fundId;
            return (
              <div key={sub.id} className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-start gap-4 min-w-0">
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewImg({
                        url: sub.screenshotUrl,
                        title: `Payment Receipt — ${sub.memberName} (UTR: ${sub.utrReference})`,
                      })
                    }
                    className="w-20 h-16 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 shrink-0 relative group"
                  >
                    <img
                      src={sub.screenshotUrl}
                      alt={`Payment slip by ${sub.memberName}`}
                      className="w-full h-full object-cover"
                    />
                    <span className="inset-0 absolute bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                      <Eye className="w-4 h-4" />
                    </span>
                  </button>

                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {sub.memberName} ({sub.memberCode})
                      </span>
                      <span className="text-sm font-bold font-data text-[#0B4F32] dark:text-emerald-400">
                        {formatINR(sub.amount, numerals)}
                      </span>
                      <span
                        className={`text-xs font-semibold ${
                          sub.status === 'verified'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : sub.status === 'rejected'
                            ? 'text-rose-700 dark:text-rose-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        ·{' '}
                        {sub.status === 'pending_verification'
                          ? t(lang, 'pendingAdminVerification')
                          : sub.status === 'verified'
                          ? `${t(lang, 'approvedVerifiedStatus')} (${sub.receiptNumber || sub.linkedTxnNumber})`
                          : t(lang, 'rejectedStatus')}
                      </span>
                      {sub.isDuplicateUtr && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 dark:text-rose-400">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>Duplicate UTR Alert</span>
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-slate-600 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span>
                        Fund: <strong className="text-slate-800 dark:text-slate-200">{resolvedFundName}</strong>
                      </span>
                      <span>·</span>
                      <span>
                        Type:{' '}
                        <strong>
                          {sub.paymentCategory === 'donation'
                            ? t(lang, 'fundDonationType')
                            : t(lang, 'monthlyCommitteeFee')}
                        </strong>
                      </span>
                      <span>·</span>
                      <span>
                        UTR: <strong className="font-data text-slate-800 dark:text-slate-200">{sub.utrReference}</strong>
                      </span>
                      {sub.months?.length > 0 && (
                        <>
                          <span>·</span>
                          <span>Months: {sub.months.map((m) => formatMonthKey(m, lang, numerals)).join(', ')}</span>
                        </>
                      )}
                    </div>

                    {sub.notes && <div className="text-xs text-slate-500 dark:text-slate-400">{sub.notes}</div>}
                    {sub.rejectionNote && (
                      <div className="text-xs font-medium text-rose-700 dark:text-rose-400">
                        Rejection Reason: {sub.rejectionNote}
                      </div>
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {sub.status === 'verified' && (
                    <>
                      <button
                        type="button"
                        onClick={() => setReceiptModalSub(sub)}
                        className="min-h-[40px] px-3.5 py-2 rounded-xl border border-[#0B4F32] text-[#0B4F32] dark:text-emerald-300 dark:border-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <Receipt className="w-4 h-4" />
                        <span>{t(lang, 'viewOfficialReceipt')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadDonationReceiptPDF(sub, matchedFund?.nameEn || sub.fundName)}
                        className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <FileDown className="w-4 h-4" />
                        <span>{t(lang, 'downloadReceipt')}</span>
                      </button>
                    </>
                  )}

                  {isAdmin && sub.status === 'pending_verification' && (
                    <>
                      <button
                        type="button"
                        onClick={() => openVerifyModal(sub, 'verify')}
                        className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>{t(lang, 'approve')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openVerifyModal(sub, 'reject')}
                        className="min-h-[40px] px-3.5 py-2 rounded-xl border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>{t(lang, 'reject')}</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {filteredSubmissions.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No payment submissions match this filter yet.
            </div>
          )}
        </div>
      </section>

      {/* Admin UPI Payment Settings & QR Upload Modal */}
      {showEditBank && isAdmin && primaryBank && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-6 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                {t(lang, 'upiSettingsTitle')}
              </h3>
              <button type="button" onClick={() => setShowEditBank(false)} className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleUpdateBank} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Bank Name *</label>
                  <input
                    required
                    value={bName}
                    onChange={(e) => setBName(e.target.value)}
                    placeholder="Bank of India"
                    className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Official UPI ID *</label>
                  <input
                    required
                    value={bUpi}
                    onChange={(e) => setBUpi(e.target.value)}
                    placeholder="boim-617606410026@boi"
                    className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Account Holder Name *</label>
                <input
                  required
                  value={bAccName}
                  onChange={(e) => setBAccName(e.target.value)}
                  placeholder="MADRASA ANWAROOL ULOOM RAGDIH"
                  className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Account Number *</label>
                  <input
                    required
                    value={bAccNum}
                    onChange={(e) => setBAccNum(e.target.value)}
                    className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">IFSC Code *</label>
                  <input
                    required
                    value={bIfsc}
                    onChange={(e) => setBIfsc(e.target.value)}
                    className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Branch</label>
                <input
                  value={bBranch}
                  onChange={(e) => setBBranch(e.target.value)}
                  className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>

              {/* Official QR Code Upload / Update */}
              <div className="p-3.5 rounded-xl bg-[#F6F8F7] dark:bg-[#0D1612] border border-slate-200 dark:border-slate-800 space-y-2.5">
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                  {t(lang, 'uploadOfficialQrLabel')}
                </label>
                <div className="flex items-center gap-4">
                  <img
                    src={bQrUrl || OFFICIAL_BOI_QR_FALLBACK}
                    alt="Official QR preview"
                    className="w-20 h-24 rounded-lg object-contain bg-white border border-slate-200 p-1 shrink-0"
                  />
                  <div className="flex-1 space-y-2">
                    <label className="w-full min-h-[40px] px-3 py-2 rounded-xl border border-dashed border-[#0B4F32] text-[#0B4F32] dark:text-emerald-300 dark:border-emerald-600 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer">
                      <Upload className="w-4 h-4" />
                      <span>{uploadingQr ? 'Uploading QR...' : 'Upload New Official Bank QR (PNG/JPG)'}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleQrFileChange}
                        className="hidden"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setBQrUrl(OFFICIAL_BOI_QR_FALLBACK)}
                      className="text-[11px] font-semibold text-slate-500 hover:text-[#0B4F32] underline"
                    >
                      Restore Uploaded Bank of India Standee QR
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Payment Instructions</label>
                <textarea
                  rows={2}
                  value={bInstr}
                  onChange={(e) => setBInstr(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEditBank(false)}
                  className="min-h-[42px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm"
                >
                  {t(lang, 'cancel')}
                </button>
                <button
                  type="submit"
                  disabled={submitting || uploadingQr}
                  className="min-h-[42px] px-5 py-2 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-sm font-semibold"
                >
                  {submitting ? 'Saving...' : t(lang, 'saveChanges')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Manual Bank Verification / Rejection Confirmation Modal */}
      {verifyModalSub && isAdmin && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {verifyDecision === 'verify' ? 'Manual Bank Statement Verification' : 'Reject UPI Payment Submission'}
              </h3>
              <button type="button" onClick={() => setVerifyModalSub(null)} className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-[#F6F8F7] dark:bg-[#0D1612] border border-slate-200 dark:border-slate-800 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Member / Donor</span>
                <strong>{verifyModalSub.memberName} ({verifyModalSub.memberCode})</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Amount</span>
                <strong className="font-data text-[#0B4F32] dark:text-emerald-400">
                  {formatINR(verifyModalSub.amount, numerals)}
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Target Fund</span>
                <strong>{verifyModalSub.fundName || verifyModalSub.fundId}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">UPI UTR / Txn ID</span>
                <strong className="font-data">{verifyModalSub.utrReference}</strong>
              </div>
            </div>

            <form onSubmit={handleConfirmVerification} className="space-y-4">
              {verifyDecision === 'verify' ? (
                <label className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-950 dark:text-amber-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bankStatementChecked}
                    onChange={(e) => setBankStatementChecked(e.target.checked)}
                    className="w-4 h-4 mt-0.5 accent-[#0B4F32] shrink-0"
                  />
                  <span>{t(lang, 'manualBankConfirmLabel')}</span>
                </label>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t(lang, 'rejectionReasonPrompt')} *
                  </label>
                  <textarea
                    required
                    minLength={5}
                    rows={3}
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="e.g. UTR not found in Bank of India statement / Duplicate UTR / Amount mismatch"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setVerifyModalSub(null)}
                  className="min-h-[42px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm"
                >
                  {t(lang, 'cancel')}
                </button>
                <button
                  type="submit"
                  disabled={submitting || (verifyDecision === 'verify' && !bankStatementChecked)}
                  className={`min-h-[42px] px-5 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-50 ${
                    verifyDecision === 'verify' ? 'bg-[#0B4F32] hover:bg-[#093F28]' : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {submitting
                    ? 'Processing...'
                    : verifyDecision === 'verify'
                    ? 'Confirm Bank Credit & Issue Receipt'
                    : 'Confirm Rejection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Official Verified Digital Receipt Modal */}
      {receiptModalSub && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setReceiptModalSub(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-[#0B4F32] text-white p-5 text-center space-y-1.5 relative">
              <button
                type="button"
                onClick={() => setReceiptModalSub(null)}
                className="absolute right-3 top-3 p-1 text-white/80 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
              <img
                src={COMMITTEE_LOGO_URL}
                alt={COMMITTEE_TITLE}
                referrerPolicy="no-referrer"
                className="w-12 h-12 mx-auto rounded-full bg-white p-1 object-contain"
              />
              <h3 className="text-sm font-bold leading-snug">{COMMITTEE_TITLE}</h3>
              <p className="text-[11px] text-emerald-100">{COMMITTEE_ADDRESS}</p>
              <div className="pt-1 text-xs font-bold tracking-wide text-amber-200">
                OFFICIAL VERIFIED PAYMENT RECEIPT
              </div>
            </div>

            <div className="p-5 space-y-2.5 text-xs">
              {[
                ['Receipt Number', receiptModalSub.receiptNumber || receiptModalSub.linkedTxnNumber || 'VERIFIED'],
                ['Ledger Transaction #', receiptModalSub.linkedTxnNumber || '-'],
                ['Member Name & ID', `${receiptModalSub.memberName} (${receiptModalSub.memberCode})`],
                ['Donation Fund', receiptModalSub.fundName || receiptModalSub.fundId],
                ['UPI Transaction ID / UTR', receiptModalSub.utrReference],
                [
                  'Payment / Verified Date',
                  (receiptModalSub.verifiedAt || receiptModalSub.submittedAt || '').slice(0, 10),
                ],
                ['Verified Amount', formatINR(receiptModalSub.amount, numerals)],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-100 dark:border-slate-800"
                >
                  <span className="text-slate-500 dark:text-slate-400">{k}</span>
                  <span className="font-data font-bold text-slate-900 dark:text-slate-100 text-right">{v}</span>
                </div>
              ))}

              <div className="pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReceiptModalSub(null)}
                  className="min-h-[40px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => downloadDonationReceiptPDF(receiptModalSub, receiptModalSub.fundName)}
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <FileDown className="w-4 h-4" />
                  <span>Download PDF Receipt</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Image Preview Lightbox (Official QR Zoom or Uploaded Receipt) */}
      {previewImg && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          onClick={() => setPreviewImg(null)}
        >
          <div
            className="max-w-lg w-full bg-white dark:bg-[#121D18] rounded-2xl p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                {previewImg.title}
              </span>
              <button type="button" onClick={() => setPreviewImg(null)} className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <img
              src={previewImg.url}
              alt={previewImg.title}
              className="w-full max-h-[75vh] object-contain rounded-xl bg-white"
            />
          </div>
        </div>
      )}
    </div>
  );
};
