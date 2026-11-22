import React, { useState } from 'react';
import {
  CheckCircle2,
  FileUp,
  ShieldAlert,
  ArrowRight,
  ArrowLeft,
  Receipt,
  FileCheck2,
  X,
} from 'lucide-react';
import { BusinessId, NewTransactionRecord, TransactionType, UserAccount } from '../types/erp';
import { BUSINESS_UNITS } from '../lib/seedData';

interface Props {
  currentUser: UserAccount;
  onClose: () => void;
  onSubmitTransaction: (tx: NewTransactionRecord) => Promise<boolean>;
}

const STEPS = [
  { num: 1, label: 'Record' },
  { num: 2, label: 'Upload Receipt' },
  { num: 3, label: 'Categorize' },
  { num: 4, label: 'Gate Check' },
  { num: 5, label: 'Reconcile' },
  { num: 6, label: 'Generate' },
];

const CATEGORIES_BY_BUSINESS: Record<BusinessId, { value: string; label: string }[]> = {
  real_estate: [
    { value: 'Property Reservation & Downpayment', label: 'Property Reservation & Downpayment' },
    { value: 'Facility Maintenance & Utilities', label: 'Facility Maintenance & Utilities' },
    { value: 'Operational Revenue', label: 'General Operational Revenue' },
  ],
  pickleball: [
    { value: 'Court Rental & Open Play', label: 'Court Rental & Open Play' },
    { value: 'Facility Maintenance & Utilities', label: 'Facility Maintenance & Utilities' },
    { value: 'Operational Revenue', label: 'General Operational Revenue' },
  ],
  jewelry: [
    { value: 'Bespoke Diamond & Gold Sales', label: 'Bespoke Diamond & Gold Sales' },
    { value: 'Vault Smelting / Stone Recalibration', label: 'Vault Smelting / Stone Recalibration' },
    { value: 'Facility Maintenance & Utilities', label: 'Facility Maintenance & Utilities' },
    { value: 'Operational Revenue', label: 'General Operational Revenue' },
  ],
};

