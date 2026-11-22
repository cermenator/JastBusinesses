import React, { useEffect, useMemo, useState } from 'react';
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
  PackageOpen,
  LogOut,
  Menu,
  Bell,
  ChevronDown,
  BarChart3,
  ReceiptText,
  PieChart,
  Plus,
  Upload,
  Users,
  FileBarChart,
  Gem,
  Home,
  CircleDollarSign,
} from 'lucide-react';
import { Session } from '@supabase/supabase-js';
import {
  AuditLogEntry,
  BusinessId,
  TransactionRecord,
  UserAccount,
} from './types/erp';
import {
  BUSINESS_UNITS,
  DEMO_USERS,
} from './lib/seedData';
import { SixStepPipelineModal } from './components/SixStepPipelineModal';
import { OperationsDashboard } from './components/OperationsDashboard';
import { SupabaseLogin } from './components/SupabaseLogin';
import { LegacyDataImport } from './components/LegacyDataImport';
import { ReportsAnalytics } from './components/ReportsAnalytics';
import { isSupabaseConfigured, supabase } from './lib/supabaseClient';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [accountLoading, setAccountLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserAccount>(DEMO_USERS[0]);
  const [selectedBusinessFilter, setSelectedBusinessFilter] = useState<BusinessId | 'ALL'>('ALL');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'approvals' | 'ledger' | 'audit' | 'operations' | 'reports'>('dashboard');
  const [selectedSidebarItem, setSelectedSidebarItem] = useState('dashboard');
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [persistenceError, setPersistenceError] = useState('');
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [showPipelineModal, setShowPipelineModal] = useState(false);
  const [operationsRefreshKey, setOperationsRefreshKey] = useState(0);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }

    let active = true;
    void supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setAccountError(`Could not restore Supabase session: ${error.message}`);
        setSession(data.session);
        setAccountLoading(Boolean(data.session));
        setAuthReady(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setAccountError(`Could not restore Supabase session: ${error instanceof Error ? error.message : 'Supabase could not be reached.'}`);
        setAuthReady(true);
      });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAccountLoading(Boolean(nextSession));
      setAuthReady(true);
      setAccountError('');
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session || !supabase) {
      setCurrentUser(DEMO_USERS[0]);
      setAccountLoading(false);
      return;
    }

    let active = true;
    setAccountLoading(true);
    setAccountError('');
    void (async () => {
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('full_name, role, business_id')
        .eq('id', session.user.id)
        .single();
      if (profileError) throw new Error(`Could not load your user profile: ${profileError.message}`);

      const { data: accessRows, error: accessError } = await supabase
        .from('user_business_access')
        .select('business_id')
        .eq('user_id', session.user.id);
      if (accessError) throw new Error(`Could not load your business access: ${accessError.message}`);

      const roles: UserAccount['role'][] = ['owner', 'branch_manager', 'bookkeeper', 'staff'];
      if (!roles.includes(profile.role as UserAccount['role'])) {
        throw new Error('Your Supabase profile has an unsupported role.');
      }

      const businessIds = accessRows
        .map((row) => row.business_id)
        .filter((id): id is BusinessId => id === 'real_estate' || id === 'pickleball' || id === 'jewelry');
      if (profile.business_id && !businessIds.includes(profile.business_id as BusinessId)) {
        businessIds.push(profile.business_id as BusinessId);
      }

      if (!active) return;
      setCurrentUser({
        id: session.user.id,
        name: profile.full_name,
        title: profile.role === 'owner' ? 'Managing Owner' : `${profile.role.replace('_', ' ')} — JAST Ventures`,
        role: profile.role as UserAccount['role'],
        businessId: (profile.business_id as BusinessId | null) || null,
        businessIds: profile.role === 'owner' ? undefined : businessIds,
      });
      setSelectedBusinessFilter((profile.business_id as BusinessId | null) || 'ALL');
    })()
      .catch((error: unknown) => {
        if (active) setAccountError(error instanceof Error ? error.message : 'Could not load your Supabase profile.');
      })
      .finally(() => {
        if (active) setAccountLoading(false);
      });

    return () => {
      active = false;
    };
  }, [session]);

  const loadLedger = async (): Promise<boolean> => {
    if (!supabase || !session) return false;
    setLedgerLoading(true);
    try {
      const [transactionResult, auditResult] = await Promise.all([
        supabase.from('transactions').select('*').order('created_at', { ascending: false }),
        supabase.from('audit_logs').select('*').order('recorded_at', { ascending: false }),
      ]);
      if (transactionResult.error) throw new Error(`Could not load transactions: ${transactionResult.error.message}`);
      if (auditResult.error) throw new Error(`Could not load audit history: ${auditResult.error.message}`);

      setTransactions(transactionResult.data.map((row) => ({
        id: row.id,
        referenceNo: row.reference_no,
        businessId: row.business_id as BusinessId,
        txType: row.tx_type as TransactionRecord['txType'],
        category: row.category,
        counterpartyTin: row.counterparty_tin || undefined,
        counterpartyName: row.counterparty_name,
        description: row.description,
        amount: Number(row.amount),
        vatAmount: Number(row.vat_amount),
        receiptFilename: row.receipt_filename || undefined,
        receiptDataUrl: row.receipt_url || undefined,
        reconciled: row.reconciled,
        status: row.status as TransactionRecord['status'],
        gateReason: row.gate_reason || '',
        submittedBy: row.submitted_by_name,
        approvedBy: row.approved_by || undefined,
        txDate: row.tx_date,
        createdAt: row.created_at,
      })));
      setAuditLogs(auditResult.data.map((row) => ({
        id: Number(row.id),
        transactionId: row.transaction_id,
        referenceNo: row.reference_no,
        businessId: row.business_id as BusinessId,
        action: row.action as AuditLogEntry['action'],
        actorName: row.actor_name,
        oldStatus: (row.old_status as AuditLogEntry['oldStatus']) || null,
        newStatus: (row.new_status as AuditLogEntry['newStatus']) || 'APPROVED',
        amount: Number(row.new_amount ?? row.old_amount ?? 0),
        remarks: row.remarks || '',
        recordedAt: row.recorded_at,
      })));
      setPersistenceError('');
      return true;
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : 'Could not load Supabase ledger data.');
      return false;
    } finally {
      setLedgerLoading(false);
    }
  };

  useEffect(() => {
    if (session) void loadLedger();
    else {
      setTransactions([]);
      setAuditLogs([]);
    }
  }, [session?.user.id]);

  // Mirror the database's RLS scope when rendering Supabase-authorized records.
  const rlsVisibleTransactions = useMemo(() => {
    if (currentUser.role === 'owner') {
      if (selectedBusinessFilter === 'ALL') return transactions;
      return transactions.filter((t) => t.businessId === selectedBusinessFilter);
    }
    const accessibleBusinesses = currentUser.businessIds || (currentUser.businessId ? [currentUser.businessId] : []);
    return transactions.filter((t) => accessibleBusinesses.includes(t.businessId));
  }, [transactions, currentUser, selectedBusinessFilter]);

  const rlsVisibleAuditLogs = useMemo(() => {
    if (currentUser.role === 'owner') {
      if (selectedBusinessFilter === 'ALL') return auditLogs;
      return auditLogs.filter((l) => l.businessId === selectedBusinessFilter);
    }
    const accessibleBusinesses = currentUser.businessIds || (currentUser.businessId ? [currentUser.businessId] : []);
    return auditLogs.filter((l) => accessibleBusinesses.includes(l.businessId));
  }, [auditLogs, currentUser, selectedBusinessFilter]);

  const pendingApprovals = useMemo(
    () => rlsVisibleTransactions.filter((t) => t.status === 'PENDING_APPROVAL'),
    [rlsVisibleTransactions]
  );

  // Aggregate financial KPIs
  const metrics = useMemo(() => {
    const approved = rlsVisibleTransactions.filter((t) => t.status === 'APPROVED');
    const returnedSales = rlsVisibleTransactions.filter((t) => t.status === 'CANCELLED' && t.txType === 'INCOME');
    const refundExpenses = approved.filter((t) => t.category === 'Jewelry Sales Return / Refund');
    const recognizedIncome = [...approved.filter((t) => t.txType === 'INCOME'), ...returnedSales];
    const refundsTotal = refundExpenses.reduce((acc, t) => acc + t.amount, 0);
    const totalIncome = recognizedIncome
      .reduce((acc, t) => acc + t.amount, 0);
    const totalExpense = approved
      .filter((t) => t.txType !== 'INCOME' && t.category !== 'Jewelry Sales Return / Refund')
      .reduce((acc, t) => acc + t.amount, 0);
    const netRevenue = totalIncome - refundsTotal;
    const netCashFlow = netRevenue - totalExpense;
    const totalVat = [...approved, ...returnedSales].reduce((acc, t) => acc + t.vatAmount, 0);

    const byBusiness = BUSINESS_UNITS.map((unit) => {
      const unitTxs = rlsVisibleTransactions.filter((t) =>
        t.businessId === unit.id && (t.status === 'APPROVED' || t.status === 'CANCELLED')
      );
      const rev = unitTxs.filter((t) => t.txType === 'INCOME').reduce((a, b) => a + b.amount, 0) -
        unitTxs.filter((t) => t.status === 'APPROVED' && t.category === 'Jewelry Sales Return / Refund').reduce((a, b) => a + b.amount, 0);
      const exp = unitTxs
        .filter((t) => t.status === 'APPROVED' && t.txType !== 'INCOME' && t.category !== 'Jewelry Sales Return / Refund')
        .reduce((a, b) => a + b.amount, 0);
      return {
        ...unit,
        revenue: rev,
        expenses: exp,
        net: rev - exp,
        count: approved.filter((t) => t.businessId === unit.id).length,
      };
    });

    return { totalIncome: netRevenue, totalExpense, netCashFlow, totalVat, byBusiness };
  }, [rlsVisibleTransactions]);

  const handleAddTransaction = async (
    newTx: Omit<TransactionRecord, 'id' | 'createdAt'>
  ): Promise<boolean> => {
    if (!supabase || !session) {
      setPersistenceError('You must be signed in to save transactions to Supabase.');
      return false;
    }
    try {
      const { error } = await supabase.from('transactions').insert({
        reference_no: newTx.referenceNo,
        business_id: newTx.businessId,
        tx_type: newTx.txType,
        category: newTx.category,
        counterparty_tin: newTx.counterpartyTin || null,
        counterparty_name: newTx.counterpartyName,
        description: newTx.description,
        amount: newTx.amount,
        vat_amount: newTx.vatAmount,
        receipt_url: newTx.receiptDataUrl || null,
        receipt_filename: newTx.receiptFilename || null,
        reconciled: newTx.reconciled,
        status: newTx.status,
        gate_reason: newTx.gateReason,
        submitted_by: session.user.id,
        submitted_by_name: currentUser.name,
        tx_date: newTx.txDate,
      });
      if (error) throw new Error(error.message);
    } catch (error) {
      setPersistenceError(`Could not save transaction to Supabase: ${error instanceof Error ? error.message : 'Supabase could not be reached.'}`);
      return false;
    }
    return loadLedger();
  };

  const handleOwnerDecision = async (tx: TransactionRecord, decision: 'APPROVED' | 'REJECTED') => {
    if (currentUser.role !== 'owner' || !supabase) return;
    try {
      const { error } = await supabase.from('transactions').update({
        status: decision,
        approved_by: session?.user.id,
        approved_at: new Date().toISOString(),
      }).eq('id', tx.id);
      if (error) throw new Error(error.message);
    } catch (error) {
      setPersistenceError(`Could not update transaction in Supabase: ${error instanceof Error ? error.message : 'Supabase could not be reached.'}`);
      return;
    }
    await loadLedger();
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) setAccountError(`Could not sign out: ${error.message}`);
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

  if (!isSupabaseConfigured) {
    return <SupabaseLogin error="Supabase is not configured. Check the local .env settings and restart the app." />;
  }
  if (!authReady || accountLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-100 text-sm font-medium text-slate-600">Connecting to Supabase...</div>;
  }
  if (!session) return <SupabaseLogin error={accountError} />;
  if (accountError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="w-full max-w-lg space-y-4 rounded-2xl border border-rose-200 bg-white p-6 shadow-xl">
          <h1 className="text-lg font-bold text-slate-900">Account setup required</h1>
          <p role="alert" className="text-sm text-rose-800">{accountError}</p>
          <button
            type="button"
            onClick={() => { void handleSignOut(); }}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Sign out
          </button>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#eef1f0] text-slate-900">
      <aside className="sticky top-0 hidden h-screen w-[200px] shrink-0 flex-col bg-[#075b43] text-white lg:flex">
        <div className="flex h-[112px] flex-col items-center justify-center border-b border-white/10 text-center">
          <div className="text-3xl font-black leading-none">JAST</div>
          <div className="mt-1 text-[8px] font-semibold uppercase tracking-[0.22em] text-white/70">Business Ventures</div>
        </div>
        <nav className="flex-1 px-2 py-4">
          {[
            { id: 'dashboard', tab: 'dashboard' as const, label: 'Dashboard', icon: Home },
            { id: 'business-units', tab: 'operations' as const, label: 'Business Units', icon: Layers },
            { id: 'transactions', tab: 'ledger' as const, label: 'Transactions & Analytics', icon: ReceiptText },
            { id: 'documents', tab: 'audit' as const, label: 'Documents', icon: FileText },
            { id: 'reports', tab: 'reports' as const, label: 'Reports & Analytics', icon: BarChart3 },
            { id: 'users', tab: 'audit' as const, label: 'User Accounts', icon: Users },
            { id: 'approvals', tab: 'approvals' as const, label: 'Approvals', icon: ShieldCheck },
            { id: 'audit-trail', tab: 'audit' as const, label: 'Audit Trail', icon: History },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setSelectedSidebarItem(item.id);
                  setActiveTab(item.tab);
                }}
                className={`mb-1 flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-xs transition ${
                  selectedSidebarItem === item.id ? 'bg-[#d8a72d] text-[#073d30]' : 'text-white/80 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>
        <button onClick={() => { void handleSignOut(); }} className="mx-2 mb-5 flex items-center gap-3 rounded-md px-3 py-2.5 text-xs text-white/80 hover:bg-white/10">
          <LogOut className="h-4 w-4" /> Log Out
        </button>
      </aside>
      <div className="min-w-0 flex-1">
      <header className="sticky top-0 z-30 flex h-[62px] items-center justify-between border-b border-slate-200 bg-white px-4 shadow-[0_1px_4px_rgba(15,23,42,.06)] sm:px-6">
        <div className="flex items-center gap-3">
          <Menu className="h-5 w-5 text-slate-700" />
          <div>
            <h1 className="text-[15px] font-extrabold leading-tight text-slate-900">
              {activeTab === 'reports' ? 'Reports & Analytics' : 'Centralized Owner Dashboard'}
            </h1>
            <p className="text-[10px] text-slate-500">Integrated Multi-Business Management Web Application</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button aria-label="Notifications" className="relative text-slate-600">
            <Bell className="h-[18px] w-[18px]" />
            {pendingApprovals.length > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-rose-500 text-[8px] font-bold text-white">
                {pendingApprovals.length}
              </span>
            )}
          </button>
          <div className="flex items-center gap-2 border-l border-slate-200 pl-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#075b43] text-xs font-bold text-white">
              {currentUser.name.charAt(0)}
            </div>
            <div className="hidden sm:block">
              <div className="text-[11px] font-bold leading-tight">Business Owner</div>
              <div className="text-[9px] text-slate-500">Owner</div>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
          </div>
        </div>
      </header>
      {/* Top Enterprise Bar */}
      <header className="hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 font-bold text-white shadow-inner">
              JB
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight">JAST Business Ventures</h1>
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 border border-emerald-500/30">
                  BIR CAS & RLS Ready
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Centralized Multi-Entity Financial Governance • Real Estate • Pickleball • Jewelry
              </p>
            </div>
          </div>

          {/* Authenticated Supabase account */}
          <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
            <div className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5">
              <Lock className="h-3.5 w-3.5 text-amber-400" />
              <span className="min-w-0 text-xs font-semibold text-white">{currentUser.name} ({currentUser.role.toUpperCase()})</span>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowPipelineModal(true)}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow transition hover:bg-indigo-500"
              >
                <PlusCircle className="h-4 w-4" /> New 6-Step Entry
              </button>
              <button
                onClick={() => { void handleSignOut(); }}
                aria-label="Sign out"
                title="Sign out"
                className="inline-flex items-center justify-center rounded-xl border border-slate-700 px-3 py-2 text-slate-200 hover:bg-slate-800"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Sub-Navigation & Business Tenant Filter */}
        <div className="border-t border-slate-800 bg-slate-900/95">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-2 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <nav className="grid w-full min-w-0 grid-cols-2 gap-1 sm:flex sm:flex-wrap lg:w-auto">
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`min-w-0 whitespace-normal rounded-lg px-2.5 py-1.5 text-center text-xs font-medium transition sm:px-3 ${
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
                  className={`inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-normal rounded-lg px-2.5 py-1.5 text-center text-xs font-medium transition sm:px-3 ${
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
                className={`min-w-0 whitespace-normal rounded-lg px-2.5 py-1.5 text-center text-xs font-medium transition sm:px-3 ${
                  activeTab === 'ledger'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                Unified Transaction Ledger
              </button>
              <button
                onClick={() => setActiveTab('audit')}
                className={`min-w-0 whitespace-normal rounded-lg px-2.5 py-1.5 text-center text-xs font-medium transition sm:px-3 ${
                  activeTab === 'audit'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                Immutable Audit Trail
              </button>
              <button
                onClick={() => setActiveTab('operations')}
                className={`inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-normal rounded-lg px-2.5 py-1.5 text-center text-xs font-medium transition sm:px-3 ${
                  activeTab === 'operations'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <PackageOpen className="h-3.5 w-3.5" /> Operations
              </button>
            </nav>

            {/* Tenant Scope Indicator */}
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 text-xs lg:max-w-[24rem]">
              <span className="text-slate-400">Tenant Scope:</span>
              {currentUser.role === 'owner' ? (
                <select
                  value={selectedBusinessFilter}
                  onChange={(e) => setSelectedBusinessFilter(e.target.value as BusinessId | 'ALL')}
                  className="max-w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-white"
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
      <main className="mx-auto max-w-[1440px] px-4 py-4 sm:px-5 space-y-4">
        {persistenceError && (
          <div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {persistenceError}
          </div>
        )}
        {ledgerLoading && <p role="status" className="text-sm text-slate-500">Loading transactions and audit history from Supabase...</p>}
        {currentUser.role === 'owner' && (
          <LegacyDataImport
            userId={currentUser.id}
            userName={currentUser.name}
            onComplete={() => {
              void loadLedger();
              setOperationsRefreshKey((key) => key + 1);
            }}
          />
        )}
        {/* RLS Isolation Notice for Branch Staff */}
        {currentUser.role !== 'owner' && (
          <div className="flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-xs text-indigo-950">
            <div className="flex items-center gap-2.5">
              <Lock className="h-4 w-4 text-indigo-600 shrink-0" />
              <span>
                <strong>PostgreSQL RLS access scope:</strong> You are logged in as{' '}
                <strong>{currentUser.name}</strong>. Access is limited to{' '}
                {(currentUser.businessIds || (currentUser.businessId ? [currentUser.businessId] : []))
                  .map((id) => BUSINESS_UNITS.find((unit) => unit.id === id)?.name)
                  .filter(Boolean)
                  .join(' and ')}.
              </span>
            </div>
          </div>
        )}

        {/* TAB 1: CENTRALIZED OWNER DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowPipelineModal(true)}
                className="inline-flex items-center gap-2 rounded-md bg-[#075b43] px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#064a37] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#075b43]"
              >
                <PlusCircle className="h-4 w-4" />
                Record Transaction
              </button>
            </div>
            {/* Top KPI Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex min-h-[86px] items-center rounded-lg border-l-4 border-blue-500 bg-white p-4 shadow-sm">
                <div className="mr-3 flex h-10 w-10 items-center justify-center rounded-md bg-blue-100 text-blue-600">
                  <BarChart3 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-slate-600">Net Revenue</div>
                  <p className="text-lg font-black leading-tight text-slate-900">
                    ₱{metrics.totalIncome.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-[9px] font-medium text-emerald-600">↑ 12.5% vs last month</p>
                </div>
              </div>

              <div className="flex min-h-[86px] items-center rounded-lg border-l-4 border-orange-500 bg-white p-4 shadow-sm">
                <div className="mr-3 flex h-10 w-10 items-center justify-center rounded-md bg-orange-100 text-orange-600">
                  <Layers className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-slate-600">Operating Expenses</div>
                  <p className="text-lg font-black leading-tight text-slate-900">
                    ₱{metrics.totalExpense.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-[9px] font-medium text-emerald-600">↑ 6.3% vs last month</p>
                </div>
              </div>

              <div className="flex min-h-[86px] items-center rounded-lg border-l-4 border-emerald-500 bg-white p-4 shadow-sm">
                <div className="mr-3 flex h-10 w-10 items-center justify-center rounded-md bg-emerald-100 text-emerald-600">
                  <CircleDollarSign className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-slate-600">Net Profit</div>
                  <p className="text-lg font-black leading-tight text-slate-900">
                    ₱{metrics.netCashFlow.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-[9px] font-medium text-emerald-600">↑ 21.8% vs last month</p>
                </div>
              </div>

              <div className="flex min-h-[86px] items-center rounded-lg border-l-4 border-violet-500 bg-white p-4 shadow-sm">
                <div className="mr-3 flex h-10 w-10 items-center justify-center rounded-md bg-violet-100 text-violet-600">
                  <ReceiptText className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-slate-600">Total Transactions</div>
                  <p className="text-lg font-black leading-tight text-slate-900">{rlsVisibleTransactions.length.toLocaleString()}</p>
                  <p className="text-[9px] font-medium text-emerald-600">↑ 9.7% vs last month</p>
                </div>
              </div>
            </div>

            {/* Cross-Business Venture Comparison (Owner View) */}
            {currentUser.role === 'owner' && (
              <div>
                <h2 className="mb-2 text-sm font-bold text-slate-800">Business Units Overview</h2>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  {metrics.byBusiness.map((b) => (
                    <div
                      key={b.id}
                      className="relative min-h-[106px] overflow-hidden rounded-lg p-4 text-white shadow-md"
                      style={{
                        background:
                          b.id === 'real_estate'
                            ? 'linear-gradient(115deg,#b99429 0%,#3f6658 55%,#0b5b43 100%)'
                            : b.id === 'jewelry'
                              ? 'linear-gradient(115deg,#7b5b1d 0%,#d8b45b 55%,#0d6b50 100%)'
                              : 'linear-gradient(115deg,#075b43 0%,#173a2f 55%,#0b7a5a 100%)',
                      }}
                    >
                      <div className="flex h-full items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15">
                          {b.id === 'real_estate' ? <Home className="h-5 w-5" /> : b.id === 'jewelry' ? <Gem className="h-5 w-5" /> : <Users className="h-5 w-5" />}
                        </div>
                        <div>
                          <h3 className="text-sm font-bold leading-tight">{b.name}</h3>
                          <p className="mt-1 text-[10px] text-white/80">Revenue: ₱{b.revenue.toLocaleString('en-PH', { maximumFractionDigits: 0 })}</p>
                          <p className="text-[9px] text-white/70">{b.count} cleared entries</p>
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

        {activeTab === 'reports' && (
          <ReportsAnalytics
            transactions={currentUser.role === 'owner' ? transactions : rlsVisibleTransactions}
            initialBusiness={currentUser.role === 'owner' ? 'ALL' : currentUser.businessId || currentUser.businessIds?.[0] || 'ALL'}
            allowedBusinessIds={
              currentUser.role === 'owner'
                ? BUSINESS_UNITS.map((unit) => unit.id)
                : currentUser.businessIds || (currentUser.businessId ? [currentUser.businessId] : [])
            }
          />
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
                          tx.status === 'CANCELLED'
                            ? 'text-slate-500 line-through'
                            : tx.txType === 'INCOME' ? 'text-emerald-700' : 'text-slate-900'
                        }`}
                      >
                        {tx.status === 'CANCELLED' ? '' : tx.txType === 'INCOME' ? '+' : '-'}₱
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
                        {tx.status === 'CANCELLED' && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2.5 py-0.5 font-semibold text-slate-700">
                            <XCircle className="h-3 w-3" /> CANCELLED
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
                Append-only PostgreSQL trigger ledger recording inserts, approvals, rejections, and cancellations.
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

        {activeTab === 'operations' && (
          <OperationsDashboard
            currentUser={currentUser}
            authUserId={session.user.id}
            refreshKey={operationsRefreshKey}
            onJewelrySale={async (itemName, quantity, amount, customerName) => {
              const referenceNo = `JAST-JW-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
              const gateRequired = amount > BUSINESS_UNITS.find((unit) => unit.id === 'jewelry')!.approvalThreshold;
              return handleAddTransaction({
                referenceNo,
                businessId: 'jewelry',
                txType: 'INCOME',
                category: 'Bespoke Diamond & Gold Sales',
                counterpartyName: customerName || 'Walk-in Customer',
                description: `${itemName} × ${quantity}`,
                amount,
                vatAmount: Number(((amount / 1.12) * 0.12).toFixed(2)),
                reconciled: false,
                status: gateRequired ? 'PENDING_APPROVAL' : 'APPROVED',
                gateReason: gateRequired
                  ? 'Exceeds ₱30,000.00 automated threshold'
                  : 'Auto-cleared within branch operational limit',
                submittedBy: currentUser.name,
                txDate: new Date().toISOString().slice(0, 10),
              });
            }}
            onCourtBooking={async (courtName, date, amount, customerName) => {
              if (amount <= 0) return true;
              const referenceNo = `JAST-PB-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
              const gateRequired = amount > BUSINESS_UNITS.find((unit) => unit.id === 'pickleball')!.approvalThreshold;
              return handleAddTransaction({
                referenceNo,
                businessId: 'pickleball',
                txType: 'INCOME',
                category: 'Court Rental & Open Play',
                counterpartyName: customerName || 'Walk-in Customer',
                description: `${courtName} booking on ${date}`,
                amount,
                vatAmount: Number(((amount / 1.12) * 0.12).toFixed(2)),
                reconciled: false,
                status: gateRequired ? 'PENDING_APPROVAL' : 'APPROVED',
                gateReason: gateRequired
                  ? 'Exceeds ₱30,000.00 automated threshold'
                  : 'Auto-cleared within branch operational limit',
                submittedBy: currentUser.name,
                txDate: date,
              });
            }}
            onPropertyBooking={async (propertyName, address, startDate, endDate, monthlyRent, customerName) => {
              if (monthlyRent <= 0) return true;
              const referenceNo = `JAST-RE-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
              const gateRequired = monthlyRent > BUSINESS_UNITS.find((unit) => unit.id === 'real_estate')!.approvalThreshold;
              return handleAddTransaction({
                referenceNo,
                businessId: 'real_estate',
                txType: 'INCOME',
                category: 'Property Reservation & Downpayment',
                counterpartyName: customerName,
                description: `Property booking: ${propertyName}, ${address} (${startDate} to ${endDate}); monthly rent ${monthlyRent.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })}`,
                amount: monthlyRent,
                vatAmount: Number(((monthlyRent / 1.12) * 0.12).toFixed(2)),
                reconciled: false,
                status: gateRequired ? 'PENDING_APPROVAL' : 'APPROVED',
                gateReason: gateRequired
                  ? 'Exceeds ₱30,000.00 automated threshold'
                  : 'Auto-cleared within branch operational limit',
                submittedBy: currentUser.name,
                txDate: startDate,
              });
            }}
            onJewelryReturn={() => { void loadLedger(); }}
          />
        )}
      </main>
      </div>

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
