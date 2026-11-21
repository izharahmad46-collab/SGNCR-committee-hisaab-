export type Language = 'en' | 'hi' | 'ur';
export type NumeralSystem = 'en' | 'hi';
export type UserRole = 'admin_main' | 'admin_secondary' | 'member';

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  memberId: string | null;
  phone: string;
  twoFactorEnabled: boolean;
  isActive: boolean;
}

export interface FundSummary {
  id: string;
  code: string;
  nameEn: string;
  nameHi: string;
  nameUr: string;
  scope: 'masjid' | 'madrasa' | 'restricted' | 'general';
  isRestricted: boolean;
  restrictedRule: string;
  description?: string;
  isActive?: boolean;
  openingBalance: number;
  totalIncome: number;
  totalExpense: number;
  transfersIn: number;
  transfersOut: number;
  currentBalance: number;
  pendingCount: number;
  transactionCount: number;
}

export interface MemberMonthRecord {
  monthKey: string; // YYYY-MM
  expected: number;
  paid: number;
  remaining: number;
  status: 'paid' | 'partial' | 'unpaid';
  dueStatus?: 'paid' | 'partial' | 'unpaid' | 'overdue';
  paidDate?: string;
  txnNumber?: string;
  paymentMethod?: string;
}

export interface MemberSummary {
  id: string;
  memberCode: string;
  fullName: string;
  phone: string;
  village: string;
  monthlyAmount: number;
  joiningDate: string; // YYYY-MM-DD
  status: 'active' | 'inactive';
  totalExpected: number;
  totalPaid: number;
  outstandingAmount: number;
  pendingMonthsCount: number;
  pendingMonths: string[];
  pendingSince: string | null;
  monthHistory: MemberMonthRecord[];
  isDemo: boolean;
}

export interface TransactionRecord {
  id: string;
  txnNumber: string;
  date: string; // YYYY-MM-DD
  createdAt: string;
  monthKey: string; // YYYY-MM
  type: 'income' | 'expense' | 'transfer' | 'reversal';
  category: string;
  fundId: string;
  fundName?: string;
  targetFundId: string | null;
  targetFundName?: string | null;
  bankAccountId: string | null;
  bankAccountName?: string | null;
  paymentMethod: 'Cash' | 'UPI' | 'Bank';
  amount: number;
  partyName: string;
  memberId: string | null;
  description: string;
  receiptUrl: string | null;
  status: 'approved' | 'pending_approval' | 'rejected' | 'reversed';
  createdBy: string;
  createdByName: string;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  reversedTxnId: string | null;
  isDemo: boolean;
}

export interface SalaryPaymentRecord {
  id: string;
  staffId: string;
  monthKey: string;
  amount: number;
  paymentDate: string;
  paymentMethod: 'Cash' | 'UPI' | 'Bank';
  reference: string;
  txnId: string | null;
  txnNumber: string | null;
  recordedByName: string;
}

export interface StaffMonthLedger {
  monthKey: string;
  payable: number;
  paid: number;
  remaining: number;
  status: 'paid' | 'partial' | 'pending';
  pendingDays: number;
  payments: SalaryPaymentRecord[];
}

export interface StaffSummary {
  id: string;
  name: string;
  designation: string;
  institution: 'masjid' | 'madrasa';
  fundId: string;
  monthlySalary: number;
  joiningDate: string;
  phone: string;
  status: 'active' | 'inactive';
  totalPayable: number;
  totalPaid: number;
  totalPending: number;
  pendingMonths: string[];
  maxPendingDays: number;
  monthlyHistory: StaffMonthLedger[];
  isDemo: boolean;
}

export interface BankAccountRecord {
  id: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  ifsc: string;
  branch: string;
  upiId: string;
  qrCodeUrl?: string;
  fundScope: string;
  openingBalance: number;
  currentBalance: number;
  instructions: string;
  isActive: boolean;
  isDemo: boolean;
}

export interface PaymentSubmissionRecord {
  id: string;
  memberId: string;
  memberCode: string;
  memberName: string;
  donorName?: string;
  paymentCategory?: 'monthly_contribution' | 'donation';
  amount: number;
  months: string[];
  bankAccountId: string | null;
  bankName: string | null;
  fundId: string;
  fundName?: string;
  utrReference: string;
  screenshotUrl: string;
  notes: string;
  status: 'pending_verification' | 'verified' | 'rejected';
  submittedAt: string;
  verifiedBy: string | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
  rejectionNote: string | null;
  linkedTxnNumber: string | null;
  receiptNumber?: string | null;
  bankVerifiedConfirmed?: boolean;
  isDuplicateUtr?: boolean;
  isDemo: boolean;
}

export interface CommitteeMemberRecord {
  id: string;
  roleKey: 'sadar' | 'secretary' | 'treasurer' | 'vice_president' | 'member';
  designationEn: string;
  designationHi: string;
  designationUr: string;
  fullName: string;
  phone: string;
  appointmentDate: string;
  termStart: string;
  termEnd: string;
  isActive: boolean;
  updatedByName: string;
  updatedAt: string;
  isDemo: boolean;
}

