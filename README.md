# JAST Business Ventures — Integrated Multi-Business Management ERP

Full-stack prototype and production blueprint for **Development of an Integrated Multi-Business Management Web-Application with a Centralized Owner Dashboard for JAST Business Ventures** (Jasmin Taurak & Christian Cervantes).

## Included in this Package

1. **`standalone_preview/JAST_ERP_System.html`** — Zero-install, self-contained interactive web app. Double-click to open immediately in Chrome, Edge, or Safari.
2. **`supabase/schema.sql`** — Complete PostgreSQL database schema including:
   - Multi-tenant `business_units` (`real_estate`, `pickleball`, `jewelry`)
   - Role-Based Access Control (`user_profiles`)
   - PostgreSQL Row-Level Security (`RLS`) policies isolating branch data
   - Automated **Owner Approval Gate** trigger (every Jewelry transaction; other ventures above `₱30,000`)
   - Immutable `audit_logs` trigger preventing tampering (BIR RMO 1-2020 & Reg. 17-2013 compliant)
3. **`src/`** — Full React + TypeScript + Vite + Tailwind CSS source code ready for Supabase deployment. The transaction ledger and audit trail can be scoped by venture and downloaded as separate Excel-compatible CSV files. Reports support monthly, yearly, and custom date ranges and print with detailed transaction records.

## Business Operations

The React app includes an Operations view for:

- Ma'am Jasmin Taurak to add and edit property addresses and monthly rents, jewelry inventory with multiple photos, unit costs, selling prices and stock counts, and pickleball courts.
- Real Estate bookings can be open-ended or fixed-term. Staff record partial rent/deposit receipts for owner confirmation; owners can record and atomically confirm their own receipts in one step. Confirmed rent updates the balance and ledger, while the two-month refundable deposit is tracked separately. Rent is prorated for the move-in month and due on the first of each later month. Property cards show outstanding/overdue rent, days overdue, or advance rent.
- Staff submit move-out inspections and damage deductions for owner approval. Approval records the damage deduction as revenue, ends the booking, and records the remaining deposit refund; the actual cash refund must be issued as part of that owner-confirmed checkout.
- Court bookings retain date/time conflict checks, and Jewelry sales remain pending until owner approval.
- A Supabase-authenticated staff account can be assigned access to real estate, pickleball, and jewelry.

The app does not seed sample business records; it displays the data available to the authenticated user in Supabase. The React app signs users in through Supabase Auth and uses each authenticated user's `user_profiles` role and business access; it does not use a client-side role switcher.

Catalog records, compressed property and jewelry photos, bookings, jewelry sales, transactions, and audit history are stored in Supabase. Photo files use the private `property-images` and `jewelry-images` Storage buckets. Transaction receipts are uploaded to the private `receipt-vault` bucket and can be previewed from the ledger by users with access to that venture. Existing transactions that only saved a receipt filename have no stored file to preview; those receipts must be re-uploaded. The standalone HTML preview remains a static preview of the original dashboard; use the React app for Supabase-backed operations.

Apply `supabase/schema.sql` in the configured Supabase project's SQL Editor. Create staff login accounts in Supabase Auth, then use the owner-only **User Accounts** screen to register each Auth UUID, role, and venture access. The screen supports bookkeepers, sales/booking staff, and branch managers; owner accounts must be provisioned separately. Users sign in with their Supabase email and password.

For a new project, apply `supabase/real_estate_rentals.sql` after `supabase/schema.sql`. For an existing project, re-run the updated migration without rerunning the base schema; it refreshes the rental functions and payment defaults. This migration uses `gen_random_uuid()` for rental records and enables owners to confirm a payment and its booking in one transaction. Existing bookings are assigned a two-month deposit requirement, but historical payments are not inferred from old booking records or ledger entries; reconcile and record their actual rent/deposit payments before relying on their displayed balances. Legacy `Property Reservation & Downpayment` ledger entries are left untouched; review them before recording new rent collections to avoid duplicate income.

For an existing Supabase project, apply `supabase/user_accounts.sql` before using the User Accounts screen.

For an existing Supabase project, also apply `supabase/cancel_booking_rls.sql` to allow owner-only booking cancellations while retaining the booking records.

For an existing Supabase project, apply `supabase/receipt_vault.sql` to enable private receipt uploads and venture-scoped viewing.

For an existing Supabase project, reapply the latest `supabase/jewelry_returns.sql`, then apply `supabase/jewelry_owner_approval.sql` in the Supabase SQL Editor. Every Jewelry transaction then requires owner approval. POS sale requests reserve available stock but do not complete the sale or deduct stock until approved; rejecting or cancelling a request releases the reservation. The migration also preserves owner-only full jewelry sale returns within seven days, marks the original sale cancelled in the immutable audit trail, restores stock, and records the refund against net revenue. If an old sale has no unique matching ledger entry, the returns migration leaves it unlinked and the app reports that instead of cancelling an unrelated transaction. The actual customer refund must be completed separately.

The app reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `.env`. Restart the Vite server after changing these values. The anon key is intended for browser use; never put a Supabase service-role key in a `VITE_` variable. Older browser-local records are not imported automatically; an owner can use the dashboard's **Import saved browser data** action to copy this browser's saved catalogs, photos, bookings, sales, and transactions into Supabase. The local copy is preserved. Historical browser audit rows are not imported because the Supabase audit table is append-only; Supabase records the import actions as new audit events.

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