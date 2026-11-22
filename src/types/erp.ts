export type BusinessId = 'real_estate' | 'pickleball' | 'jewelry';

export type UserRole = 'owner' | 'branch_manager' | 'bookkeeper' | 'staff';

export type TransactionType = 'INCOME' | 'EXPENSE' | 'INVENTORY_WRITEOFF' | 'ASSET_TRANSFER';

export type TransactionStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface BusinessUnit {
  id: BusinessId;
  name: string;
  code: string;
  description: string;
  approvalThreshold: number;
  accentColor: string;
}

export interface UserAccount {
  id: string;
  name: string;
  title: string;
  role: UserRole;
  businessId: BusinessId | null; // null for Owner (global oversight)
  businessIds?: BusinessId[];
}

export interface TransactionRecord {
  id: string;
  referenceNo: string;
  businessId: BusinessId;
  txType: TransactionType;
  category: string;
  counterpartyTin?: string;
  counterpartyName: string;
  description: string;
  amount: number;
  vatAmount: number;
  receiptFilename?: string;
  receiptDataUrl?: string;
  reconciled: boolean;
  status: TransactionStatus;
  gateReason: string;
  submittedBy: string;
  approvedBy?: string;
  txDate: string;
  createdAt: string;
}

export interface AuditLogEntry {
  id: number;
  transactionId: string;
  referenceNo: string;
  businessId: BusinessId;
  action: 'INSERT' | 'APPROVE' | 'REJECT' | 'RECONCILE' | 'UPDATE' | 'CANCEL';
  actorName: string;
  oldStatus: TransactionStatus | null;
  newStatus: TransactionStatus;
  amount: number;
  remarks: string;
  recordedAt: string;
}
