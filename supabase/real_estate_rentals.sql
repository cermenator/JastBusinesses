-- Add auditable rent/deposit collections and inspected property checkout.
-- Apply this to existing projects before using the updated Operations screen.

ALTER TABLE public.property_bookings
    ALTER COLUMN end_date DROP NOT NULL;
ALTER TABLE public.property_bookings
    DROP CONSTRAINT IF EXISTS property_bookings_check;
ALTER TABLE public.property_bookings
    DROP CONSTRAINT IF EXISTS property_bookings_status_check;
ALTER TABLE public.property_bookings
    ADD CONSTRAINT property_bookings_status_check
    CHECK (status IN ('pending_payment', 'confirmed', 'cancelled', 'checked_out'));
ALTER TABLE public.property_bookings
    ALTER COLUMN status SET DEFAULT 'pending_payment';
ALTER TABLE public.property_bookings
    ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(14, 2);
UPDATE public.property_bookings
SET deposit_amount = monthly_rent * 2
WHERE deposit_amount IS NULL OR deposit_amount = 0;
ALTER TABLE public.property_bookings
    ALTER COLUMN deposit_amount SET DEFAULT 0,
    ALTER COLUMN deposit_amount SET NOT NULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'property_bookings_deposit_amount_check'
          AND conrelid = 'public.property_bookings'::regclass
    ) THEN
        ALTER TABLE public.property_bookings
        ADD CONSTRAINT property_bookings_deposit_amount_check
        CHECK (deposit_amount >= 0);
    END IF;
END;
$$;
ALTER TABLE public.property_bookings
    DROP CONSTRAINT IF EXISTS property_bookings_date_range_check;
ALTER TABLE public.property_bookings
    ADD CONSTRAINT property_bookings_date_range_check
    CHECK (end_date IS NULL OR end_date >= start_date);

CREATE TABLE IF NOT EXISTS public.property_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_booking_id UUID NOT NULL REFERENCES public.property_bookings(id),
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    rent_amount NUMERIC(14, 2) NOT NULL CHECK (rent_amount >= 0),
    deposit_amount NUMERIC(14, 2) NOT NULL CHECK (deposit_amount >= 0),
    received_on DATE NOT NULL DEFAULT CURRENT_DATE,
    recorded_by UUID NOT NULL REFERENCES public.user_profiles(id),
    status TEXT NOT NULL DEFAULT 'pending_confirmation'
        CHECK (status IN ('pending_confirmation', 'confirmed', 'rejected')),
    confirmed_by UUID REFERENCES public.user_profiles(id),
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (amount = rent_amount + deposit_amount)
);
CREATE INDEX IF NOT EXISTS property_payments_booking_status_idx
ON public.property_payments(property_booking_id, status);

CREATE TABLE IF NOT EXISTS public.property_checkouts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_booking_id UUID NOT NULL UNIQUE REFERENCES public.property_bookings(id),
    damage_amount NUMERIC(14, 2) NOT NULL CHECK (damage_amount >= 0),
    deposit_refund_amount NUMERIC(14, 2) CHECK (deposit_refund_amount >= 0),
    inspection_notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending_owner_approval'
        CHECK (status IN ('pending_owner_approval', 'approved', 'rejected')),
    recorded_by UUID NOT NULL REFERENCES public.user_profiles(id),
    approved_by UUID REFERENCES public.user_profiles(id),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.property_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_checkouts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.property_payments TO authenticated;
GRANT SELECT ON public.property_checkouts TO authenticated;

DROP POLICY IF EXISTS "Real estate staff can view property payments" ON public.property_payments;
CREATE POLICY "Real estate staff can view property payments"
ON public.property_payments FOR SELECT TO authenticated
USING (public.has_business_access('real_estate'));

DROP POLICY IF EXISTS "Real estate staff can view property checkouts" ON public.property_checkouts;
CREATE POLICY "Real estate staff can view property checkouts"
ON public.property_checkouts FOR SELECT TO authenticated
USING (public.has_business_access('real_estate'));