export const SixStepPipelineModal: React.FC<Props> = ({
  currentUser,
  onClose,
  onSubmitTransaction,
}) => {
  const [step, setStep] = useState(1);
  const [businessId, setBusinessId] = useState<BusinessId>(
    currentUser.businessId || currentUser.businessIds?.[0] || 'real_estate'
  );
  const [txType, setTxType] = useState<TransactionType>('INCOME');
  const [counterpartyName, setCounterpartyName] = useState('');
  const [counterpartyTin, setCounterpartyTin] = useState('');
  const [amount, setAmount] = useState('');
  const [txDate, setTxDate] = useState(new Date().toISOString().slice(0, 10));
  const [receiptFilename, setReceiptFilename] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptError, setReceiptError] = useState('');
  const [category, setCategory] = useState(
    CATEGORIES_BY_BUSINESS[currentUser.businessId || currentUser.businessIds?.[0] || 'real_estate'][0].value
  );
  const [description, setDescription] = useState('');
  const [reconciled, setReconciled] = useState(true);
  const [submissionError, setSubmissionError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const numericAmount = parseFloat(amount) || 0;
  const vatAmount = Number(((numericAmount / 1.12) * 0.12).toFixed(2));
  const allowedBusinesses = currentUser.businessIds || (currentUser.businessId ? [currentUser.businessId] : null);
  const visibleBusinessUnits = allowedBusinesses
    ? BUSINESS_UNITS.filter((business) => allowedBusinesses.includes(business.id))
    : BUSINESS_UNITS;
  const availableCategories = CATEGORIES_BY_BUSINESS[businessId];
  const unit = BUSINESS_UNITS.find((b) => b.id === businessId)!;

  // Owner Gate Logic matching PostgreSQL trigger
  const triggersGate =
    numericAmount > unit.approvalThreshold ||
    (businessId === 'jewelry' && txType === 'INVENTORY_WRITEOFF');

  const gateReason =
    numericAmount > unit.approvalThreshold
      ? `Exceeds ₱${unit.approvalThreshold.toLocaleString()} automated threshold`
      : businessId === 'jewelry' && txType === 'INVENTORY_WRITEOFF'
      ? 'Jewelry vault inventory write-off requires Owner authorization'
      : 'Auto-cleared within branch operational limit';

  const generatedRef = `${unit.code}-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const extension = file.name.split('.').pop()?.toLowerCase();
    const allowedMimeTypes: Record<string, string> = {
      pdf: 'application/pdf',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
    };
    const expectedMimeType = extension ? allowedMimeTypes[extension] : undefined;
    if (!expectedMimeType || (file.type && file.type !== expectedMimeType)) {
      setReceiptError('Choose a PDF, JPG, or PNG receipt.');
      setReceiptFile(null);
      setReceiptFilename('');
      e.target.value = '';
      return;
    }

    setReceiptError('');
    setReceiptFile(file);
    setReceiptFilename(file.name);
  };

  const handleFinalSubmit = async () => {
    setSubmitting(true);
    setSubmissionError('');
    const saved = await onSubmitTransaction({
      referenceNo: generatedRef,
      businessId,
      txType,
      category,
      counterpartyTin: counterpartyTin || '000-000-000-000',
      counterpartyName: counterpartyName || 'Walk-in Client',
      description: description || `${category} entry via 6-Step Pipeline`,
      amount: numericAmount,
      vatAmount,
      receiptFilename: receiptFilename || undefined,
      receiptFile: receiptFile || undefined,
      reconciled,
      status: triggersGate ? 'PENDING_APPROVAL' : 'APPROVED',
      gateReason,
      submittedBy: currentUser.name,
      approvedBy: triggersGate ? undefined : 'System Auto-Gate',
      txDate,
    });
    setSubmitting(false);
    if (saved) onClose();
    else setSubmissionError('The transaction was not saved to Supabase. Resolve the ledger error and try again.');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-6 py-4 text-white">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
              Standardized Staff Transactional Pipeline
            </p>
            <h2 className="text-lg font-bold">6-Step Financial Entry & BIR CAS Intake</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Progress Stepper */}
        <div className="grid grid-cols-6 border-b border-slate-200 bg-slate-50 px-4 py-3">
          {STEPS.map((s) => (
            <div key={s.num} className="flex flex-col items-center text-center">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition ${
                  step === s.num
                    ? 'bg-indigo-600 text-white ring-4 ring-indigo-100'
                    : step > s.num
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-200 text-slate-600'
                }`}
              >
                {step > s.num ? '✓' : s.num}
              </div>
              <span className="mt-1 text-[11px] font-medium text-slate-700">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Step Body */}
        <div className="p-6 space-y-4 min-h-[280px]">
          {submissionError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{submissionError}</p>}
          {step === 1 && (
            <div className="space-y-4">
              <h3 className="font-semibold text-slate-800">Step 1: Record Core Transaction Details</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Business Venture (RLS Tenant)</label>
                  <select
                    value={businessId}
                    disabled={allowedBusinesses !== null && allowedBusinesses.length === 1}
                    onChange={(e) => {
                      const nextBusinessId = e.target.value as BusinessId;
                      setBusinessId(nextBusinessId);
                      setCategory(CATEGORIES_BY_BUSINESS[nextBusinessId][0].value);
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white disabled:bg-slate-100"
                  >
                    {visibleBusinessUnits.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Transaction Type</label>
                  <select
                    value={txType}
                    onChange={(e) => setTxType(e.target.value as TransactionType)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                  >
                    <option value="INCOME">Income / Sales Receipt</option>
                    <option value="EXPENSE">Operational Expense</option>
                    <option value="INVENTORY_WRITEOFF">Inventory Write-Off / Adjustment</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Gross Amount (PHP ₱)</label>
                  <input
                    type="number"
                    placeholder="e.g. 35000"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Transaction Date</label>
                  <input
                    type="date"
                    value={txDate}
                    onChange={(e) => setTxDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Client / Vendor Name</label>
                  <input
                    type="text"
                    placeholder="Full legal name or company"
                    value={counterpartyName}
                    onChange={(e) => setCounterpartyName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">BIR TIN (E-Invoicing Field)</label>
                  <input
                    type="text"
                    placeholder="000-000-000-000"
                    value={counterpartyTin}
                    onChange={(e) => setCounterpartyTin(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h3 className="font-semibold text-slate-800">Step 2: Upload Supporting Receipt (Supabase Receipt-Vault)</h3>
              <p className="text-xs text-slate-500">
                RA 8792 & BIR Reg. 17-2013 require digitized source documents linked to every ledger entry.
              </p>
              <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50/40 p-8 cursor-pointer hover:bg-indigo-50 transition">
                <FileUp className="h-10 w-10 text-indigo-600 mb-2" />
                <span className="text-sm font-semibold text-slate-800">
                  {receiptFile ? `Attached: ${receiptFilename}` : 'Click to attach Official Receipt / Sales Invoice (PDF, JPG, PNG)'}
                </span>
                <span className="text-xs text-slate-500 mt-1">Uploaded securely to the private receipt vault.</span>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>
              {receiptError && <p role="alert" className="text-xs font-medium text-rose-700">{receiptError}</p>}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h3 className="font-semibold text-slate-800">Step 3: Categorize & Annotate Ledger Entry</h3>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Chart of Accounts Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                >
                  {availableCategories.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Particulars / Audit Remarks</label>
                <textarea
                  rows={3}
                  placeholder="Describe the item, lot number, court hours, or jewelry SKU..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h3 className="font-semibold text-slate-800">Step 4: Automated Owner Gate Evaluation</h3>
              <div
                className={`rounded-xl border p-5 ${
                  triggersGate
                    ? 'border-amber-300 bg-amber-50 text-amber-950'
                    : 'border-emerald-300 bg-emerald-50 text-emerald-950'
                }`}
              >
                <div className="flex items-start gap-3">
                  {triggersGate ? (
                    <ShieldAlert className="h-6 w-6 text-amber-600 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <h4 className="font-bold text-sm">
                      {triggersGate
                        ? 'OWNER GATE TRIGGERED → Routed to PENDING_APPROVAL'
                        : 'GATE CLEARED → Eligible for Immediate Posting'}
                    </h4>
                    <p className="text-xs mt-1">{gateReason}</p>
                    <p className="text-xs mt-2 font-mono opacity-80">
                      Trigger Rule: amount (₱{numericAmount.toLocaleString()}) &gt; threshold (₱{unit.approvalThreshold.toLocaleString()}) OR jewelry write-off
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <h3 className="font-semibold text-slate-800">Step 5: Cash & VAT Reconciliation Check</h3>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">Gross Transaction Amount:</span>
                  <span className="font-bold">₱{numericAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Extracted 12% VAT Component (RR 11-2025):</span>
                  <span className="font-medium">₱{vatAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Net of VAT Base:</span>
                  <span className="font-medium">
                    ₱{(numericAmount - vatAmount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 pt-2">
                <input
                  type="checkbox"
                  checked={reconciled}
                  onChange={(e) => setReconciled(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                />
                Confirm physical cash / bank deposit slip matches receipt amount
              </label>
            </div>
          )}

          {step === 6 && (
            <div className="space-y-4">
              <h3 className="font-semibold text-slate-800">Step 6: Generate BIR CAS Voucher & Commit to Database</h3>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs">
                <div className="flex items-center gap-2 text-indigo-700 font-bold text-sm pb-1 border-b border-slate-200">
                  <FileCheck2 className="h-4 w-4" />
                  <span>Structured E-Invoice & Ledger Payload Ready</span>
                </div>
                <p><strong>Reference No:</strong> {generatedRef}</p>
                <p><strong>Business Venture:</strong> {unit.name}</p>
                <p><strong>Counterparty:</strong> {counterpartyName || 'Walk-in Client'} (TIN: {counterpartyTin || '000-000-000-000'})</p>
                <p><strong>Amount:</strong> ₱{numericAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                <p><strong>Target Database Status:</strong> {triggersGate ? 'PENDING_APPROVAL (Held at Owner Gate)' : 'APPROVED'}</p>
                <p><strong>Audit Trail:</strong> Immutable INSERT record will be written to <code>public.audit_logs</code></p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Controls */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button
            type="button"
            disabled={step === 1}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          {step < 6 ? (
            <button
              type="button"
              disabled={step === 1 && numericAmount <= 0}
              onClick={() => setStep((s) => Math.min(6, s + 1))}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              Next Step <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinalSubmit}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
            >
              <Receipt className="h-4 w-4" /> {submitting ? 'Saving to Supabase...' : 'Submit & Log to Ledger'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
