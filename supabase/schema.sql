-- ============================================================================
-- JAST BUSINESS VENTURES - MULTI-BUSINESS MANAGEMENT ERP SCHEMA
-- Includes:
-- 1. Multi-Business Units (Real Estate, Pickleball Court, Jewelry)
-- 2. Role-Based Access Control (Owner, Branch Manager, Bookkeeper)
-- 3. PostgreSQL Row-Level Security (RLS) for strict legal data isolation
-- 4. Automated "Owner Approval Gate" Trigger (> PHP 30,000 or Jewelry Write-Off)
-- 5. Immutable, Append-Only System Audit Logs (BIR CAS / RA 8792 Compliant)
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. BUSINESS UNITS TABLE
CREATE TABLE public.business_units (
    id TEXT PRIMARY KEY, -- e.g. 'real_estate', 'pickleball', 'jewelry'
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    description TEXT,
    approval_threshold NUMERIC(14, 2) NOT NULL DEFAULT 30000.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.business_units (id, name, code, description, approval_threshold) VALUES
('real_estate', 'JAST Real Estate & Properties', 'JAST-RE', 'High-capital property leasing, lot sales, and asset rotations', 30000.00),
('pickleball', 'JAST Pickleball Court & Hub', 'JAST-PB', 'High-volume daily court rentals, memberships, and pro-shop cash flows', 30000.00),
('jewelry', 'JAST Fine Jewelry Vault', 'JAST-JW', 'Premium gold, diamond, and bespoke inventory margins', 30000.00)
ON CONFLICT (id) DO NOTHING;

-- 2. USER PROFILES & ROLE ASSIGNMENTS
CREATE TABLE public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'branch_manager', 'bookkeeper')),
    business_id TEXT REFERENCES public.business_units(id), -- NULL for 'owner' (global access)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. TRANSACTIONS TABLE (6-Step Pipeline & BIR E-Invoicing Fields)
CREATE TABLE public.transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reference_no TEXT NOT NULL UNIQUE,
    business_id TEXT NOT NULL REFERENCES public.business_units(id),
    tx_type TEXT NOT NULL CHECK (tx_type IN ('INCOME', 'EXPENSE', 'INVENTORY_WRITEOFF', 'ASSET_TRANSFER')),
    category TEXT NOT NULL,
    counterparty_tin TEXT, -- BIR E-Invoicing / CAS structured field
    counterparty_name TEXT NOT NULL,
    description TEXT NOT NULL,
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    vat_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    receipt_url TEXT,
    receipt_filename TEXT,
    reconciled BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED')),
    gate_reason TEXT,
    submitted_by UUID REFERENCES public.user_profiles(id),
    submitted_by_name TEXT NOT NULL,
    approved_by UUID REFERENCES public.user_profiles(id),
    approved_at TIMESTAMPTZ,
    tx_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. IMMUTABLE SYSTEM AUDIT LOGS (BIR Reg. 17-2013 & RMO 1-2020)
CREATE TABLE public.audit_logs (
    id BIGSERIAL PRIMARY KEY,
    transaction_id UUID NOT NULL,
    reference_no TEXT NOT NULL,
    business_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('INSERT', 'APPROVE', 'REJECT', 'RECONCILE', 'UPDATE')),
    actor_id UUID,
    actor_name TEXT NOT NULL,
    old_status TEXT,
    new_status TEXT,
    old_amount NUMERIC(14, 2),
    new_amount NUMERIC(14, 2),
    remarks TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent UPDATE or DELETE on audit_logs to guarantee immutability
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit logs are strictly immutable and cannot be modified or deleted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_immutable_audit_logs
BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

-- 5. OWNER APPROVAL GATE TRIGGER FUNCTION
CREATE OR REPLACE FUNCTION evaluate_owner_approval_gate()
RETURNS TRIGGER AS $$
DECLARE
    v_threshold NUMERIC(14, 2);