CREATE OR REPLACE FUNCTION public.prevent_property_booking_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status IN ('pending_payment', 'confirmed') THEN
        PERFORM 1 FROM public.properties WHERE id = NEW.property_id FOR UPDATE;

        IF EXISTS (
            SELECT 1
            FROM public.property_bookings pb
            WHERE pb.property_id = NEW.property_id
              AND pb.status IN ('pending_payment', 'confirmed')
              AND pb.id IS DISTINCT FROM NEW.id
              AND (NEW.end_date IS NULL OR pb.start_date <= NEW.end_date)
              AND (pb.end_date IS NULL OR pb.end_date >= NEW.start_date)
        ) THEN
            RAISE EXCEPTION 'This property already has a booking during the selected dates.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_property_booking_overlap ON public.property_bookings;
CREATE TRIGGER trg_prevent_property_booking_overlap
BEFORE INSERT OR UPDATE ON public.property_bookings
FOR EACH ROW EXECUTE FUNCTION public.prevent_property_booking_overlap();

CREATE OR REPLACE FUNCTION public.prevent_unauthorized_property_booking_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT'
       AND NEW.status <> 'pending_payment'
       AND NOT public.is_jasmin_owner() THEN
        RAISE EXCEPTION 'New property bookings must await owner payment confirmation.';
    END IF;
    IF TG_OP = 'UPDATE'
       AND OLD.status IS DISTINCT FROM NEW.status
       AND NOT public.is_jasmin_owner() THEN
        RAISE EXCEPTION 'Only an owner can change property booking status.';
    END IF;
    IF TG_OP = 'UPDATE'
       AND OLD.status = 'confirmed'
       AND NEW.status = 'cancelled' THEN
        RAISE EXCEPTION 'Active tenants must use the inspected checkout and deposit refund workflow.';
    END IF;
    IF TG_OP = 'UPDATE'
       AND OLD.status = 'pending_payment'
       AND NEW.status = 'cancelled'
       AND EXISTS (
           SELECT 1
           FROM public.property_payments
           WHERE property_booking_id = OLD.id
             AND status = 'pending_confirmation'
       ) THEN
        RAISE EXCEPTION 'Confirm or reject pending payments before cancelling this reservation.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_unauthorized_property_booking_status_change ON public.property_bookings;
CREATE TRIGGER trg_prevent_unauthorized_property_booking_status_change
BEFORE INSERT OR UPDATE ON public.property_bookings
FOR EACH ROW EXECUTE FUNCTION public.prevent_unauthorized_property_booking_status_change();

