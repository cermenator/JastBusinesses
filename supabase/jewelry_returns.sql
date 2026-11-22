-- Owner-only full jewelry sale returns within seven days of purchase.
-- Reapply this migration to existing Supabase projects to enable cancellation
-- of the original sale transaction, audit logging, stock restoration, and refund.
ALTER TABLE public.transactions
DROP CONSTRAINT IF EXISTS transactions_status_check;
ALTER TABLE public.transactions
ADD CONSTRAINT transactions_status_check
CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED'));

ALTER TABLE public.audit_logs
DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE public.audit_logs
ADD CONSTRAINT audit_logs_action_check
CHECK (action IN ('INSERT', 'APPROVE', 'REJECT', 'RECONCILE', 'UPDATE', 'CANCEL'));

ALTER TABLE public.jewelry_sales
ADD COLUMN IF NOT EXISTS transaction_id UUID REFERENCES public.transactions(id);
CREATE UNIQUE INDEX IF NOT EXISTS jewelry_sales_transaction_id_uidx
ON public.jewelry_sales(transaction_id);

-- Link historic POS sales to their unique ledger entry where the sale details match.
WITH matches AS (
    SELECT
        js.id AS sale_id,
        (ARRAY_AGG(t.id))[1] AS transaction_id
    FROM public.jewelry_sales js
    JOIN public.jewelry_inventory ji ON ji.id = js.inventory_item_id
    JOIN public.transactions t
      ON t.business_id = 'jewelry'
     AND t.tx_type = 'INCOME'
     AND t.category = 'Bespoke Diamond & Gold Sales'
     AND t.counterparty_name = js.customer_name
     AND t.description = ji.name || ' × ' || js.quantity::TEXT
     AND t.amount = ROUND(js.unit_price * js.quantity, 2)
     AND t.tx_date = js.sold_at::DATE
     AND t.status IN ('APPROVED', 'PENDING_APPROVAL')
    WHERE js.transaction_id IS NULL
    GROUP BY js.id
    HAVING COUNT(*) = 1
)
UPDATE public.jewelry_sales js
SET transaction_id = matches.transaction_id
FROM matches
WHERE js.id = matches.sale_id;

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
    ELSIF v_threshold IS NULL THEN
        NEW.status := 'APPROVED';
        NEW.gate_reason := 'Auto-cleared within branch operational limit';
    ELSIF NEW.amount > v_threshold THEN
        NEW.status := 'PENDING_APPROVAL';
        NEW.gate_reason := 'Exceeds PHP ' || TO_CHAR(v_threshold, 'FM999,999,990.00') || ' automated threshold';
    ELSIF NEW.business_id = 'jewelry' AND NEW.tx_type = 'INVENTORY_WRITEOFF' THEN
        NEW.status := 'PENDING_APPROVAL';
        NEW.gate_reason := 'Jewelry vault inventory write-off requires Owner authorization';
    ELSE
        NEW.status := 'APPROVED';
        NEW.gate_reason := 'Auto-cleared within branch operational limit';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_transaction_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.prevent_unauthorized_transaction_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status
       AND NEW.status = 'CANCELLED'
       AND NOT public.is_jasmin_owner() THEN
        RAISE EXCEPTION 'Only an owner can cancel a transaction.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_unauthorized_transaction_cancel ON public.transactions;
CREATE TRIGGER trg_prevent_unauthorized_transaction_cancel
BEFORE UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.prevent_unauthorized_transaction_cancel();

CREATE TABLE IF NOT EXISTS public.jewelry_returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL UNIQUE REFERENCES public.jewelry_sales(id),
    transaction_id UUID UNIQUE REFERENCES public.transactions(id),
    amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
    processed_by UUID NOT NULL REFERENCES public.user_profiles(id),
    returned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.jewelry_returns
ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE public.jewelry_returns ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.jewelry_returns TO authenticated;

DROP POLICY IF EXISTS "Owner can view jewelry returns" ON public.jewelry_returns;
DROP POLICY IF EXISTS "Jewelry staff can view returns" ON public.jewelry_returns;
CREATE POLICY "Jewelry staff can view returns"
ON public.jewelry_returns FOR SELECT TO authenticated
USING (public.has_business_access('jewelry'));

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
    v_original_transaction public.transactions%ROWTYPE;
    v_return_id UUID := gen_random_uuid();
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
    IF NOT FOUND OR v_original_transaction.business_id <> 'jewelry'
       OR v_original_transaction.tx_type <> 'INCOME'
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
            'Full return of jewelry sale ' || v_sale.id::TEXT || ' (' || v_sale.quantity || ' item(s))',
            v_amount, -ROUND((v_amount / 1.12) * 0.12, 2), FALSE,
            'Owner-authorized refund for a return within the 7-day window',
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
