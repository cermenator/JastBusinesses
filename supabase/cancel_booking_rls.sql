-- Allow owners to cancel bookings while retaining booking history.
-- Apply this migration to existing Supabase projects.
GRANT UPDATE ON public.property_bookings TO authenticated;
GRANT UPDATE ON public.court_bookings TO authenticated;

DROP POLICY IF EXISTS "Real estate staff can update property bookings" ON public.property_bookings;
DROP POLICY IF EXISTS "Owner can update property bookings" ON public.property_bookings;
CREATE POLICY "Owner can update property bookings"
ON public.property_bookings FOR UPDATE TO authenticated
USING (public.is_jasmin_owner())
WITH CHECK (public.is_jasmin_owner());

DROP POLICY IF EXISTS "Pickleball staff update bookings" ON public.court_bookings;
DROP POLICY IF EXISTS "Owner can update court bookings" ON public.court_bookings;
CREATE POLICY "Owner can update court bookings"
ON public.court_bookings FOR UPDATE TO authenticated
USING (public.is_jasmin_owner())
WITH CHECK (public.is_jasmin_owner());
