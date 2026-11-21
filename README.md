# JAST Business Ventures — Integrated Multi-Business Management ERP

Full-stack prototype and production blueprint for **Development of an Integrated Multi-Business Management Web-Application with a Centralized Owner Dashboard for JAST Business Ventures** (Jasmin Taurak & Christian Cervantes).

## Included in this Package

1. **`standalone_preview/JAST_ERP_System.html`** — Zero-install, self-contained interactive web app. Double-click to open immediately in Chrome, Edge, or Safari.
2. **`supabase/schema.sql`** — Complete PostgreSQL database schema including:
   - Multi-tenant `business_units` (`real_estate`, `pickleball`, `jewelry`)
   - Role-Based Access Control (`user_profiles`)
   - PostgreSQL Row-Level Security (`RLS`) policies isolating branch data
   - Automated **Owner Approval Gate** trigger (`> ₱30,000` or Jewelry inventory write-offs)
   - Immutable `audit_logs` trigger preventing tampering (BIR RMO 1-2020 & Reg. 17-2013 compliant)
3. **`src/`** — Full React + TypeScript + Vite + Tailwind CSS source code ready for Supabase deployment.

## Business Operations

The React app includes an Operations view for:

- Ma'am Jasmin Taurak to add and edit property addresses and monthly rents, jewelry inventory with multiple photos, unit costs, selling prices and stock counts, and pickleball courts.
- Staff to record property lease bookings with date-overlap checks, court bookings with time-conflict checks, and jewelry sales that reduce on-hand stock and add income to the transaction ledger.
- A Supabase-authenticated staff account can be assigned access to real estate, pickleball, and jewelry.

The app does not seed sample business records; it displays the data available to the authenticated user in Supabase. The React app signs users in through Supabase Auth and uses each authenticated user's `user_profiles` role and business access; it does not use a client-side role switcher.

Catalog records, compressed property and jewelry photos, bookings, jewelry sales, transactions, and audit history are stored in Supabase. Photo files use the private `property-images` and `jewelry-images` Storage buckets. The standalone HTML preview remains a static preview of the original dashboard; use the React app for Supabase-backed operations.

Apply `supabase/schema.sql` in the configured Supabase project's SQL Editor. In Supabase Auth, invite/create each user, then add a matching `user_profiles` row using the Auth user's UUID and email. Add staff access rows for `real_estate`, `pickleball`, and `jewelry` in `user_business_access`. The owner profile must have the exact full name `Ma'am Jasmin Taurak`; database policies allow only that owner to modify catalogs or upload catalog photos. Users sign in with their Supabase email and password.

The app reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `.env`. Restart the Vite server after changing these values. The anon key is intended for browser use; never put a Supabase service-role key in a `VITE_` variable. Older browser-local records are not imported automatically; the Jasmin owner can use the dashboard's **Import saved browser data** action to copy this browser's saved catalogs, photos, bookings, sales, and transactions into Supabase. The local copy is preserved. Historical browser audit rows are not imported because the Supabase audit table is append-only; Supabase records the import actions as new audit events.

## How to Run Locally (Full React + Vite Project)

```bash
npm install
cp .env.example .env
# Add your Supabase URL and Anon Key in .env
npm run dev
```

## Instant Browser Preview (No Node.js Required)

Open `standalone_preview/JAST_ERP_System.html` directly in any web browser to test:
- **Centralized Owner Dashboard** (Ma'am Jasmin Taurak's consolidated view across Real Estate, Pickleball, and Jewelry)
- **Role-Based Access Control (RLS Simulator)** — switch between Owner and Branch Bookkeepers to verify strict data isolation
- **6-Step Staff Transaction Pipeline** — record transactions, attach receipts, extract 12% VAT, and trigger the automated Owner Gate
- **Immutable Audit Trail & BIR CAS CSV Export**