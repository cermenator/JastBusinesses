-- ============================================================================
-- JAST BUSINESS VENTURES - MULTI-BUSINESS MANAGEMENT ERP SCHEMA
-- Includes:
-- 1. Multi-Business Units (Real Estate, Pickleball Court, Jewelry)
-- 2. Role-Based Access Control (Owner, Branch Manager, Bookkeeper)
-- 3. PostgreSQL Row-Level Security (RLS) for strict legal data isolation
-- 4. Automated "Owner Approval Gate" Trigger (all Jewelry; > PHP 30,000 elsewhere)
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
    role TEXT NOT NULL CHECK (role IN ('owner', 'branch_manager', 'bookkeeper', 'staff')),
    business_id TEXT REFERENCES public.business_units(id), -- NULL for 'owner' (global access)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A staff account may be assigned to more than one operating business.
CREATE TABLE public.user_business_access (
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    business_id TEXT NOT NULL REFERENCES public.business_units(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, business_id)
);

CREATE OR REPLACE FUNCTION public.is_jasmin_owner()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_profiles up
        WHERE up.id = auth.uid()
          AND up.role = 'owner'
    );
$$;

CREATE OR REPLACE FUNCTION public.has_business_access(p_business_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_profiles up
        WHERE up.id = auth.uid()
          AND (
              up.role = 'owner'
              OR up.business_id = p_business_id
              OR EXISTS (
                  SELECT 1
                  FROM public.user_business_access uba
                  WHERE uba.user_id = up.id
                    AND uba.business_id = p_business_id
              )
          )
    );
$$;

CREATE OR REPLACE FUNCTION public.create_staff_account(
    p_user_id UUID,
    p_full_name TEXT,
    p_email TEXT,
    p_role TEXT,
    p_business_ids TEXT[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_auth_email TEXT;
BEGIN
    IF NOT public.is_jasmin_owner() THEN
        RAISE EXCEPTION 'Only the owner can create staff accounts.' USING ERRCODE = '42501';
    END IF;
    IF p_role IS NULL OR p_role NOT IN ('branch_manager', 'bookkeeper', 'staff') THEN
        RAISE EXCEPTION 'Choose a supported staff role.';
    END IF;
    IF NULLIF(BTRIM(p_full_name), '') IS NULL OR NULLIF(BTRIM(p_email), '') IS NULL THEN
        RAISE EXCEPTION 'Full name and email are required.';
    END IF;
    IF COALESCE(CARDINALITY(p_business_ids), 0) = 0 THEN
        RAISE EXCEPTION 'Assign the user to at least one venture.';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM UNNEST(p_business_ids) AS selected(selected_business_id)
        LEFT JOIN public.business_units AS business ON business.id = selected.selected_business_id
        WHERE business.id IS NULL
    ) THEN
        RAISE EXCEPTION 'One or more selected ventures do not exist.';
    END IF;

    SELECT auth_user.email
    INTO v_auth_email
    FROM auth.users AS auth_user
    WHERE auth_user.id = p_user_id;
    IF NOT FOUND OR v_auth_email IS NULL THEN
        RAISE EXCEPTION 'Create this user in Supabase Auth before assigning app access.';
    END IF;
    IF LOWER(BTRIM(v_auth_email)) <> LOWER(BTRIM(p_email)) THEN
        RAISE EXCEPTION 'The email must match the selected Supabase Auth user.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.user_profiles AS profile
        WHERE profile.id = p_user_id OR LOWER(profile.email) = LOWER(BTRIM(p_email))
    ) THEN
        RAISE EXCEPTION 'A user profile already exists for this Auth user or email.';
    END IF;

    INSERT INTO public.user_profiles (id, full_name, email, role, business_id)
    VALUES (p_user_id, BTRIM(p_full_name), v_auth_email, p_role, p_business_ids[1]);

    INSERT INTO public.user_business_access (user_id, business_id)
    SELECT p_user_id, selected.selected_business_id
    FROM UNNEST(p_business_ids) AS selected(selected_business_id)
    ON CONFLICT (user_id, business_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.create_staff_account(UUID, TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_staff_account(UUID, TEXT, TEXT, TEXT, TEXT[]) TO authenticated;

-- Owner-managed catalogs
CREATE TABLE public.properties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    monthly_rent NUMERIC(14, 2) NOT NULL CHECK (monthly_rent >= 0),
    details TEXT,
    photo_paths TEXT[] NOT NULL DEFAULT '{}',
    created_by UUID NOT NULL REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.property_bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_id UUID NOT NULL REFERENCES public.properties(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    customer_name TEXT NOT NULL,
    monthly_rent NUMERIC(14, 2) NOT NULL CHECK (monthly_rent >= 0),
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
    processed_by UUID NOT NULL REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_date >= start_date)
);

CREATE OR REPLACE FUNCTION public.prevent_property_booking_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status = 'confirmed' THEN
        PERFORM 1
        FROM public.properties
        WHERE id = NEW.property_id
        FOR UPDATE;

        IF EXISTS (
            SELECT 1
            FROM public.property_bookings pb
            WHERE pb.property_id = NEW.property_id
              AND pb.status = 'confirmed'
              AND pb.id IS DISTINCT FROM NEW.id
              AND NEW.start_date <= pb.end_date
              AND NEW.end_date >= pb.start_date
        ) THEN
            RAISE EXCEPTION 'This property is already booked for the selected date range.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_property_booking_overlap
BEFORE INSERT OR UPDATE ON public.property_bookings
FOR EACH ROW EXECUTE FUNCTION public.prevent_property_booking_overlap();

CREATE TABLE public.jewelry_inventory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    unit_cost NUMERIC(14, 2) NOT NULL CHECK (unit_cost >= 0),
    selling_price NUMERIC(14, 2) NOT NULL CHECK (selling_price >= 0),
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    photo_paths TEXT[] NOT NULL DEFAULT '{}',
    created_by UUID NOT NULL REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.properties
    ADD COLUMN IF NOT EXISTS photo_paths TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.jewelry_inventory
    ADD COLUMN IF NOT EXISTS photo_paths TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE public.pickleball_courts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    notes TEXT,
    created_by UUID NOT NULL REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Staff-entered activity for pickleball bookings and jewelry point-of-sale.
CREATE TABLE public.court_bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    court_id UUID NOT NULL REFERENCES public.pickleball_courts(id),
    booking_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    customer_name TEXT NOT NULL,
    amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
    processed_by UUID NOT NULL REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_time > start_time)
);

