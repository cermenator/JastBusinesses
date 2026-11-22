-- Require owner approval for every jewelry transaction and finalize POS sales
-- only after the owner approves their pending ledger transaction.

CREATE OR REPLACE FUNCTION public.evaluate_owner_approval_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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
    ELSIF NEW.business_id = 'jewelry' THEN
        NEW.status := 'PENDING_APPROVAL';
        NEW.gate_reason := 'All jewelry transactions require Owner authorization';
    ELSIF v_threshold IS NULL THEN
        NEW.status := 'APPROVED';
        NEW.gate_reason := 'Auto-cleared within branch operational limit';
    ELSIF NEW.amount > v_threshold THEN
        NEW.status := 'PENDING_APPROVAL';
        NEW.gate_reason := 'Exceeds PHP ' || TO_CHAR(v_threshold, 'FM999,999,990.00') || ' automated threshold';
    ELSE
        NEW.status := 'APPROVED';
        NEW.gate_reason := 'Auto-cleared within branch operational limit';
    END IF;
    RETURN NEW;
END;
$$;

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

CREATE TABLE IF NOT EXISTS public.jewelry_sale_requests (
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
CREATE INDEX IF NOT EXISTS jewelry_sale_requests_pending_item_idx
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

DROP TRIGGER IF EXISTS trg_finalize_jewelry_sale_request ON public.transactions;
CREATE TRIGGER trg_finalize_jewelry_sale_request
AFTER UPDATE OF status ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.finalize_jewelry_sale_request();

DROP POLICY IF EXISTS "Jewelry staff process sales" ON public.jewelry_sales;
DROP POLICY IF EXISTS "Owner can insert jewelry sales" ON public.jewelry_sales;
CREATE POLICY "Owner can insert jewelry sales"
ON public.jewelry_sales FOR INSERT TO authenticated
WITH CHECK (public.is_jasmin_owner());
