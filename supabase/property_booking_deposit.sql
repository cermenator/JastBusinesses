-- Add and backfill the refundable two-month deposit for existing property bookings.
-- A property deposit is not ledger revenue.
ALTER TABLE public.property_bookings
ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(14, 2);

UPDATE public.property_bookings
SET deposit_amount = monthly_rent * 2
WHERE deposit_amount IS NULL;

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