CREATE TABLE public.jewelry_sales (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    inventory_item_id UUID NOT NULL REFERENCES public.jewelry_inventory(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(14, 2) NOT NULL CHECK (unit_price >= 0),
    customer_name TEXT NOT NULL,
    processed_by UUID NOT NULL REFERENCES public.user_profiles(id),
    sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.prevent_court_booking_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status = 'confirmed' THEN
        PERFORM 1
        FROM public.pickleball_courts
        WHERE id = NEW.court_id
        FOR UPDATE;

        IF EXISTS (
            SELECT 1
            FROM public.court_bookings cb
            WHERE cb.court_id = NEW.court_id
              AND cb.booking_date = NEW.booking_date
              AND cb.status = 'confirmed'
              AND cb.id IS DISTINCT FROM NEW.id
              AND NEW.start_time < cb.end_time
              AND NEW.end_time > cb.start_time
        ) THEN
            RAISE EXCEPTION 'This court is already booked for the selected time.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_court_booking_overlap
BEFORE INSERT OR UPDATE ON public.court_bookings
FOR EACH ROW EXECUTE FUNCTION public.prevent_court_booking_overlap();

CREATE OR REPLACE FUNCTION public.decrement_jewelry_inventory_for_sale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.jewelry_inventory
    SET quantity = quantity - NEW.quantity,
        updated_at = NOW()
    WHERE id = NEW.inventory_item_id
      AND quantity >= NEW.quantity;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient jewelry inventory for this sale.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_decrement_jewelry_inventory_for_sale
BEFORE INSERT ON public.jewelry_sales
FOR EACH ROW EXECUTE FUNCTION public.decrement_jewelry_inventory_for_sale();

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
    status TEXT NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED')),
    gate_reason TEXT,
    submitted_by UUID REFERENCES public.user_profiles(id),
    submitted_by_name TEXT NOT NULL,
    approved_by UUID REFERENCES public.user_profiles(id),
    approved_at TIMESTAMPTZ,
    tx_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.jewelry_returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL UNIQUE REFERENCES public.jewelry_sales(id),
    transaction_id UUID UNIQUE REFERENCES public.transactions(id),
    amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
    processed_by UUID NOT NULL REFERENCES public.user_profiles(id),
    returned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. IMMUTABLE SYSTEM AUDIT LOGS (BIR Reg. 17-2013 & RMO 1-2020)
CREATE TABLE public.audit_logs (
    id BIGSERIAL PRIMARY KEY,
    transaction_id UUID NOT NULL,
    reference_no TEXT NOT NULL,
    business_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('INSERT', 'APPROVE', 'REJECT', 'RECONCILE', 'UPDATE', 'CANCEL')),
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

    IF NEW.business_id = 'jewelry'
       AND NEW.category = 'Jewelry Sales Return / Refund'
       AND public.is_jasmin_owner() THEN
        NEW.status := 'APPROVED';
        NEW.gate_reason := 'Owner-authorized jewelry return/refund';
        RETURN NEW;
    END IF;

    IF v_threshold IS NULL THEN
        v_threshold := 30000.00;
    END IF;

    -- Every jewelry transaction requires owner approval, regardless of amount.
    IF NEW.business_id = 'jewelry' THEN
        NEW.status := 'PENDING_APPROVAL';
        NEW.gate_reason := 'All jewelry transactions require Owner authorization';
    -- Gate Condition 1: Amount exceeds PHP 30,000.00 threshold
    ELSIF NEW.amount > v_threshold THEN
        NEW.status := 'PENDING_APPROVAL';
        NEW.gate_reason := 'Exceeds PHP ' || TO_CHAR(v_threshold, 'FM999,999,990.00') || ' automated threshold';
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
                WHEN OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'CANCELLED' THEN 'CANCEL'
                WHEN OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'APPROVED' THEN 'APPROVE'
                WHEN OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'REJECTED' THEN 'REJECT'
                WHEN OLD.reconciled = FALSE AND NEW.reconciled = TRUE THEN 'RECONCILE'
                ELSE 'UPDATE'
            END,
            COALESCE(NEW.approved_by, auth.uid(), NEW.submitted_by),
            COALESCE(
                (SELECT full_name FROM public.user_profiles WHERE id = auth.uid()),
                NEW.submitted_by_name
            ),
            OLD.status, NEW.status, OLD.amount, NEW.amount,
            CASE
                WHEN OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'CANCELLED'
                    THEN COALESCE(NEW.gate_reason, 'Transaction cancelled')
                ELSE 'Status transition recorded by PostgreSQL trigger'
            END
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;

CREATE TRIGGER trg_transaction_audit_trail
AFTER INSERT OR UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION log_transaction_audit();

CREATE OR REPLACE FUNCTION public.prevent_unauthorized_transaction_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF (OLD.business_id = 'jewelry' OR NEW.business_id = 'jewelry')
       AND OLD.status IS DISTINCT FROM NEW.status
       AND NOT public.is_jasmin_owner() THEN
        RAISE EXCEPTION 'Only an owner can change the status of a jewelry transaction.';
    END IF;

    IF OLD.status IS DISTINCT FROM NEW.status
       AND NEW.status = 'CANCELLED'
       AND NOT public.is_jasmin_owner() THEN
        RAISE EXCEPTION 'Only an owner can cancel a transaction.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_unauthorized_transaction_cancel
BEFORE UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.prevent_unauthorized_transaction_cancel();

ALTER TABLE public.jewelry_sales
ADD COLUMN transaction_id UUID REFERENCES public.transactions(id);
CREATE UNIQUE INDEX jewelry_sales_transaction_id_uidx
ON public.jewelry_sales(transaction_id);

CREATE TABLE public.jewelry_sale_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID NOT NULL UNIQUE REFERENCES public.transactions(id),
    inventory_item_id UUID NOT NULL REFERENCES public.jewelry_inventory(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(14, 2) NOT NULL CHECK (unit_price > 0),
    customer_name TEXT NOT NULL,
    processed_by UUID NOT NULL REFERENCES public.user_profiles(id),
    status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL'
        CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX jewelry_sale_requests_pending_item_idx
ON public.jewelry_sale_requests(inventory_item_id)
WHERE status = 'PENDING_APPROVAL';
ALTER TABLE public.jewelry_sale_requests ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.submit_jewelry_sale_request(
    p_inventory_item_id UUID,
    p_quantity INTEGER,
    p_customer_name TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item_name TEXT;
    v_unit_price NUMERIC(14, 2);
    v_available_quantity INTEGER;
    v_reserved_quantity INTEGER;
    v_customer_name TEXT := COALESCE(NULLIF(BTRIM(p_customer_name), ''), 'Walk-in Customer');
    v_submitted_by_name TEXT;
    v_transaction_id UUID := uuid_generate_v4();
    v_reference_no TEXT;
    v_amount NUMERIC(14, 2);
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_business_access('jewelry') THEN
        RAISE EXCEPTION 'Jewelry business access is required to submit a sale.';
    END IF;
    IF p_quantity IS NULL OR p_quantity < 1 THEN
        RAISE EXCEPTION 'Sale quantity must be at least one.';
    END IF;

    SELECT name, selling_price, quantity
    INTO v_item_name, v_unit_price, v_available_quantity
    FROM public.jewelry_inventory
    WHERE id = p_inventory_item_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The selected jewelry item no longer exists.';
    END IF;
    IF v_unit_price <= 0 THEN
        RAISE EXCEPTION 'The jewelry item must have a positive selling price.';
    END IF;

    SELECT COALESCE(SUM(quantity), 0)::INTEGER
    INTO v_reserved_quantity
    FROM public.jewelry_sale_requests
    WHERE inventory_item_id = p_inventory_item_id
      AND status = 'PENDING_APPROVAL';
    IF p_quantity > v_available_quantity - v_reserved_quantity THEN
        RAISE EXCEPTION 'Requested quantity exceeds unreserved jewelry stock.';
    END IF;

    SELECT full_name INTO v_submitted_by_name
    FROM public.user_profiles
    WHERE id = auth.uid();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'A registered user profile is required to submit a sale.';
    END IF;

    v_amount := ROUND(v_unit_price * p_quantity, 2);
    v_reference_no := 'JAST-JW-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
        UPPER(SUBSTRING(REPLACE(v_transaction_id::TEXT, '-', '') FROM 1 FOR 6));

    INSERT INTO public.transactions (
        id, reference_no, business_id, tx_type, category, counterparty_name,
        description, amount, vat_amount, reconciled, status, gate_reason,
        submitted_by, submitted_by_name, tx_date
    ) VALUES (
        v_transaction_id, v_reference_no, 'jewelry', 'INCOME',
        'Bespoke Diamond & Gold Sales', v_customer_name,
        v_item_name || ' × ' || p_quantity::TEXT, v_amount,
        ROUND((v_amount / 1.12) * 0.12, 2), FALSE, 'PENDING_APPROVAL',
        'Jewelry sale requires Owner authorization before completion',
        auth.uid(), v_submitted_by_name, CURRENT_DATE
    );

    INSERT INTO public.jewelry_sale_requests (
        transaction_id, inventory_item_id, quantity, unit_price,
        customer_name, processed_by
    ) VALUES (
        v_transaction_id, p_inventory_item_id, p_quantity, v_unit_price,
        v_customer_name, auth.uid()
    );

    RETURN v_transaction_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_jewelry_sale_request(UUID, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_jewelry_sale_request(UUID, INTEGER, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.finalize_jewelry_sale_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_request public.jewelry_sale_requests%ROWTYPE;
BEGIN
    IF OLD.status = 'PENDING_APPROVAL'
       AND NEW.status IN ('APPROVED', 'REJECTED', 'CANCELLED') THEN
        SELECT * INTO v_request
        FROM public.jewelry_sale_requests
        WHERE transaction_id = NEW.id
        FOR UPDATE;

        IF FOUND AND v_request.status = 'PENDING_APPROVAL' THEN
            IF NEW.status = 'APPROVED' THEN
                INSERT INTO public.jewelry_sales (
                    inventory_item_id, quantity, unit_price, customer_name,
                    processed_by, transaction_id
                ) VALUES (
                    v_request.inventory_item_id, v_request.quantity,
                    v_request.unit_price, v_request.customer_name,
                    v_request.processed_by, NEW.id
                );
            END IF;

            UPDATE public.jewelry_sale_requests
            SET status = NEW.status
            WHERE id = v_request.id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_finalize_jewelry_sale_request
AFTER UPDATE OF status ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.finalize_jewelry_sale_request();

CREATE OR REPLACE FUNCTION public.link_jewelry_sale_transaction(p_sale_id UUID, p_transaction_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sale public.jewelry_sales%ROWTYPE;
    v_transaction public.transactions%ROWTYPE;
    v_item_name TEXT;
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_business_access('jewelry') THEN
        RAISE EXCEPTION 'Jewelry business access is required to link this sale.';
    END IF;

    SELECT * INTO v_sale FROM public.jewelry_sales WHERE id = p_sale_id FOR UPDATE;
    IF NOT FOUND OR v_sale.processed_by <> auth.uid() THEN
        RAISE EXCEPTION 'You can only link a jewelry sale that you recorded.';
    END IF;
    IF v_sale.transaction_id IS NOT NULL THEN
        IF v_sale.transaction_id = p_transaction_id THEN
            RETURN;
        END IF;
        RAISE EXCEPTION 'This jewelry sale is already linked to a different ledger transaction.';
    END IF;

    SELECT name INTO v_item_name
    FROM public.jewelry_inventory
    WHERE id = v_sale.inventory_item_id;

    SELECT * INTO v_transaction
    FROM public.transactions
    WHERE id = p_transaction_id;
    IF NOT FOUND
       OR v_transaction.business_id <> 'jewelry'
       OR v_transaction.tx_type <> 'INCOME'
       OR v_transaction.submitted_by <> auth.uid()
       OR v_transaction.counterparty_name <> v_sale.customer_name
       OR v_transaction.description <> v_item_name || ' × ' || v_sale.quantity::TEXT
       OR v_transaction.amount <> ROUND(v_sale.unit_price * v_sale.quantity, 2) THEN
        RAISE EXCEPTION 'The ledger entry does not match this jewelry sale.';
    END IF;

    UPDATE public.jewelry_sales
    SET transaction_id = p_transaction_id
    WHERE id = p_sale_id AND transaction_id IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.link_jewelry_sale_transaction(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_jewelry_sale_transaction(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.return_jewelry_sale(p_sale_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sale public.jewelry_sales%ROWTYPE;
    v_return_id UUID := gen_random_uuid();
    v_original_transaction public.transactions%ROWTYPE;
    v_refund_transaction_id UUID;
    v_reference TEXT;
    v_owner_name TEXT;
    v_amount NUMERIC(14, 2);
    v_match_count INTEGER;
    v_item_name TEXT;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_jasmin_owner() THEN
        RAISE EXCEPTION 'Only an owner can process jewelry returns.';
    END IF;

    SELECT * INTO v_sale
    FROM public.jewelry_sales
    WHERE id = p_sale_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Jewelry sale not found.';
    END IF;
    IF v_sale.sold_at > NOW() OR v_sale.sold_at < NOW() - INTERVAL '7 days' THEN
        RAISE EXCEPTION 'Jewelry returns are only allowed within 7 days of purchase.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.jewelry_returns WHERE sale_id = p_sale_id) THEN
        RAISE EXCEPTION 'This jewelry sale has already been returned or refunded.';
    END IF;
    IF v_sale.transaction_id IS NULL THEN
        SELECT name INTO v_item_name
        FROM public.jewelry_inventory
        WHERE id = v_sale.inventory_item_id;

        SELECT COUNT(*), (ARRAY_AGG(t.id))[1]
        INTO v_match_count, v_sale.transaction_id
        FROM public.transactions t
        WHERE t.business_id = 'jewelry'
          AND t.tx_type = 'INCOME'
          AND t.category = 'Bespoke Diamond & Gold Sales'
          AND t.counterparty_name = v_sale.customer_name
          AND t.description = v_item_name || ' × ' || v_sale.quantity::TEXT
          AND t.amount = ROUND(v_sale.unit_price * v_sale.quantity, 2)
          AND t.tx_date = v_sale.sold_at::DATE
          AND t.status IN ('APPROVED', 'PENDING_APPROVAL');
        IF v_match_count <> 1 THEN
            RAISE EXCEPTION 'Could not find exactly one matching original sale transaction (found %). The sale was not refunded.', v_match_count;
        END IF;
        UPDATE public.jewelry_sales
        SET transaction_id = v_sale.transaction_id
        WHERE id = p_sale_id AND transaction_id IS NULL;
    END IF;

    SELECT * INTO v_original_transaction
    FROM public.transactions
    WHERE id = v_sale.transaction_id
    FOR UPDATE;
    IF NOT FOUND OR v_original_transaction.business_id <> 'jewelry' OR v_original_transaction.tx_type <> 'INCOME'
       OR v_original_transaction.status NOT IN ('APPROVED', 'PENDING_APPROVAL') THEN
        RAISE EXCEPTION 'The original jewelry sale transaction is missing or cannot be cancelled.';
    END IF;

    SELECT full_name INTO v_owner_name
    FROM public.user_profiles
    WHERE id = auth.uid();
    IF v_owner_name IS NULL THEN
        RAISE EXCEPTION 'Owner profile not found.';
    END IF;

    v_amount := ROUND(v_sale.unit_price * v_sale.quantity, 2);
    v_reference := 'JAST-JW-RETURN-' || UPPER(SUBSTRING(REPLACE(v_return_id::TEXT, '-', '') FROM 1 FOR 12));

    UPDATE public.transactions
    SET status = 'CANCELLED',
        approved_by = auth.uid(),
        approved_at = NOW(),
        gate_reason = 'Cancelled due to full jewelry return/refund within 7 days',
        updated_at = NOW()
    WHERE id = v_sale.transaction_id;

    IF v_amount > 0 THEN
        INSERT INTO public.transactions (
            reference_no, business_id, tx_type, category, counterparty_name,
            description, amount, vat_amount, reconciled, gate_reason,
            submitted_by, submitted_by_name, tx_date
        ) VALUES (
            v_reference, 'jewelry', 'EXPENSE', 'Jewelry Sales Return / Refund',
            v_sale.customer_name,
            'Full return of jewelry sale ' || p_sale_id::TEXT || ' (' || v_sale.quantity || ' item(s))',
            v_amount, -ROUND((v_amount / 1.12) * 0.12, 2), FALSE,
            'Owner-recorded refund for a return within the 7-day window',
            auth.uid(), v_owner_name, CURRENT_DATE
        )
        RETURNING id INTO v_refund_transaction_id;
    END IF;

    UPDATE public.jewelry_inventory
    SET quantity = quantity + v_sale.quantity,
        updated_at = NOW()
    WHERE id = v_sale.inventory_item_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Jewelry inventory item for this sale no longer exists.';
    END IF;

    INSERT INTO public.jewelry_returns (id, sale_id, transaction_id, amount, processed_by)
    VALUES (v_return_id, p_sale_id, v_refund_transaction_id, v_amount, auth.uid());

    RETURN v_return_id;
END;
$$;

REVOKE ALL ON FUNCTION public.return_jewelry_sale(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.return_jewelry_sale(UUID) TO authenticated;

-- 7. ROW-LEVEL SECURITY (RLS) POLICIES FOR MULTI-BUSINESS ISOLATION
ALTER TABLE public.business_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_business_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jewelry_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pickleball_courts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jewelry_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jewelry_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Business units are readable by authenticated users
GRANT SELECT ON public.business_units TO authenticated;
GRANT SELECT ON public.user_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_business_access TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.properties TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.property_bookings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.jewelry_inventory TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.pickleball_courts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.court_bookings TO authenticated;
GRANT SELECT, INSERT ON public.jewelry_sales TO authenticated;
GRANT SELECT ON public.jewelry_returns TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.transactions TO authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;

CREATE POLICY "Authenticated users can view business units"
ON public.business_units FOR SELECT TO authenticated USING (true);

-- User profiles: users read own profile; owner reads all
CREATE POLICY "Users read own profile or owner reads all"
ON public.user_profiles FOR SELECT TO authenticated
USING (auth.uid() = id OR public.is_jasmin_owner());

CREATE POLICY "Users read their own business access"
ON public.user_business_access FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_jasmin_owner());

CREATE POLICY "Jasmin manages staff business access"
ON public.user_business_access FOR ALL TO authenticated
USING (public.is_jasmin_owner())
WITH CHECK (public.is_jasmin_owner());

CREATE POLICY "Jasmin manages property catalog"
ON public.properties FOR ALL TO authenticated
USING (public.is_jasmin_owner())
WITH CHECK (public.is_jasmin_owner());

CREATE POLICY "Real estate staff can view properties"
ON public.properties FOR SELECT TO authenticated
USING (public.has_business_access('real_estate'));

CREATE POLICY "Real estate staff can view property bookings"
ON public.property_bookings FOR SELECT TO authenticated
USING (public.has_business_access('real_estate'));

CREATE POLICY "Real estate staff can process property bookings"
ON public.property_bookings FOR INSERT TO authenticated
WITH CHECK (
    public.has_business_access('real_estate')
    AND processed_by = auth.uid()
);

CREATE POLICY "Owner can update property bookings"
ON public.property_bookings FOR UPDATE TO authenticated
USING (public.is_jasmin_owner())
WITH CHECK (public.is_jasmin_owner());

CREATE POLICY "Jewelry staff can view inventory"
ON public.jewelry_inventory FOR SELECT TO authenticated
USING (public.has_business_access('jewelry'));

CREATE POLICY "Jasmin manages jewelry inventory"
ON public.jewelry_inventory FOR ALL TO authenticated
USING (public.is_jasmin_owner())
WITH CHECK (public.is_jasmin_owner());

CREATE POLICY "Pickleball staff can view courts"
ON public.pickleball_courts FOR SELECT TO authenticated
USING (public.has_business_access('pickleball'));

CREATE POLICY "Jasmin manages pickleball courts"
ON public.pickleball_courts FOR ALL TO authenticated
USING (public.is_jasmin_owner())
WITH CHECK (public.is_jasmin_owner());

CREATE POLICY "Pickleball staff view bookings"
ON public.court_bookings FOR SELECT TO authenticated
USING (public.has_business_access('pickleball'));

CREATE POLICY "Pickleball staff process bookings"
ON public.court_bookings FOR INSERT TO authenticated
WITH CHECK (
    public.has_business_access('pickleball')
    AND processed_by = auth.uid()
);

CREATE POLICY "Owner can update court bookings"
ON public.court_bookings FOR UPDATE TO authenticated
USING (public.is_jasmin_owner())
WITH CHECK (public.is_jasmin_owner());

CREATE POLICY "Jewelry staff view sales"
ON public.jewelry_sales FOR SELECT TO authenticated
USING (public.has_business_access('jewelry'));

CREATE POLICY "Owner can insert jewelry sales"
ON public.jewelry_sales FOR INSERT TO authenticated
WITH CHECK (public.is_jasmin_owner());

CREATE POLICY "Jewelry staff can view returns"
ON public.jewelry_returns FOR SELECT TO authenticated
USING (public.has_business_access('jewelry'));

-- Transactions SELECT isolation: Owner sees all; staff see ONLY their assigned business_id
CREATE POLICY "Strict multi-business SELECT isolation"
ON public.transactions FOR SELECT TO authenticated
USING (
    public.has_business_access(transactions.business_id)
);

-- Transactions INSERT isolation: Staff can only insert into their own business_id
CREATE POLICY "Strict multi-business INSERT isolation"
ON public.transactions FOR INSERT TO authenticated
WITH CHECK (
    public.has_business_access(transactions.business_id)
);

-- Transactions UPDATE isolation: Only Owner can approve/reject; staff can reconcile own branch
CREATE POLICY "Owner approval and branch reconciliation UPDATE policy"
ON public.transactions FOR UPDATE TO authenticated
USING (
    public.has_business_access(transactions.business_id)
)
WITH CHECK (public.has_business_access(transactions.business_id));

-- Audit logs: Owner sees all; staff see only their own business logs
CREATE POLICY "Strict multi-business audit log isolation"
ON public.audit_logs FOR SELECT TO authenticated
USING (
    public.has_business_access(audit_logs.business_id)
);

-- Storage Bucket for Receipts (Run in Supabase SQL Editor)
INSERT INTO storage.buckets (id, name, public, allowed_mime_types)
VALUES ('receipt-vault', 'receipt-vault', false, ARRAY['application/pdf', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = false,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Private jewelry image storage. Save returned object paths in photo_paths.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('jewelry-images', 'jewelry-images', false, 8388608, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('property-images', 'property-images', false, 8388608, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Real estate staff can view property photos" ON storage.objects;
DROP POLICY IF EXISTS "Jasmin uploads property photos" ON storage.objects;
DROP POLICY IF EXISTS "Jasmin updates property photos" ON storage.objects;
DROP POLICY IF EXISTS "Jasmin deletes property photos" ON storage.objects;
DROP POLICY IF EXISTS "Jewelry staff can view jewelry photos" ON storage.objects;
DROP POLICY IF EXISTS "Jasmin uploads jewelry photos" ON storage.objects;
DROP POLICY IF EXISTS "Jasmin updates jewelry photos" ON storage.objects;
DROP POLICY IF EXISTS "Jasmin deletes jewelry photos" ON storage.objects;
DROP POLICY IF EXISTS "Venture users can view transaction receipts" ON storage.objects;
DROP POLICY IF EXISTS "Venture users can upload transaction receipts" ON storage.objects;
DROP POLICY IF EXISTS "Users can remove their own transaction receipts" ON storage.objects;

CREATE POLICY "Venture users can view transaction receipts"
ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'receipt-vault'
    AND public.has_business_access((storage.foldername(name))[1])
);

CREATE POLICY "Venture users can upload transaction receipts"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'receipt-vault'
    AND public.has_business_access((storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "Users can remove their own transaction receipts"
ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'receipt-vault'
    AND public.has_business_access((storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "Real estate staff can view property photos"
ON storage.objects FOR SELECT TO authenticated
USING (
bucket_id = 'property-images'
AND public.has_business_access('real_estate')
);

CREATE POLICY "Jasmin uploads property photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
bucket_id = 'property-images'
AND public.is_jasmin_owner()
);

CREATE POLICY "Jasmin updates property photos"
ON storage.objects FOR UPDATE TO authenticated
USING (
bucket_id = 'property-images'
AND public.is_jasmin_owner()
)
WITH CHECK (
bucket_id = 'property-images'
AND public.is_jasmin_owner()
);

CREATE POLICY "Jasmin deletes property photos"
ON storage.objects FOR DELETE TO authenticated
USING (
bucket_id = 'property-images'
AND public.is_jasmin_owner()
);

CREATE POLICY "Jewelry staff can view jewelry photos"
ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'jewelry-images'
    AND public.has_business_access('jewelry')
);

CREATE POLICY "Jasmin uploads jewelry photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'jewelry-images'
    AND public.is_jasmin_owner()
);

CREATE POLICY "Jasmin updates jewelry photos"
ON storage.objects FOR UPDATE TO authenticated
USING (
    bucket_id = 'jewelry-images'
    AND public.is_jasmin_owner()
)
WITH CHECK (
    bucket_id = 'jewelry-images'
    AND public.is_jasmin_owner()
);

CREATE POLICY "Jasmin deletes jewelry photos"
ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'jewelry-images'
    AND public.is_jasmin_owner()
);
