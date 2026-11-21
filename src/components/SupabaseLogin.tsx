import React, { FormEvent, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

interface Props {
  error?: string;
}

export const SupabaseLogin: React.FC<Props> = ({ error: initialError = '' }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [submitting, setSubmitting] = useState(false);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) {
      setError('Supabase is not configured. Add the URL and anon key to the local .env file and restart the app.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) setError(`Sign-in failed: ${signInError.message}`);
    } catch (signInError) {
      setError(`Sign-in failed: ${signInError instanceof Error ? signInError.message : 'Supabase could not be reached.'}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <form onSubmit={signIn} className="w-full max-w-md space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <div>
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <LockKeyhole className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Sign in to JAST ERP</h1>
          <p className="mt-1 text-sm text-slate-600">Use your Supabase-authenticated staff or owner account.</p>
        </div>
        {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60"
        >
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </main>
  );
};