export interface MonthlyClosingRecord {
  monthKey: string;
  isLocked: boolean;
  totalIncome: number;
  totalExpense: number;
  outstandingContributions: number;
  pendingSalaries: number;
  closingBalance: number;
  closedAt: string | null;
  closedByName: string | null;
  reopenedAt: string | null;
  reopenedByName: string | null;
  reopenReason: string | null;
}

export interface AuditLogRecord {
  id: string;
  timestamp: string;
  adminId: string;
  adminName: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeData: string | null;
  afterData: string | null;
  reason: string;
}

export interface ReminderLogRecord {
  id: string;
  sentAt: string;
  sentByName: string;
  channel: 'app' | 'whatsapp' | 'sms';
  targetMemberId: string;
  targetMemberName: string;
  targetPhone: string;
  pendingMonths: string[];
  outstandingAmount: number;
  message: string;
  status: 'sent' | 'stopped_paid';
}

export interface NotificationRecord {
  id: string;
  type: string;
  title: string;
  message: string;
  createdAt: string;
  targetRole: 'all' | 'admin' | 'member';
  targetMemberId: string | null;
  isRead: boolean;
}

export interface LoginActivityRecord {
  id: string;
  userId: string;
  username: string;
  fullName: string;
  role: UserRole;
  status: 'success' | 'failed' | 'logout';
  ip: string;
  userAgent: string;
  timestamp: string;
}

export interface AppSettings {
  committeeName: string;
  committeeAddress: string;
  appLogoUrl?: string;
  defaultLanguage?: Language;
  memberLoginEnabled?: boolean;
  autoBackupEnabled?: boolean;
  dualApprovalEnabled: boolean;
  dualApprovalLimit: number;
  reminderDayOfMonth: number;
  reminderFrequency: 'monthly' | 'biweekly' | 'weekly';
  defaultMonthlyContribution: number;
  hideMemberPhonesForMembers: boolean;
  isDemoDataActive: boolean;
  lastBackupAt: string | null;
}

export interface AdminOverviewData {
  totalMembers: number;
  activeMembers: number;
  inactiveMembers: number;
  totalIncome: number;
  totalExpenses: number;
  availableBalance: number;
  bankBalance: number;
  cashBalance: number;
  monthlyCollection: number;
  monthlyExpenses: number;
  pendingPaymentsCount: number;
  pendingPaymentsAmount: number;
  totalOutstandingDues: number;
  pendingApprovalsCount: number;
  pendingApprovalsAmount: number;
  fundWiseBalances: FundSummary[];
  authorizedAdminsCount: number;
  maxAdminsAllowed: number;
  currentMonthKey: string;
  reconciliation: ReconciliationSummary;
}

export interface AdminRoleAccount {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  memberId: string | null;
  phone: string;
  isActive: boolean;
  createdAt: string;
}

export interface DashboardSummary {
  totalBankBalance: number;
  totalCashBalance: number;
  totalBalance: number;
  monthlyIncome: number;
  monthlyExpense: number;
  monthlyContributionsReceived: number;
  totalContributionsReceived: number;
  totalOutstandingContributions: number;
  outstandingMemberCount: number;
  totalPendingSalaries: number;
  masjidBalance: number;
  madrasaBalance: number;
  ramadanBalance: number;
  zakatBalance: number;
  fitraBalance: number;
  sadqaBalance: number;
  rabiUlAwwalBalance: number;
  jumaBalance: number;
  pendingApprovalsCount: number;
  pendingVerificationsCount: number;
  monthlyChart: {
    monthKey: string;
    label: string;
    income: number;
    expense: number;
  }[];
  currentMonthKey: string;
  reconciliation?: ReconciliationSummary;
}

export interface ReconciliationSummary {
  totalDebits: number;
  totalCredits: number;
  isBalanced: boolean;
  journalLineCount: number;
  physicalBankBalance: number;
  cashBalance: number;
  totalLiquidAssets: number;
  sumOfVirtualFunds: number;
  isReconciled: boolean;
}

export interface FinancialReportData {
  periodType: 'daily' | 'monthly' | 'quarterly' | 'yearly';
  periodLabel: string;
  startDate: string;
  endDate: string;
  totalIncome: number;
  totalExpense: number;
  netSurplus: number;
  totalMemberContributions: number;
  masjidIncome: number;
  masjidExpense: number;
  madrasaIncome: number;
  madrasaExpense: number;
  ramadanCollections: number;
  zakatCollections: number;
  fitraCollections: number;
  sadqaCollections: number;
  rabiUlAwwalCollections: number;
  jumaCollections: number;
  otherDonations: number;
  specialDonations: number;
  totalSalariesPaid: number;
  totalOutstandingSalaries: number;
  totalOutstandingContributions: number;
  openingBankBalance: number;
  closingBankBalance: number;
  closingCashBalance: number;
  fundBalances: FundSummary[];
  transactions: TransactionRecord[];
  isDemo: boolean;
}
