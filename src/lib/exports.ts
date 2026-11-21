import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type {
  FinancialReportData,
  FundSummary,
  MemberMonthRecord,
  MemberSummary,
  StaffSummary,
  TransactionRecord,
} from '../types';
import { COMMITTEE_TITLE, COMMITTEE_ADDRESS } from '../i18n/translations';

function formatPlainINR(val: number): string {
  const sign = val < 0 ? '-' : '';
  return `${sign}Rs. ${Math.abs(Math.round(val)).toLocaleString('en-IN')}`;
}

export function downloadFinancialReportPDF(report: FinancialReportData): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Official emerald header band
  doc.setFillColor(11, 79, 50);
  doc.rect(0, 0, pageWidth, 86, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(COMMITTEE_TITLE, pageWidth / 2, 32, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(COMMITTEE_ADDRESS, pageWidth / 2, 50, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text(
    `${report.periodLabel}${report.isDemo ? '  [DEMO DATA — NOT REAL COMMITTEE BALANCES]' : ''}`,
    pageWidth / 2,
    70,
    { align: 'center' }
  );

  doc.setTextColor(30, 41, 59);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Period: ${report.startDate} to ${report.endDate}`, 40, 108);
  doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, pageWidth - 40, 108, { align: 'right' });

  // Executive Summary Table
  autoTable(doc, {
    startY: 120,
    head: [['Financial Head', 'Amount (INR)']],
    body: [
      ['Total Verified Income', formatPlainINR(report.totalIncome)],
      ['Total Verified Expenditure', formatPlainINR(report.totalExpense)],
      ['Net Surplus / Deficit', formatPlainINR(report.netSurplus)],
      ['Total Member Contributions Received', formatPlainINR(report.totalMemberContributions)],
      ['Masjid Income / Expense', `${formatPlainINR(report.masjidIncome)} / ${formatPlainINR(report.masjidExpense)}`],
      ['Madrasa Income / Expense', `${formatPlainINR(report.madrasaIncome)} / ${formatPlainINR(report.madrasaExpense)}`],
      ['Ramadan Fund Collections', formatPlainINR(report.ramadanCollections)],
      ['Zakat / Fitra / Sadqa Collections', `${formatPlainINR(report.zakatCollections)} / ${formatPlainINR(report.fitraCollections)} / ${formatPlainINR(report.sadqaCollections)}`],
      ['Rabi-ul-Awwal / Juma Collections', `${formatPlainINR(report.rabiUlAwwalCollections)} / ${formatPlainINR(report.jumaCollections)}`],
      ['Total Imam & Teachers Salaries Paid', formatPlainINR(report.totalSalariesPaid)],
      ['Total Outstanding Salaries', formatPlainINR(report.totalOutstandingSalaries)],
      ['Total Outstanding Member Contributions', formatPlainINR(report.totalOutstandingContributions)],
      ['Opening Bank Balance / Closing Bank Balance', `${formatPlainINR(report.openingBankBalance)} / ${formatPlainINR(report.closingBankBalance)}`],
      ['Closing Cash-in-Hand Balance', formatPlainINR(report.closingCashBalance)],
    ],
    headStyles: { fillColor: [11, 79, 50], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [246, 248, 247] },
    styles: { fontSize: 8.5, cellPadding: 5 },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
  });

  // Fund-wise Closing Balances
  const afterSummaryY = (doc as any).lastAutoTable.finalY + 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Fund-Wise Accounting Balances (All 10 Separate Accounts)', 40, afterSummaryY);

  autoTable(doc, {
    startY: afterSummaryY + 8,
    head: [['Fund Account', 'Opening', 'Income', 'Expense', 'Transfers (Net)', 'Closing Balance']],
    body: report.fundBalances.map((f) => [
      f.nameEn,
      formatPlainINR(f.openingBalance),
      formatPlainINR(f.totalIncome),
      formatPlainINR(f.totalExpense),
      formatPlainINR(f.transfersIn - f.transfersOut),
      formatPlainINR(f.currentBalance),
    ]),
    headStyles: { fillColor: [15, 106, 68], textColor: 255 },
    styles: { fontSize: 8, cellPadding: 4 },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right', fontStyle: 'bold' },
    },
  });

  // Transactions Ledger (if present)
  if (report.transactions.length > 0) {
    doc.addPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`Verified Transactions Ledger (${report.transactions.length} entries)`, 40, 44);
    autoTable(doc, {
      startY: 54,
      head: [['Txn #', 'Date', 'Type', 'Fund', 'Category / Party', 'Method', 'Amount']],
      body: report.transactions.slice(0, 120).map((tx) => [
        tx.txnNumber,
        tx.date,
        tx.type.toUpperCase(),
        tx.fundName || tx.fundId,
        `${tx.category} — ${tx.partyName}`,
        tx.paymentMethod,
        formatPlainINR(tx.amount),
      ]),
      headStyles: { fillColor: [11, 79, 50], textColor: 255 },
      styles: { fontSize: 7.5, cellPadding: 3.5 },
      columnStyles: { 6: { halign: 'right', fontStyle: 'bold' } },
    });
  }

  // Signature Footer on final page
  const finalY = Math.min((doc as any).lastAutoTable.finalY + 46, doc.internal.pageSize.getHeight() - 60);
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text('_______________________', 50, finalY);
  doc.text('Sadar (President)', 72, finalY + 14);
  doc.text('_______________________', pageWidth / 2 - 55, finalY);
  doc.text('Secretary', pageWidth / 2 - 20, finalY + 14);
  doc.text('_______________________', pageWidth - 165, finalY);
  doc.text('Treasurer (Khazanchi)', pageWidth - 150, finalY + 14);

  const safeName = report.periodLabel.replace(/[^a-zA-Z0-9_-]+/g, '_');
  doc.save(`SGN_Committee_${safeName}.pdf`);
}

export function downloadFinancialReportExcel(report: FinancialReportData): void {
  const wb = XLSX.utils.book_new();

  const summaryRows = [
    ['Organization', COMMITTEE_TITLE],
    ['Address', COMMITTEE_ADDRESS],
    ['Report Period', report.periodLabel],
    ['Data Mode', report.isDemo ? 'DEMO DATA' : 'LIVE OFFICIAL ACCOUNTS'],
    [],
    ['Metric', 'Amount (INR)'],
    ['Total Verified Income', report.totalIncome],
    ['Total Verified Expenditure', report.totalExpense],
    ['Net Surplus / Deficit', report.netSurplus],
    ['Total Member Contributions', report.totalMemberContributions],
    ['Masjid Income', report.masjidIncome],
    ['Masjid Expense', report.masjidExpense],
    ['Madrasa Income', report.madrasaIncome],
    ['Madrasa Expense', report.madrasaExpense],
    ['Ramadan Collections', report.ramadanCollections],
    ['Zakat Collections', report.zakatCollections],
    ['Fitra Collections', report.fitraCollections],
    ['Sadqa Collections', report.sadqaCollections],
    ['Rabi-ul-Awwal Collections', report.rabiUlAwwalCollections],
    ['Juma Collections', report.jumaCollections],
    ['Other Donations', report.otherDonations],
    ['Special Donations', report.specialDonations],
    ['Total Salaries Paid', report.totalSalariesPaid],
    ['Total Outstanding Salaries', report.totalOutstandingSalaries],
    ['Total Outstanding Contributions', report.totalOutstandingContributions],
    ['Opening Bank Balance', report.openingBankBalance],
    ['Closing Bank Balance', report.closingBankBalance],
    ['Closing Cash Balance', report.closingCashBalance],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  const fundRows = report.fundBalances.map((f) => ({
    'Fund Code': f.code,
    'Fund Account': f.nameEn,
    Scope: f.scope,
    Restricted: f.isRestricted ? 'Yes' : 'No',
    'Opening Balance (INR)': f.openingBalance,
    'Total Income (INR)': f.totalIncome,
    'Total Expense (INR)': f.totalExpense,
    'Transfers In (INR)': f.transfersIn,
    'Transfers Out (INR)': f.transfersOut,
    'Closing Balance (INR)': f.currentBalance,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(fundRows), 'Fund Balances');

  const txnRows = report.transactions.map((tx) => ({
    'Transaction No': tx.txnNumber,
    Date: tx.date,
    Type: tx.type,
    Fund: tx.fundName || tx.fundId,
    Category: tx.category,
    Party: tx.partyName,
    Method: tx.paymentMethod,
    'Amount (INR)': tx.amount,
    Status: tx.status,
    'Entered By': tx.createdByName,
    'Approved By': tx.approvedByName || '-',
    Description: tx.description,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(txnRows), 'Transactions');

  const safeName = report.periodLabel.replace(/[^a-zA-Z0-9_-]+/g, '_');
  XLSX.writeFile(wb, `SGN_Committee_${safeName}.xlsx`);
}

export function downloadMemberReceiptPDF(member: MemberSummary, record: MemberMonthRecord): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a5' });
  const w = doc.internal.pageSize.getWidth();

  doc.setFillColor(11, 79, 50);
  doc.rect(0, 0, w, 78, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text(COMMITTEE_TITLE, w / 2, 28, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(COMMITTEE_ADDRESS, w / 2, 44, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('OFFICIAL MONTHLY CONTRIBUTION RECEIPT', w / 2, 64, { align: 'center' });

  doc.setTextColor(15, 23, 42);
  autoTable(doc, {
    startY: 96,
    theme: 'grid',
    headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42] },
    body: [
      ['Receipt / Transaction No.', record.txnNumber || 'Verified Entry'],
      ['Payment Date', record.paidDate || '-'],
      ['Member Name', member.fullName],
      ['Member ID', member.memberCode],
      ['Village / Address', member.village],
      ['Contribution Month', record.monthKey],
      ['Payment Method', record.paymentMethod || 'Cash'],
      ['Amount Received', formatPlainINR(record.paid)],
      ['Member Total Paid (YTD)', formatPlainINR(member.totalPaid)],
      ['Member Remaining Balance', formatPlainINR(member.outstandingAmount)],
    ],
    styles: { fontSize: 9, cellPadding: 7 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 150 } },
  });

  const y = (doc as any).lastAutoTable.finalY + 28;
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(
    'JazakAllah Khair for supporting Noori Jama Masjid & Madarsa Anwarool Uloom, Ragdih.',
    w / 2,
    y,
    { align: 'center' }
  );
  if (member.isDemo) {
    doc.setTextColor(180, 83, 9);
    doc.text('Note: Generated in DEMO mode for demonstration purposes.', w / 2, y + 16, { align: 'center' });
  }

  doc.save(`Receipt_${member.memberCode}_${record.monthKey}.pdf`);
}

export function downloadDonationReceiptPDF(
  submission: {
    receiptNumber?: string | null;
    linkedTxnNumber?: string | null;
    memberName: string;
    memberCode: string;
    amount: number;
    fundId: string;
    fundName?: string;
    paymentCategory?: 'monthly_contribution' | 'donation';
    utrReference: string;
    submittedAt: string;
    verifiedAt?: string | null;
    verifiedByName?: string | null;
    months?: string[];
    isDemo?: boolean;
  },
  resolvedFundName?: string
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a5' });
  const w = doc.internal.pageSize.getWidth();

  doc.setFillColor(11, 79, 50);
  doc.rect(0, 0, w, 84, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text(COMMITTEE_TITLE, w / 2, 26, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(COMMITTEE_ADDRESS, w / 2, 42, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('OFFICIAL VERIFIED UPI PAYMENT RECEIPT', w / 2, 66, { align: 'center' });

  const receiptNo = submission.receiptNumber || submission.linkedTxnNumber || 'VERIFIED-RCPT';
  const paidDate = (submission.verifiedAt || submission.submittedAt || '').slice(0, 10) || '-';
  const fundLabel = resolvedFundName || submission.fundName || submission.fundId;
  const purposeLabel =
    submission.paymentCategory === 'donation'
      ? `Fund Donation (${fundLabel})`
      : `Monthly Committee Contribution (${(submission.months || []).join(', ') || 'Monthly'})`;

  doc.setTextColor(15, 23, 42);
  autoTable(doc, {
    startY: 100,
    theme: 'grid',
    body: [
      ['Receipt Number', receiptNo],
      ['Ledger Transaction No.', submission.linkedTxnNumber || '-'],
      ['Payment / Verified Date', paidDate],
      ['Member / Donor Name', submission.memberName],
      ['Member ID', submission.memberCode],
      ['Donation Fund', fundLabel],
      ['Payment Purpose', purposeLabel],
      ['UPI Transaction ID / UTR', submission.utrReference],
      ['Verified Amount Received', formatPlainINR(submission.amount)],
      ['Verified Against Bank By', submission.verifiedByName || 'Authorized Committee Admin'],
    ],
    styles: { fontSize: 9, cellPadding: 6.5 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 145 } },
  });

  const y = (doc as any).lastAutoTable.finalY + 24;
  doc.setFontSize(8.5);
  doc.setTextColor(11, 79, 50);
  doc.setFont('helvetica', 'bold');
  doc.text('STATUS: BANK STATEMENT VERIFIED & POSTED TO OFFICIAL LEDGER', w / 2, y, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(
    'JazakAllah Khair for supporting Noori Jama Masjid & Madarsa Anwarool Uloom, Ragdih.',
    w / 2,
    y + 18,
    { align: 'center' }
  );
  if (submission.isDemo) {
    doc.setTextColor(180, 83, 9);
    doc.text('Note: Generated in DEMO mode for demonstration purposes.', w / 2, y + 34, { align: 'center' });
  }

  doc.save(`Official_Receipt_${receiptNo.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`);
}

function addOfficialPdfHeader(doc: jsPDF, subtitle: string): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(11, 79, 50);
  doc.rect(0, 0, pageWidth, 82, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13.5);
  doc.text(COMMITTEE_TITLE, pageWidth / 2, 28, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(COMMITTEE_ADDRESS, pageWidth / 2, 46, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text(subtitle, pageWidth / 2, 66, { align: 'center' });
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, pageWidth - 40, 98, { align: 'right' });
}

export function downloadMemberWiseReportPDF(members: MemberSummary[]): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  addOfficialPdfHeader(doc, 'MEMBER-WISE CONTRIBUTION & STATUS REPORT');
  autoTable(doc, {
    startY: 110,
    head: [['ID', 'Member Name', 'Address / Village', 'Monthly Fee', 'Status', 'Expected', 'Total Paid', 'Pending Due', 'Pending Months']],
    body: members.map((m) => [
      m.memberCode,
      m.fullName,
      m.village || '-',
      formatPlainINR(m.monthlyAmount),
      m.status.toUpperCase(),
      formatPlainINR(m.totalExpected),
      formatPlainINR(m.totalPaid),
      formatPlainINR(m.outstandingAmount),
      String(m.pendingMonthsCount),
    ]),
    headStyles: { fillColor: [11, 79, 50], textColor: 255 },
    alternateRowStyles: { fillColor: [246, 248, 247] },
    styles: { fontSize: 8, cellPadding: 4.5 },
  });
  doc.save(`SGN_Member_Wise_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function downloadMemberWiseReportExcel(members: MemberSummary[]): void {
  const wb = XLSX.utils.book_new();
  const rows = members.map((m) => ({
    'Member ID': m.memberCode,
    'Full Name': m.fullName,
    Phone: m.phone,
    'Address / Village': m.village,
    'Monthly Contribution (INR)': m.monthlyAmount,
    Status: m.status,
    'Joining Date': m.joiningDate,
    'Total Expected (INR)': m.totalExpected,
    'Total Paid (INR)': m.totalPaid,
    'Outstanding Due (INR)': m.outstandingAmount,
    'Pending Months': m.pendingMonthsCount,
    'Pending Since': m.pendingSince || '-',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Member Wise Report');
  XLSX.writeFile(wb, `SGN_Member_Wise_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function downloadFundWiseReportPDF(funds: FundSummary[]): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  addOfficialPdfHeader(doc, 'FUND-WISE LEDGER & BALANCE REPORT');
  autoTable(doc, {
    startY: 110,
    head: [['Code', 'Fund Name', 'Scope', 'Status', 'Opening', 'Total Income', 'Total Expense', 'Net Transfers', 'Available Balance']],
    body: funds.map((f) => [
      f.code,
      f.nameEn,
      f.scope.toUpperCase(),
      f.isActive === false ? 'INACTIVE' : 'ACTIVE',
      formatPlainINR(f.openingBalance),
      formatPlainINR(f.totalIncome),
      formatPlainINR(f.totalExpense),
      formatPlainINR(f.transfersIn - f.transfersOut),
      formatPlainINR(f.currentBalance),
    ]),
    headStyles: { fillColor: [11, 79, 50], textColor: 255 },
    alternateRowStyles: { fillColor: [246, 248, 247] },
    styles: { fontSize: 8, cellPadding: 4.5 },
  });
  doc.save(`SGN_Fund_Wise_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function downloadFundWiseReportExcel(funds: FundSummary[]): void {
  const wb = XLSX.utils.book_new();
  const rows = funds.map((f) => ({
    Code: f.code,
    'Fund Name (EN)': f.nameEn,
    'Fund Name (HI)': f.nameHi,
    Scope: f.scope,
    Restricted: f.isRestricted ? 'Yes' : 'No',
    Status: f.isActive === false ? 'Inactive' : 'Active',
    'Opening Balance (INR)': f.openingBalance,
    'Total Income (INR)': f.totalIncome,
    'Total Expense (INR)': f.totalExpense,
    'Transfers In (INR)': f.transfersIn,
    'Transfers Out (INR)': f.transfersOut,
    'Current Balance (INR)': f.currentBalance,
    'Transactions Count': f.transactionCount,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Fund Wise Report');
  XLSX.writeFile(wb, `SGN_Fund_Wise_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function downloadIncomeExpenseReportPDF(transactions: TransactionRecord[]): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  addOfficialPdfHeader(doc, 'COMPLETE INCOME & EXPENSE LEDGER REPORT');
  autoTable(doc, {
    startY: 110,
    head: [['Txn #', 'Date', 'Type', 'Fund', 'Category', 'Party', 'Method', 'Amount', 'Status', 'Entered By']],
    body: transactions.map((tx) => [
      tx.txnNumber,
      tx.date,
      tx.type.toUpperCase(),
      tx.fundName || tx.fundId,
      tx.category,
      tx.partyName,
      tx.paymentMethod,
      formatPlainINR(tx.amount),
      tx.status.toUpperCase(),
      tx.createdByName,
    ]),
    headStyles: { fillColor: [11, 79, 50], textColor: 255 },
    alternateRowStyles: { fillColor: [246, 248, 247] },
    styles: { fontSize: 7.5, cellPadding: 3.5 },
  });
  doc.save(`SGN_Income_Expense_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function downloadIncomeExpenseReportExcel(transactions: TransactionRecord[]): void {
  const wb = XLSX.utils.book_new();
  const rows = transactions.map((tx) => ({
    'Txn No': tx.txnNumber,
    Date: tx.date,
    Type: tx.type,
    Fund: tx.fundName || tx.fundId,
    Category: tx.category,
    Party: tx.partyName,
    Method: tx.paymentMethod,
    'Amount (INR)': tx.amount,
    Status: tx.status,
    'Entered By': tx.createdByName,
    'Approved By': tx.approvedByName || '-',
    Description: tx.description,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Income & Expense');
  XLSX.writeFile(wb, `SGN_Income_Expense_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function downloadSalaryReportPDF(staff: StaffSummary[]): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  addOfficialPdfHeader(doc, 'IMAM & MADRASA TEACHERS SALARY REPORT');
  autoTable(doc, {
    startY: 110,
    head: [['Name', 'Designation', 'Institution', 'Monthly Salary', 'Status', 'Total Payable', 'Total Paid', 'Pending Salary', 'Pending Months']],
    body: staff.map((s) => [
      s.name,
      s.designation,
      s.institution.toUpperCase(),
      formatPlainINR(s.monthlySalary),
      s.status.toUpperCase(),
      formatPlainINR(s.totalPayable),
      formatPlainINR(s.totalPaid),
      formatPlainINR(s.totalPending),
      s.pendingMonths.join(', ') || 'Cleared',
    ]),
    headStyles: { fillColor: [11, 79, 50], textColor: 255 },
    alternateRowStyles: { fillColor: [246, 248, 247] },
    styles: { fontSize: 8, cellPadding: 4.5 },
  });
  doc.save(`SGN_Salary_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function downloadSalaryReportExcel(staff: StaffSummary[]): void {
  const wb = XLSX.utils.book_new();
  const rows = staff.map((s) => ({
    Name: s.name,
    Designation: s.designation,
    Institution: s.institution,
    'Monthly Salary (INR)': s.monthlySalary,
    'Joining Date': s.joiningDate,
    Status: s.status,
    'Total Payable (INR)': s.totalPayable,
    'Total Paid (INR)': s.totalPaid,
    'Total Pending (INR)': s.totalPending,
    'Pending Months': s.pendingMonths.join(', ') || '-',
    'Max Pending Days': s.maxPendingDays,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Salary Report');
  XLSX.writeFile(wb, `SGN_Salary_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function downloadPendingDuesReportPDF(members: MemberSummary[]): void {
  const pendingMembers = members.filter((m) => m.outstandingAmount > 0);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  addOfficialPdfHeader(doc, `PENDING DUES REPORT (${pendingMembers.length} MEMBERS)`);
  autoTable(doc, {
    startY: 110,
    head: [['Member ID', 'Member Name', 'Address / Village', 'Monthly Fee', 'Pending Months', 'Pending Since', 'Total Outstanding']],
    body: pendingMembers.map((m) => [
      m.memberCode,
      m.fullName,
      m.village || '-',
      formatPlainINR(m.monthlyAmount),
      String(m.pendingMonthsCount),
      m.pendingSince || '-',
      formatPlainINR(m.outstandingAmount),
    ]),
    headStyles: { fillColor: [180, 83, 9], textColor: 255 },
    alternateRowStyles: { fillColor: [255, 251, 235] },
    styles: { fontSize: 8.5, cellPadding: 4.5 },
  });
  doc.save(`SGN_Pending_Dues_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function downloadPendingDuesReportExcel(members: MemberSummary[]): void {
  const pendingMembers = members.filter((m) => m.outstandingAmount > 0);
  const wb = XLSX.utils.book_new();
  const rows = pendingMembers.map((m) => ({
    'Member ID': m.memberCode,
    'Full Name': m.fullName,
    Phone: m.phone,
    'Address / Village': m.village,
    'Monthly Fee (INR)': m.monthlyAmount,
    'Pending Months Count': m.pendingMonthsCount,
    'Pending Months List': m.pendingMonths.join(', '),
    'Pending Since': m.pendingSince || '-',
    'Outstanding Amount (INR)': m.outstandingAmount,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Pending Dues');
  XLSX.writeFile(wb, `SGN_Pending_Dues_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
