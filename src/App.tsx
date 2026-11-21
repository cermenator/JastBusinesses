import React, { useMemo, useState } from 'react';
import {
  Building2,
  ShieldCheck,
  PlusCircle,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  Lock,
  Layers,
  TrendingUp,
  AlertTriangle,
  History,
  Download,
} from 'lucide-react';
import {
  AuditLogEntry,
  BusinessId,
  TransactionRecord,
  UserAccount,
} from './types/erp';
import {
  BUSINESS_UNITS,
  DEMO_USERS,
  INITIAL_AUDIT_LOGS,
  INITIAL_TRANSACTIONS,
} from './lib/seedData';
import { SixStepPipelineModal } from './components/SixStepPipelineModal';

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserAccount>(DEMO_USERS[0]);
  const [selectedBusinessFilter, setSelectedBusinessFilter] = useState<BusinessId | 'ALL'>('ALL');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'approvals' | 'ledger' | 'audit'>('dashboard');
  const [transactions, setTransactions] = useState<TransactionRecord[]>(INITIAL_TRANSACTIONS);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(INITIAL_AUDIT_LOGS);
  const [showPipelineModal, setShowPipelineModal] = useState(false);

  // Enforce PostgreSQL Row-Level Security (RLS) simulation in UI
  const rlsVisibleTransactions = useMemo(() => {
    if (currentUser.role === 'owner') {
      if (selectedBusinessFilter === 'ALL') return transactions;
      return transactions.filter((t) => t.businessId === selectedBusinessFilter);
    }
    return transactions.filter((t) => t.businessId === currentUser.businessId);
  }, [transactions, currentUser, selectedBusinessFilter]);

  const rlsVisibleAuditLogs = useMemo(() => {
    if (currentUser.role === 'owner') {
      if (selectedBusinessFilter === 'ALL') return auditLogs;
      return auditLogs.filter((l) => l.businessId === selectedBusinessFilter);
    }
    return auditLogs.filter((l) => l.businessId === currentUser.businessId);
  }, [auditLogs, currentUser, selectedBusinessFilter]);

  const pendingApprovals = useMemo(
    () => rlsVisibleTransactions.filter((t) => t.status === 'PENDING_APPROVAL'),
    [rlsVisibleTransactions]
  );

  // Aggregate financial KPIs
  const metrics = useMemo(() => {
    const approved = rlsVisibleTransactions.filter((t) => t.status === 'APPROVED');
    const totalIncome = approved
      .filter((t) => t.txType === 'INCOME')
      .reduce((acc, t) => acc + t.amount, 0);
    const totalExpense = approved
      .filter((t) => t.txType !== 'INCOME')
      .reduce((acc, t) => acc + t.amount, 0);
    const netCashFlow = totalIncome - totalExpense;
    const totalVat = approved.reduce((acc, t) => acc + t.vatAmount, 0);

    const byBusiness = BUSINESS_UNITS.map((unit) => {
      const unitTxs = approved.filter((t) => t.businessId === unit.id);
      const rev = unitTxs.filter((t) => t.txType === 'INCOME').reduce((a, b) => a + b.amount, 0);
      const exp = unitTxs.filter((t) => t.txType !== 'INCOME').reduce((a, b) => a + b.amount, 0);
      return {
        ...unit,
        revenue: rev,
        expenses: exp,
        net: rev - exp,
        count: unitTxs.length,
      };
    });

    return { totalIncome, totalExpense, netCashFlow, totalVat, byBusiness };
  }, [rlsVisibleTransactions]);

  const handleRoleSwitch = (userId: string) => {
    const found = DEMO_USERS.find((u) => u.id === userId)!;
    setCurrentUser(found);
    setSelectedBusinessFilter(found.businessId || 'ALL');
    if (found.role !== 'owner' && activeTab === 'approvals') {
      setActiveTab('ledger');
    }
  };

  const handleAddTransaction = (newTx: Omit<TransactionRecord, 'id' | 'createdAt'>) => {
    const id = `tx-${Date.now()}`;
    const created: TransactionRecord = {
      ...newTx,
      id,
      createdAt: new Date().toISOString(),
    };
    setTransactions((prev) => [created, ...prev]);
    setAuditLogs((prev) => [
      {
        id: prev.length + 1,
        transactionId: id,
        referenceNo: created.referenceNo,
        businessId: created.businessId,
        action: 'INSERT',
        actorName: currentUser.name,
        oldStatus: null,
        newStatus: created.status,
        amount: created.amount,
        remarks: created.gateReason,
        recordedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
      },
      ...prev,
    ]);
  };

  const handleOwnerDecision = (tx: TransactionRecord, decision: 'APPROVED' | 'REJECTED') => {
    if (currentUser.role !== 'owner') return;
    setTransactions((prev) =>
      prev.map((item) =>
        item.id === tx.id
          ? {
              ...item,
              status: decision,
              approvedBy: currentUser.name,
              gateReason:
                decision === 'APPROVED'
                  ? `Authorized by ${currentUser.name}`
                  : `Rejected at Owner Gate by ${currentUser.name}`,
            }
          : item
      )
    );
    setAuditLogs((prev) => [
      {
        id: prev.length + 1,
        transactionId: tx.id,
        referenceNo: tx.referenceNo,
        businessId: tx.businessId,
        action: decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
        actorName: currentUser.name,
        oldStatus: 'PENDING_APPROVAL',
        newStatus: decision,
        amount: tx.amount,
        remarks:
          decision === 'APPROVED'
            ? 'Owner Gate cleared after digital receipt verification'
            : 'Flagged & rejected during Owner review',
        recordedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
      },
      ...prev,
    ]);
  };

  const handleExportBirCsv = () => {
    const headers = [
      'Reference_No',
      'Business_Unit',
      'Date',
      'Type',
      'Category',
      'Counterparty_TIN',
      'Counterparty_Name',
      'Gross_Amount_PHP',
      'VAT_12Pct_PHP',
      'Status',
      'Receipt_File',
    ];
    const rows = rlsVisibleTransactions.map((t) => [
      t.referenceNo,
      t.businessId.toUpperCase(),
      t.txDate,
      t.txType,
      `"${t.category}"`,
      t.counterpartyTin || '',
      `"${t.counterpartyName}"`,
      t.amount.toFixed(2),
      t.vatAmount.toFixed(2),
      t.status,
      t.receiptFilename || '',
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `JAST_BIR_CAS_Ledger_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top Enterprise Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-slate-900 text-white shadow-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 font-bold text-white shadow-inner">
              JB
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight">JAST Business Ventures ERP</h1>
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 border border-emerald-500/30">
                  BIR CAS & RLS Ready
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Centralized Multi-Entity Financial Governance • Real Estate • Pickleball • Jewelry
              </p>
            </div>
          </div>

          {/* Role & RLS Simulator Switcher */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl bg-slate-800 px-3 py-1.5 border border-slate-700">
              <Lock className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-xs text-slate-300">Active Role (RLS):</span>
              <select
                value={currentUser.id}
                onChange={(e) => handleRoleSwitch(e.target.value)}
                className="bg-transparent text-xs font-semibold text-white focus:outline-none"
              >
                {DEMO_USERS.map((u) => (
                  <option key={u.id} value={u.id} className="bg-slate-900 text-white">
                    {u.name} ({u.role.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => setShowPipelineModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-indigo-500 transition"
            >
              <PlusCircle className="h-4 w-4" /> New 6-Step Entry
            </button>
          </div>
        </div>

        {/* Sub-Navigation & Business Tenant Filter */}
        <div className="border-t border-slate-800 bg-slate-900/95">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6">
            <nav className="flex items-center gap-1">
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  activeTab === 'dashboard'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                Centralized Owner Dashboard
              </button>
              {currentUser.role === 'owner' && (
                <button
                  onClick={() => setActiveTab('approvals')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    activeTab === 'approvals'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  Owner Approval Gate
                  {pendingApprovals.length > 0 && (
                    <span className="rounded-full bg-amber-500 px-1.5 py-0.2 text-[10px] font-bold text-slate-950">
                      {pendingApprovals.length}
                    </span>
                  )}
                </button>
              )}
              <button
                onClick={() => setActiveTab('ledger')}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  activeTab === 'ledger'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                Unified Transaction Ledger
              </button>
              <button
                onClick={() => setActiveTab('audit')}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  activeTab === 'audit'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                Immutable Audit Trail
              </button>
            </nav>

            {/* Tenant Scope Indicator */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">Tenant Scope:</span>
              {currentUser.role === 'owner' ? (
                <select
                  value={selectedBusinessFilter}
                  onChange={(e) => setSelectedBusinessFilter(e.target.value as BusinessId | 'ALL')}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-white"
                >
                  <option value="ALL">All JAST Ventures (Consolidated)</option>
                  {BUSINESS_UNITS.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 border border-amber-500/30 px-2.5 py-1 text-xs font-semibold text-amber-300">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  RLS Isolated: {BUSINESS_UNITS.find((b) => b.id === currentUser.businessId)?.name}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-6">
        {/* RLS Isolation Notice for Branch Staff */}
        {currentUser.role !== 'owner' && (
          <div className="flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-xs text-indigo-950">
            <div className="flex items-center gap-2.5">
              <Lock className="h-4 w-4 text-indigo-600 shrink-0" />
              <span>
                <strong>Data Privacy Act (RA 10173) & PostgreSQL RLS Active:</strong> You are logged in as{' '}
                <strong>{currentUser.name}</strong>. Records belonging to sister ventures are strictly isolated at the database layer.
              </span>
            </div>
          </div>
        )}

        {/* TAB 1: CENTRALIZED OWNER DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* Top KPI Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>CONSOLIDATED GROSS REVENUE</span>
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                </div>
                <p className="mt-2 text-2xl font-bold text-slate-900">
                  ₱{metrics.totalIncome.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </p>
                <p className="mt-1 text-xs text-emerald-600 font-medium">Cleared & Owner-verified inflows</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>APPROVED DISBURSEMENTS</span>
                  <Layers className="h-4 w-4 text-slate-600" />
                </div>
                <p className="mt-2 text-2xl font-bold text-slate-900">
                  ₱{metrics.totalExpense.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </p>
                <p className="mt-1 text-xs text-slate-500">Operational & capital outflows</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>NET CONSOLIDATED CASH FLOW</span>
                  <Building2 className="h-4 w-4 text-indigo-600" />
                </div>
                <p className="mt-2 text-2xl font-bold text-indigo-700">
                  ₱{metrics.netCashFlow.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Est. 12% VAT Output/Input: ₱{metrics.totalVat.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </p>
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 shadow-sm">
                <div className="flex items-center justify-between text-xs font-semibold text-amber-800">
                  <span>OWNER GATE QUEUE</span>
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                </div>
                <p className="mt-2 text-2xl font-bold text-amber-950">{pendingApprovals.length} Pending</p>
                <p className="mt-1 text-xs text-amber-800">
                  Items &gt; ₱30,000 or Jewelry write-offs
                </p>
              </div>
            </div>

            {/* Cross-Business Venture Comparison (Owner View) */}
            {currentUser.role === 'owner' && (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      Cross-Business Performance Comparison (JAST Ventures)
                    </h2>
                    <p className="text-xs text-slate-500">
                      Real-time segregated entity metrics aggregated into a single executive view
                    </p>
                  </div>
                  <button
                    onClick={handleExportBirCsv}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Download className="h-3.5 w-3.5" /> Export BIR E-Invoicing CSV
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  {metrics.byBusiness.map((b) => (
                    <div key={b.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="rounded-md bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">
                          {b.code}
                        </span>
                        <span className="text-xs text-slate-500">{b.count} cleared entries</span>
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900 text-sm">{b.name}</h3>
                        <p className="text-xs text-slate-500 line-clamp-1">{b.description}</p>
                      </div>
                      <div className="space-y-1 border-t border-slate-200 pt-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-600">Cleared Revenue:</span>
                          <span className="font-semibold text-emerald-700">
                            ₱{b.revenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">Cleared Expenses:</span>
                          <span className="font-semibold text-rose-700">
                            ₱{b.expenses.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className="flex justify-between pt-1 border-t border-slate-200 font-bold text-slate-900">
                          <span>Net Branch Position:</span>
                          <span>₱{b.net.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pending Owner Gate Quick Action Panel */}
            {currentUser.role === 'owner' && pendingApprovals.length > 0 && (
              <div className="rounded-2xl border border-amber-200 bg-white p-6 shadow-sm">
                <h2 className="text-base font-bold text-slate-900 mb-1">
                  Owner Gate Checkpoints Requiring Executive Sign-Off
                </h2>
                <p className="text-xs text-slate-500 mb-4">
                  Transactions intercepted by PostgreSQL trigger rules before final ledger commit.
                </p>
                <div className="space-y-3">
                  {pendingApprovals.map((tx) => (
                    <div
                      key={tx.id}
                      className="flex flex-col justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50/40 p-4 sm:flex-row sm:items-center"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">
                            {tx.referenceNo}
                          </span>
                          <span className="text-xs font-bold text-amber-800">{tx.gateReason}</span>
                        </div>
                        <p className="text-sm font-semibold text-slate-900">
                          {tx.counterpartyName} — {tx.description}
                        </p>
                        <p className="text-xs text-slate-500">
                          Submitted by {tx.submittedBy} • Receipt: <code>{tx.receiptFilename}</code>
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-base font-bold text-slate-900">
                          ₱{tx.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                        </span>
                        <button
                          onClick={() => handleOwnerDecision(tx, 'APPROVED')}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          <CheckCircle className="h-3.5 w-3.5" /> Approve
                        </button>
                        <button
                          onClick={() => handleOwnerDecision(tx, 'REJECTED')}
                          className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
                        >
                          <XCircle className="h-3.5 w-3.5" /> Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: OWNER APPROVAL GATE */}
        {activeTab === 'approvals' && currentUser.role === 'owner' && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Owner Approval Gate Queue</h2>
              <p className="text-xs text-slate-500">
                High-value disbursements (&gt; ₱30,000) and sensitive Jewelry vault write-offs held for authorization.
              </p>
            </div>
            {pendingApprovals.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
                All Owner Gate checkpoints are currently cleared.
              </div>
            ) : (
              <div className="space-y-3">
                {pendingApprovals.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-indigo-700">{tx.referenceNo}</span>
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                          {tx.gateReason}
                        </span>
                      </div>
                      <p className="text-sm font-bold text-slate-900">{tx.description}</p>
                      <p className="text-xs text-slate-500">
                        Counterparty: {tx.counterpartyName} (TIN: {tx.counterpartyTin}) • Staff: {tx.submittedBy}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-base font-bold text-slate-900">
                        ₱{tx.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </span>
                      <button
                        onClick={() => handleOwnerDecision(tx, 'APPROVED')}
                        className="rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        Approve Entry
                      </button>
                      <button
                        onClick={() => handleOwnerDecision(tx, 'REJECTED')}
                        className="rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-700"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: UNIFIED TRANSACTION LEDGER */}
        {activeTab === 'ledger' && (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">Unified Financial Transaction Ledger</h2>
                <p className="text-xs text-slate-500">
                  Showing {rlsVisibleTransactions.length} RLS-authorized records
                </p>
              </div>
              <button
                onClick={handleExportBirCsv}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" /> Export BIR CAS CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 uppercase">
                  <tr>
                    <th className="px-4 py-3">Ref No.</th>
                    <th className="px-4 py-3">Venture</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Counterparty & Particulars</th>
                    <th className="px-4 py-3">Receipt</th>
                    <th className="px-4 py-3 text-right">Amount (PHP)</th>
                    <th className="px-4 py-3">Gate Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {rlsVisibleTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono font-semibold text-slate-800">{tx.referenceNo}</td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
                          {BUSINESS_UNITS.find((b) => b.id === tx.businessId)?.code}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{tx.txDate}</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900">{tx.counterpartyName}</p>
                        <p className="text-slate-500">{tx.description}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-indigo-600">
                        <span className="inline-flex items-center gap-1">
                          <FileText className="h-3.5 w-3.5" /> {tx.receiptFilename}
                        </span>
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-bold ${
                          tx.txType === 'INCOME' ? 'text-emerald-700' : 'text-slate-900'
                        }`}
                      >
                        {tx.txType === 'INCOME' ? '+' : '-'}₱
                        {tx.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3">
                        {tx.status === 'APPROVED' && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 font-semibold text-emerald-800">
                            <CheckCircle className="h-3 w-3" /> APPROVED
                          </span>
                        )}
                        {tx.status === 'PENDING_APPROVAL' && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 font-semibold text-amber-800">
                            <Clock className="h-3 w-3" /> PENDING GATE
                          </span>
                        )}
                        {tx.status === 'REJECTED' && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 font-semibold text-rose-800">
                            <XCircle className="h-3 w-3" /> REJECTED
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: IMMUTABLE SYSTEM AUDIT TRAIL */}
        {activeTab === 'audit' && (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-200 px-6 py-4">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-indigo-600" />
                <h2 className="text-base font-bold text-slate-900">
                  Immutable Chronological System Audit Trail (BIR RMO 1-2020)
                </h2>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Append-only PostgreSQL trigger ledger recording every insert, approval, and rejection.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 uppercase">
                  <tr>
                    <th className="px-4 py-3">Log ID</th>
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">Ref No.</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Actor</th>
                    <th className="px-4 py-3">Transition</th>
                    <th className="px-4 py-3">Audit Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {rlsVisibleAuditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-slate-500">#{log.id}</td>
                      <td className="px-4 py-3 font-mono text-slate-600">{log.recordedAt}</td>
                      <td className="px-4 py-3 font-mono font-semibold text-slate-900">{log.referenceNo}</td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-indigo-50 px-2 py-0.5 font-bold text-indigo-700">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800">{log.actorName}</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-600">
                        {log.oldStatus ? `${log.oldStatus} → ${log.newStatus}` : `NEW → ${log.newStatus}`}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{log.remarks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {showPipelineModal && (
        <SixStepPipelineModal
          currentUser={currentUser}
          onClose={() => setShowPipelineModal(false)}
          onSubmitTransaction={handleAddTransaction}
        />
      )}
    </div>
  );
}
