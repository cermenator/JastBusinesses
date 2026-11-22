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