CREATE OR REPLACE FUNCTION public.record_property_payment(
    p_booking_id UUID,
    p_amount NUMERIC,
    p_rent_amount NUMERIC,
    p_deposit_amount NUMERIC,
    p_received_on DATE DEFAULT CURRENT_DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_booking public.property_bookings%ROWTYPE;
    v_deposit_reserved NUMERIC(14, 2);
    v_payment_id UUID := uuid_generate_v4();
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_business_access('real_estate') THEN
        RAISE EXCEPTION 'Real estate access is required to record a payment.';
    END IF;
    IF p_received_on > CURRENT_DATE THEN
        RAISE EXCEPTION 'Payment received date cannot be in the future.';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0
       OR p_rent_amount IS NULL OR p_rent_amount < 0
       OR p_deposit_amount IS NULL OR p_deposit_amount < 0
       OR ROUND(p_amount, 2) <> ROUND(p_rent_amount + p_deposit_amount, 2) THEN
        RAISE EXCEPTION 'Payment must be positive and allocated exactly between rent and deposit.';
    END IF;

    SELECT * INTO v_booking
    FROM public.property_bookings
    WHERE id = p_booking_id
    FOR UPDATE;
    IF NOT FOUND OR v_booking.status NOT IN ('pending_payment', 'confirmed') THEN
        RAISE EXCEPTION 'The property booking is not accepting payments.';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.property_checkouts
        WHERE property_booking_id = p_booking_id
          AND status = 'pending_owner_approval'
    ) THEN
        RAISE EXCEPTION 'Resolve the pending checkout inspection before recording another payment.';
    END IF;

    SELECT COALESCE(SUM(deposit_amount), 0)
    INTO v_deposit_reserved
    FROM public.property_payments
    WHERE property_booking_id = p_booking_id
      AND status IN ('pending_confirmation', 'confirmed');
    IF v_deposit_reserved + p_deposit_amount > v_booking.deposit_amount THEN
        RAISE EXCEPTION 'Deposit allocation exceeds the required deposit balance.';
    END IF;

    INSERT INTO public.property_payments (
        id, property_booking_id, amount, rent_amount, deposit_amount,
        received_on, recorded_by
    ) VALUES (
        v_payment_id, p_booking_id, ROUND(p_amount, 2), ROUND(p_rent_amount, 2),
        ROUND(p_deposit_amount, 2), COALESCE(p_received_on, CURRENT_DATE), auth.uid()
    );
    RETURN v_payment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_property_payment(p_payment_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_payment public.property_payments%ROWTYPE;
    v_booking public.property_bookings%ROWTYPE;
    v_submitter_name TEXT;
    v_reference_no TEXT;
BEGIN
    IF NOT public.is_jasmin_owner() THEN
        RAISE EXCEPTION 'Only an owner can confirm a property payment.';
    END IF;

    SELECT * INTO v_payment
    FROM public.property_payments
    WHERE id = p_payment_id
    FOR UPDATE;
    IF NOT FOUND OR v_payment.status <> 'pending_confirmation' THEN
        RAISE EXCEPTION 'This property payment is no longer awaiting confirmation.';
    END IF;
    SELECT * INTO v_booking
    FROM public.property_bookings
    WHERE id = v_payment.property_booking_id
    FOR UPDATE;
    IF NOT FOUND OR v_booking.status NOT IN ('pending_payment', 'confirmed') THEN
        RAISE EXCEPTION 'The associated booking is not active.';
    END IF;

    UPDATE public.property_payments
    SET status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = NOW()
    WHERE id = v_payment.id;

    IF v_booking.status = 'pending_payment' THEN
        UPDATE public.property_bookings
        SET status = 'confirmed'
        WHERE id = v_booking.id;
    END IF;

    IF v_payment.rent_amount > 0 THEN
        SELECT full_name INTO v_submitter_name
        FROM public.user_profiles
        WHERE id = v_payment.recorded_by;
        v_reference_no := 'JAST-RE-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
            UPPER(SUBSTRING(REPLACE(uuid_generate_v4()::TEXT, '-', '') FROM 1 FOR 6));

        INSERT INTO public.transactions (
            reference_no, business_id, tx_type, category, counterparty_name,
            description, amount, vat_amount, reconciled, status, gate_reason,
            submitted_by, submitted_by_name, approved_by, approved_at, tx_date
        ) VALUES (
            v_reference_no, 'real_estate', 'INCOME', 'Property Rent Collection',
            v_booking.customer_name,
            'Confirmed rent payment for property booking ' || v_booking.id::TEXT,
            v_payment.rent_amount, 0, FALSE, 'APPROVED',
            'Owner-confirmed rent receipt',
            v_payment.recorded_by, COALESCE(v_submitter_name, 'Property staff'),
            auth.uid(), NOW(), v_payment.received_on
        );
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_and_confirm_property_payment(
    p_booking_id UUID,
    p_amount NUMERIC,
    p_rent_amount NUMERIC,
    p_deposit_amount NUMERIC,
    p_received_on DATE DEFAULT CURRENT_DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_payment_id UUID;
BEGIN
    IF NOT public.is_jasmin_owner() THEN
        RAISE EXCEPTION 'Only an owner can record and confirm a property payment.';
    END IF;

    v_payment_id := public.record_property_payment(
        p_booking_id,
        p_amount,
        p_rent_amount,
        p_deposit_amount,
        p_received_on
    );
    PERFORM public.confirm_property_payment(v_payment_id);
    RETURN v_payment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_property_payment(p_payment_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_jasmin_owner() THEN
        RAISE EXCEPTION 'Only an owner can reject a property payment.';
    END IF;
    UPDATE public.property_payments
    SET status = 'rejected', confirmed_by = auth.uid(), confirmed_at = NOW()
    WHERE id = p_payment_id
      AND status = 'pending_confirmation';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This property payment is no longer awaiting confirmation.';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_property_checkout(
    p_booking_id UUID,
    p_damage_amount NUMERIC,
    p_inspection_notes TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_booking public.property_bookings%ROWTYPE;
    v_deposit_paid NUMERIC(14, 2);
    v_checkout public.property_checkouts%ROWTYPE;
    v_checkout_id UUID := uuid_generate_v4();
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_business_access('real_estate') THEN
        RAISE EXCEPTION 'Real estate access is required to submit a checkout inspection.';
    END IF;
    IF p_damage_amount IS NULL OR p_damage_amount < 0 THEN
        RAISE EXCEPTION 'Damage deduction cannot be negative.';
    END IF;

    SELECT * INTO v_booking
    FROM public.property_bookings
    WHERE id = p_booking_id
    FOR UPDATE;
    IF NOT FOUND OR v_booking.status <> 'confirmed' OR v_booking.start_date > CURRENT_DATE THEN
        RAISE EXCEPTION 'Only an occupied, confirmed booking can be checked out.';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.property_payments
        WHERE property_booking_id = p_booking_id
          AND status = 'pending_confirmation'
    ) THEN
        RAISE EXCEPTION 'Confirm or reject pending payments before submitting checkout.';
    END IF;

    SELECT COALESCE(SUM(deposit_amount), 0)
    INTO v_deposit_paid
    FROM public.property_payments
    WHERE property_booking_id = p_booking_id
      AND status = 'confirmed';
    IF p_damage_amount > v_deposit_paid THEN
        RAISE EXCEPTION 'Damage deduction cannot exceed the confirmed deposit.';
    END IF;

    SELECT * INTO v_checkout
    FROM public.property_checkouts
    WHERE property_booking_id = p_booking_id
    FOR UPDATE;
    IF FOUND THEN
        IF v_checkout.status <> 'rejected' THEN
            RAISE EXCEPTION 'A checkout inspection is already pending or approved.';
        END IF;
        UPDATE public.property_checkouts
        SET damage_amount = ROUND(p_damage_amount, 2),
            deposit_refund_amount = NULL,
            inspection_notes = COALESCE(p_inspection_notes, ''),
            status = 'pending_owner_approval',
            recorded_by = auth.uid(),
            approved_by = NULL,
            approved_at = NULL,
            created_at = NOW()
        WHERE id = v_checkout.id
        RETURNING id INTO v_checkout_id;
    ELSE
        INSERT INTO public.property_checkouts (
            id, property_booking_id, damage_amount, inspection_notes, recorded_by
        ) VALUES (
            v_checkout_id, p_booking_id, ROUND(p_damage_amount, 2),
            COALESCE(p_inspection_notes, ''), auth.uid()
        );
    END IF;
    RETURN v_checkout_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_property_checkout(p_checkout_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_checkout public.property_checkouts%ROWTYPE;
    v_booking public.property_bookings%ROWTYPE;
    v_deposit_paid NUMERIC(14, 2);
    v_submitter_name TEXT;
    v_reference_no TEXT;
    v_property_name TEXT;
BEGIN
    IF NOT public.is_jasmin_owner() THEN
        RAISE EXCEPTION 'Only an owner can approve checkout and record a deposit refund.';
    END IF;

    SELECT * INTO v_checkout
    FROM public.property_checkouts
    WHERE id = p_checkout_id
    FOR UPDATE;
    IF NOT FOUND OR v_checkout.status <> 'pending_owner_approval' THEN
        RAISE EXCEPTION 'This checkout inspection is no longer awaiting approval.';
    END IF;

    SELECT * INTO v_booking
    FROM public.property_bookings
    WHERE id = v_checkout.property_booking_id
    FOR UPDATE;
    IF NOT FOUND OR v_booking.status <> 'confirmed' THEN
        RAISE EXCEPTION 'The associated property booking is not active.';
    END IF;

    SELECT COALESCE(SUM(deposit_amount), 0)
    INTO v_deposit_paid
    FROM public.property_payments
    WHERE property_booking_id = v_booking.id
      AND status = 'confirmed';
    IF v_checkout.damage_amount > v_deposit_paid THEN
        RAISE EXCEPTION 'Damage deduction exceeds the confirmed deposit.';
    END IF;

    UPDATE public.property_bookings
    SET status = 'checked_out', end_date = CURRENT_DATE
    WHERE id = v_booking.id;

    UPDATE public.property_checkouts
    SET status = 'approved',
        deposit_refund_amount = v_deposit_paid - v_checkout.damage_amount,
        approved_by = auth.uid(),
        approved_at = NOW()
    WHERE id = v_checkout.id;

    IF v_checkout.damage_amount > 0 THEN
        SELECT full_name INTO v_submitter_name
        FROM public.user_profiles
        WHERE id = v_checkout.recorded_by;
        SELECT name INTO v_property_name
        FROM public.properties
        WHERE id = v_booking.property_id;
        v_reference_no := 'JAST-RE-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
            UPPER(SUBSTRING(REPLACE(uuid_generate_v4()::TEXT, '-', '') FROM 1 FOR 6));

        INSERT INTO public.transactions (
            reference_no, business_id, tx_type, category, counterparty_name,
            description, amount, vat_amount, reconciled, status, gate_reason,
            submitted_by, submitted_by_name, approved_by, approved_at, tx_date
        ) VALUES (
            v_reference_no, 'real_estate', 'INCOME', 'Property Deposit Damage Charge',
            v_booking.customer_name,
            'Inspected damage charge for ' || COALESCE(v_property_name, 'property') ||
                ' booking ' || v_booking.id::TEXT || ': ' || v_checkout.inspection_notes,
            v_checkout.damage_amount, 0, FALSE, 'APPROVED',
            'Owner-approved damage deduction from refundable deposit',
            v_checkout.recorded_by, COALESCE(v_submitter_name, 'Property staff'),
            auth.uid(), NOW(), CURRENT_DATE
        );
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_property_checkout(p_checkout_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_jasmin_owner() THEN
        RAISE EXCEPTION 'Only an owner can reject a checkout inspection.';
    END IF;
    UPDATE public.property_checkouts
    SET status = 'rejected', approved_by = auth.uid(), approved_at = NOW()
    WHERE id = p_checkout_id
      AND status = 'pending_owner_approval';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This checkout inspection is no longer awaiting approval.';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_property_payment(UUID, NUMERIC, NUMERIC, NUMERIC, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_property_payment(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_and_confirm_property_payment(UUID, NUMERIC, NUMERIC, NUMERIC, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_property_payment(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_property_checkout(UUID, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_property_checkout(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_property_checkout(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_property_payment(UUID, NUMERIC, NUMERIC, NUMERIC, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_property_payment(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_and_confirm_property_payment(UUID, NUMERIC, NUMERIC, NUMERIC, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_property_payment(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_property_checkout(UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_property_checkout(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_property_checkout(UUID) TO authenticated;

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
    ELSIF NEW.business_id = 'real_estate'
       AND NEW.category IN ('Property Rent Collection', 'Property Deposit Damage Charge')
       AND public.is_jasmin_owner() THEN
        NEW.status := 'APPROVED';
        NEW.gate_reason := 'Owner-confirmed property receipt';
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

DROP POLICY IF EXISTS "Real estate staff can update property bookings" ON public.property_bookings;
DROP POLICY IF EXISTS "Owner can update property bookings" ON public.property_bookings;
CREATE POLICY "Owner can update property bookings"
ON public.property_bookings FOR UPDATE TO authenticated
USING (public.is_jasmin_owner())
WITH CHECK (public.is_jasmin_owner());
