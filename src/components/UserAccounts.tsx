import React, { FormEvent, useEffect, useState } from 'react';
import { BusinessId, UserRole } from '../types/erp';
import { BUSINESS_UNITS } from '../lib/seedData';
import { supabase } from '../lib/supabaseClient';

type StaffRole = Exclude<UserRole, 'owner'>;

interface ManagedAccount {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  businessIds: BusinessId[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const roleLabel = (role: UserRole) => {
  if (role === 'owner') return 'Owner';
  if (role === 'staff') return 'Sales / Booking Staff';
  if (role === 'branch_manager') return 'Branch Manager';
  return 'Bookkeeper';
};

export const UserAccounts: React.FC = () => {
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [authUserId, setAuthUserId] = useState('');
  const [role, setRole] = useState<StaffRole>('bookkeeper');
  const [businessIds, setBusinessIds] = useState<BusinessId[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadAccounts = async () => {
    if (!supabase) {
      setError('Supabase is not configured.');
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [profilesResult, accessResult] = await Promise.all([
        supabase.from('user_profiles')
          .select('id, full_name, email, role, business_id')
          .order('created_at', { ascending: false }),
        supabase.from('user_business_access').select('user_id, business_id'),
      ]);
      if (profilesResult.error) throw new Error(`Could not load user accounts: ${profilesResult.error.message}`);
      if (accessResult.error) throw new Error(`Could not load venture assignments: ${accessResult.error.message}`);

      const accessByUser = new Map<string, BusinessId[]>();
      accessResult.data.forEach((row) => {
        const businessId = BUSINESS_UNITS.find((unit) => unit.id === row.business_id)?.id;
        if (!businessId) return;
        const assigned = accessByUser.get(row.user_id) || [];
        if (!assigned.includes(businessId)) assigned.push(businessId);
        accessByUser.set(row.user_id, assigned);
      });

      setAccounts(profilesResult.data.map((profile) => {
        const assigned = accessByUser.get(profile.id) || [];
        const primaryBusiness = BUSINESS_UNITS.find((unit) => unit.id === profile.business_id)?.id;
        if (primaryBusiness && !assigned.includes(primaryBusiness)) assigned.push(primaryBusiness);
        return {
          id: profile.id,
          fullName: profile.full_name,
          email: profile.email,
          role: profile.role as UserRole,
          businessIds: assigned,
        };
      }));
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load user accounts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAccounts();
  }, []);

  const toggleBusiness = (businessId: BusinessId) => {
    setBusinessIds((current) => current.includes(businessId)
      ? current.filter((id) => id !== businessId)
      : [...current, businessId]);
  };

  const createAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }
    if (!UUID_PATTERN.test(authUserId.trim())) {
      setError('Enter the valid UUID of the user you already created in Supabase Auth.');
      return;
    }
    if (businessIds.length === 0) {
      setError('Assign the user to at least one venture.');
      return;
    }

    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: createError } = await supabase.rpc('create_staff_account', {
        p_user_id: authUserId.trim(),
        p_full_name: fullName.trim(),
        p_email: email.trim(),
        p_role: role,
        p_business_ids: businessIds,
      });
      if (createError) throw new Error(createError.message);

      setNotice(`Created access for ${fullName.trim()}. They can now sign in with their Supabase Auth account.`);
      setFullName('');
      setEmail('');
      setAuthUserId('');
      setRole('bookkeeper');
      setBusinessIds([]);
      await loadAccounts();
    } catch (createError) {
      setError(`Could not create user access: ${createError instanceof Error ? createError.message : 'Supabase could not be reached.'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-bold text-slate-900">Create Staff Access</h2>
        <p className="mt-1 text-xs text-slate-500">
          First create the login in Supabase Auth, then register its UUID here and assign venture access.
        </p>

        {error && <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
        {notice && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

        <form onSubmit={createAccount} className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700">Full name</span>
            <input
              required
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              autoComplete="name"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700">Auth email</span>
            <input
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              autoComplete="email"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700">Supabase Auth user UUID</span>
            <input
              required
              value={authUserId}
              onChange={(event) => setAuthUserId(event.target.value)}
              placeholder="Copy from Authentication → Users"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
              spellCheck={false}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700">Role</span>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as StaffRole)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="bookkeeper">Bookkeeper</option>
              <option value="staff">Sales / Booking Staff</option>
              <option value="branch_manager">Branch Manager</option>
            </select>
          </label>
          <fieldset className="md:col-span-2">
            <legend className="mb-2 text-xs font-semibold text-slate-700">Venture access</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {BUSINESS_UNITS.map((business) => (
                <label key={business.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={businessIds.includes(business.id)}
                    onChange={() => toggleBusiness(business.id)}
                    className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                  />
                  <span>{business.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-[#075b43] px-4 py-2 text-sm font-semibold text-white hover:bg-[#064a37] disabled:opacity-60"
            >
              {saving ? 'Creating access…' : 'Create User Access'}
            </button>
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-bold text-slate-900">Registered User Accounts</h2>
          <p className="mt-1 text-xs text-slate-500">{accounts.length} profiles in this Supabase project</p>
        </div>
        {loading ? (
          <p role="status" className="px-6 py-5 text-sm text-slate-500">Loading user accounts…</p>
        ) : accounts.length === 0 ? (
          <p className="px-6 py-5 text-sm text-slate-500">No user profiles found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3">Name / Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Venture Access</th>
                  <th className="px-4 py-3">Auth User UUID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {accounts.map((account) => (
                  <tr key={account.id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{account.fullName}</p>
                      <p className="mt-0.5 text-slate-500">{account.email}</p>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-700">{roleLabel(account.role)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {account.role === 'owner'
                        ? 'All ventures'
                        : account.businessIds.map((id) => BUSINESS_UNITS.find((business) => business.id === id)?.code || id).join(', ') || 'None'}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{account.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
