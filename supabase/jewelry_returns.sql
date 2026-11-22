-- Owner-only full jewelry sale returns within seven days of purchase.
-- Apply this migration to existing Supabase projects.
CREATE TABLE IF NOT EXISTS public.jewelry_returns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sale_id UUID NOT NULL UNIQUE REFERENCES public.jewelry_sales(id),
    transaction_id UUID UNIQUE REFERENCES public.transactions(id),
    amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
    processed_by UUID NOT NULL REFERENCES public.user_profiles(id),
    returned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.jewelry_returns ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.jewelry_returns TO authenticated;

DROP POLICY IF EXISTS "Owner can view jewelry returns" ON public.jewelry_returns;
DROP POLICY IF EXISTS "Jewelry staff can view returns" ON public.jewelry_returns;
CREATE POLICY "Jewelry staff can view returns"
ON public.jewelry_returns FOR SELECT TO authenticated
USING (public.has_business_access('jewelry'));

CREATE OR REPLACE FUNCTION public.return_jewelry_sale(p_sale_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sale public.jewelry_sales%ROWTYPE;
    v_return_id UUID := uuid_generate_v4();
    v_transaction_id UUID;
    v_reference TEXT;
    v_owner_name TEXT;
    v_amount NUMERIC(14, 2);
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

    SELECT full_name INTO v_owner_name
    FROM public.user_profiles
    WHERE id = auth.uid();
    IF v_owner_name IS NULL THEN
        RAISE EXCEPTION 'Owner profile not found.';
    END IF;

    v_amount := ROUND(v_sale.unit_price * v_sale.quantity, 2);
    v_reference := 'JAST-JW-RETURN-' || UPPER(SUBSTRING(REPLACE(v_return_id::TEXT, '-', '') FROM 1 FOR 12));

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
        RETURNING id INTO v_transaction_id;
    END IF;

    UPDATE public.jewelry_inventory
    SET quantity = quantity + v_sale.quantity,
        updated_at = NOW()
    WHERE id = v_sale.inventory_item_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Jewelry inventory item for this sale no longer exists.';
    END IF;

    INSERT INTO public.jewelry_returns (id, sale_id, transaction_id, amount, processed_by)
    VALUES (v_return_id, p_sale_id, v_transaction_id, v_amount, auth.uid());

    RETURN v_return_id;
END;
$$;

REVOKE ALL ON FUNCTION public.return_jewelry_sale(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.return_jewelry_sale(UUID) TO authenticated;