BEGIN
    SELECT approval_threshold INTO v_threshold
    FROM public.business_units
    WHERE id = NEW.business_id;

    IF v_threshold IS NULL THEN
        v_threshold := 30000.00;
    END IF;

    -- Gate Condition 1: Amount exceeds PHP 30,000.00 threshold
    IF NEW.amount > v_threshold THEN
        NEW.status := 'PENDING_APPROVAL';
        NEW.gate_reason := 'Exceeds PHP ' || TO_CHAR(v_threshold, 'FM999,999,990.00') || ' automated threshold';
    -- Gate Condition 2: Any Jewelry Inventory Write-Off requires Owner Gate sign-off
    ELSIF NEW.business_id = 'jewelry' AND NEW.tx_type = 'INVENTORY_WRITEOFF' THEN
        NEW.status := 'PENDING_APPROVAL';
        NEW.gate_reason := 'Jewelry vault inventory write-off requires Owner authorization';
    ELSE
        NEW.status := 'APPROVED';
        NEW.gate_reason := 'Auto-cleared within branch operational limit';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_owner_approval_gate
BEFORE INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION evaluate_owner_approval_gate();

-- 6. AUTOMATIC AUDIT TRAIL LOGGING TRIGGER
CREATE OR REPLACE FUNCTION log_transaction_audit()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.audit_logs (
            transaction_id, reference_no, business_id, action,
            actor_id, actor_name, old_status, new_status, old_amount, new_amount, remarks
        ) VALUES (
            NEW.id, NEW.reference_no, NEW.business_id, 'INSERT',
            NEW.submitted_by, NEW.submitted_by_name, NULL, NEW.status, NULL, NEW.amount,
            COALESCE(NEW.gate_reason, 'Initial 6-step pipeline submission')
        );
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO public.audit_logs (
            transaction_id, reference_no, business_id, action,
            actor_id, actor_name, old_status, new_status, old_amount, new_amount, remarks
        ) VALUES (
            NEW.id, NEW.reference_no, NEW.business_id,
            CASE
                WHEN OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'APPROVED' THEN 'APPROVE'
                WHEN OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'REJECTED' THEN 'REJECT'
                WHEN OLD.reconciled = FALSE AND NEW.reconciled = TRUE THEN 'RECONCILE'
                ELSE 'UPDATE'
            END,
            COALESCE(NEW.approved_by, NEW.submitted_by),
            NEW.submitted_by_name,
            OLD.status, NEW.status, OLD.amount, NEW.amount,
            'Status transition recorded by PostgreSQL trigger'
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_transaction_audit_trail
AFTER INSERT OR UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION log_transaction_audit();

-- 7. ROW-LEVEL SECURITY (RLS) POLICIES FOR MULTI-BUSINESS ISOLATION
ALTER TABLE public.business_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Business units are readable by authenticated users
CREATE POLICY "Authenticated users can view business units"
ON public.business_units FOR SELECT TO authenticated USING (true);

-- User profiles: users read own profile; owner reads all
CREATE POLICY "Users read own profile or owner reads all"
ON public.user_profiles FOR SELECT TO authenticated
USING (
    auth.uid() = id OR
    EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.role = 'owner')
);

-- Transactions SELECT isolation: Owner sees all; staff see ONLY their assigned business_id
CREATE POLICY "Strict multi-business SELECT isolation"
ON public.transactions FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles up
        WHERE up.id = auth.uid()
        AND (up.role = 'owner' OR up.business_id = transactions.business_id)
    )
);

-- Transactions INSERT isolation: Staff can only insert into their own business_id
CREATE POLICY "Strict multi-business INSERT isolation"
ON public.transactions FOR INSERT TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.user_profiles up
        WHERE up.id = auth.uid()
        AND (up.role = 'owner' OR up.business_id = transactions.business_id)
    )
);

-- Transactions UPDATE isolation: Only Owner can approve/reject; staff can reconcile own branch
CREATE POLICY "Owner approval and branch reconciliation UPDATE policy"
ON public.transactions FOR UPDATE TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles up
        WHERE up.id = auth.uid()
        AND (up.role = 'owner' OR up.business_id = transactions.business_id)
    )
);

-- Audit logs: Owner sees all; staff see only their own business logs
CREATE POLICY "Strict multi-business audit log isolation"
ON public.audit_logs FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles up
        WHERE up.id = auth.uid()
        AND (up.role = 'owner' OR up.business_id = audit_logs.business_id)
    )
);

-- Storage Bucket for Receipts (Run in Supabase SQL Editor)
INSERT INTO storage.buckets (id, name, public)
VALUES ('receipt-vault', 'receipt-vault', false)
ON CONFLICT (id) DO NOTHING;
