-- Enable private receipt uploads and signed previews for authorized venture users.
INSERT INTO storage.buckets (id, name, public, allowed_mime_types)
VALUES ('receipt-vault', 'receipt-vault', false, ARRAY['application/pdf', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = false,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

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
