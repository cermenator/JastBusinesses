-- Record and confirm an owner-entered rent/deposit payment in one transaction.
-- Apply after real_estate_rentals.sql on existing projects.
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

REVOKE ALL ON FUNCTION public.record_and_confirm_property_payment(UUID, NUMERIC, NUMERIC, NUMERIC, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_and_confirm_property_payment(UUID, NUMERIC, NUMERIC, NUMERIC, DATE) TO authenticated;
