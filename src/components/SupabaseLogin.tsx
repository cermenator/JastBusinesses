import React, { FormEvent, useState } from 'react';
import {
  ArrowRight,
  CircleDot,
  Eye,
  EyeOff,
  Gem,
  House,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

interface Props {
  error?: string;
}

export const SupabaseLogin: React.FC<Props> = ({ error: initialError = '' }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) {
      setError('Supabase is not configured. Add the URL and anon key to the local .env file and restart the app.');
      return;
    }

    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) setError(`Sign-in failed: ${signInError.message}`);
    } catch (signInError) {
      setError(`Sign-in failed: ${signInError instanceof Error ? signInError.message : 'Supabase could not be reached.'}`);
    } finally {
      setSubmitting(false);
    }
  };

  const resetPassword = async () => {
    if (!supabase) {
      setError('Supabase is not configured. Add the URL and anon key to the local .env file and restart the app.');
      return;
    }
    if (!email.trim()) {
      setError('Enter your account email first so we can send a password reset link.');
      return;
    }

    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
      });
      if (resetError) throw resetError;
      setNotice('If an account exists for this email, Supabase will send a password reset link.');
    } catch (resetError) {
      setError(`Could not send a password reset link: ${resetError instanceof Error ? resetError.message : 'Supabase could not be reached.'}`);
    } finally {
      setSubmitting(false);
    }
  };

  const signInWithGoogle = async () => {
    if (!supabase) {
      setError('Supabase is not configured. Add the URL and anon key to the local .env file and restart the app.');
      return;
    }
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (oauthError) throw oauthError;
    } catch (oauthError) {
      setError(`Google sign-in failed: ${oauthError instanceof Error ? oauthError.message : 'Supabase could not be reached.'}`);
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 p-3 sm:p-6 lg:flex lg:items-center lg:justify-center">
      <div className="mx-auto grid min-h-[min(760px,calc(100vh-3rem))] w-full max-w-6xl overflow-hidden rounded-[1.75rem] bg-white shadow-2xl shadow-slate-900/10 lg:grid-cols-[1fr_1fr]">
        <section className="relative flex min-h-[360px] flex-col overflow-hidden bg-emerald-950 px-7 py-9 text-white sm:px-12 sm:py-12 lg:min-h-[650px] lg:px-14">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_20%,rgba(16,185,129,0.28),transparent_48%),linear-gradient(145deg,#064e3b_0%,#022c22_58%,#011c17_100%)]"
          />
          <svg
            aria-hidden="true"
            viewBox="0 0 640 520"
            preserveAspectRatio="xMidYMid slice"
            className="absolute inset-0 h-full w-full opacity-20"
          >
            <path d="M0 520V100L140 0h90l95 82v438H0Z" fill="#022c22" />
            <path d="M15 520V112L145 20v500M35 520V110M62 520V91M92 520V72M122 520V49M152 520V30M182 520V55M212 520V82M242 520V109" fill="none" stroke="#a7f3d0" strokeWidth="5" />
            <path d="M380 520V150l110-90 150 102v358H380Z" fill="#022c22" />
            <path d="M395 520V157l95-77 135 97v343M420 520V143M450 520V121M480 520V94M510 520V91M540 520V111M570 520V131M600 520V151" fill="none" stroke="#a7f3d0" strokeWidth="5" />
            <path d="M0 380h300M350 310h290M0 460h640" fill="none" stroke="#a7f3d0" strokeWidth="3" />
          </svg>
          <div aria-hidden="true" className="absolute -bottom-28 -left-20 h-64 w-[130%] rotate-[-8deg] border-t-[10px] border-amber-300/90 bg-emerald-900/50" />

          <div className="relative z-10 flex flex-1 flex-col items-center text-center">
            <div className="flex items-center justify-center">
              <svg aria-hidden="true" viewBox="0 0 80 74" className="h-16 w-16 text-amber-300">
                <path d="M10 60h58M18 53V36h12v17M35 53V25h12v28M52 53V13h12v40" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="5" />
                <path d="M13 29 38 14l14 7L69 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="5" />
                <path d="m58 7 11 0-1 11" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="5" />
              </svg>
            </div>
            <p className="mt-1 font-serif text-5xl font-semibold tracking-[0.16em] text-white">JAST</p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.48em] text-emerald-100 sm:text-xs">Business Ventures</p>
            <div className="mt-7 h-px w-20 bg-amber-300/80" />
            <h1 className="mt-6 max-w-sm text-xl font-semibold leading-snug sm:text-2xl">
              Integrated Multi-Business
              <br />
              Management
            </h1>
            <p className="mt-2 text-sm text-emerald-100/80">One workspace for every venture.</p>

            <div className="mt-8 grid w-full max-w-md grid-cols-3 gap-2 sm:mt-10 sm:gap-3">
              <div className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-emerald-200/30 bg-emerald-950/40 px-2 py-3 backdrop-blur-sm">
                <House className="h-6 w-6 text-amber-300" />
                <span className="text-[11px] font-medium leading-tight sm:text-xs">JAST Real Estate</span>
              </div>
              <div className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-emerald-200/30 bg-emerald-950/40 px-2 py-3 backdrop-blur-sm">
                <Gem className="h-6 w-6 text-amber-300" />
                <span className="text-[11px] font-medium leading-tight sm:text-xs">JAST AJ Jewelry</span>
              </div>
              <div className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-emerald-200/30 bg-emerald-950/40 px-2 py-3 backdrop-blur-sm">
                <CircleDot className="h-6 w-6 text-amber-300" />
                <span className="text-[11px] font-medium leading-tight sm:text-xs">Dash & Smash</span>
              </div>
            </div>
          </div>
          <p className="relative z-10 mt-8 text-center text-[10px] uppercase tracking-[0.22em] text-emerald-100/60">
            Real Estate · Jewelry · Pickleball
          </p>
        </section>

        <section className="flex items-center justify-center bg-slate-50 px-5 py-10 sm:px-10 lg:px-12">
          <div className="w-full max-w-md">
            <div className="mb-8 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-emerald-950">Login to Your Account</h2>
              <p className="mt-2 text-sm text-slate-500">Access JAST Business Ventures Management System</p>
            </div>

            <form onSubmit={signIn} className="space-y-4">
              {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
              {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

              <label className="relative block">
                <span className="sr-only">Email address</span>
                <Mail aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Email address"
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-700 focus:ring-4 focus:ring-emerald-700/10"
                />
              </label>

              <label className="relative block">
                <span className="sr-only">Password</span>
                <LockKeyhole aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Password"
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-12 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-700 focus:ring-4 focus:ring-emerald-700/10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </label>

              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => void resetPassword()}
                  disabled={submitting}
                  className="text-xs font-semibold text-emerald-800 hover:text-emerald-950 disabled:opacity-50"
                >
                  Forgot password?
                </button>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 text-sm font-semibold text-white shadow-lg shadow-emerald-900/15 transition hover:bg-emerald-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-700/20 disabled:cursor-wait disabled:opacity-60"
              >
                {submitting ? 'Please wait...' : 'Log In'}
                {!submitting && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>

            <div className="my-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-slate-200" />
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">or</span>
              <span className="h-px flex-1 bg-slate-200" />
            </div>

            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              disabled={submitting}
              className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-300/60 disabled:cursor-wait disabled:opacity-60"
            >
              <svg aria-hidden="true" viewBox="0 0 48 48" className="h-5 w-5">
                <path fill="#FFC107" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11c-.5 2.5-1.9 4.6-4 6v5.1h6.5c3.8-3.5 6.1-8.6 6.1-14.8Z" />
                <path fill="#FF3D00" d="M24 44c5.4 0 9.9-1.8 13.2-4.8l-6.5-5.1c-1.8 1.2-4 1.9-6.7 1.9-5.2 0-9.6-3.5-11.2-8.2H6.1v5.3C9.4 39.6 16.1 44 24 44Z" />
                <path fill="#4CAF50" d="M12.8 27.8a12 12 0 0 1 0-7.6v-5.3H6.1a20 20 0 0 0 0 18.2l6.7-5.3Z" />
                <path fill="#1976D2" d="M24 11.9c3 0 5.7 1 7.8 3.1l5.8-5.8C34.1 6 29.4 4 24 4 16.1 4 9.4 8.4 6.1 14.9l6.7 5.3c1.6-4.8 6-8.3 11.2-8.3Z" />
              </svg>
              Continue with Google
            </button>

            <p className="mt-8 flex items-center justify-center gap-2 text-xs text-slate-500">
              <LockKeyhole className="h-3.5 w-3.5" />
              Secure sign-in for authorized JAST staff and owners
            </p>
          </div>
        </section>
      </div>
    </main>
  );
};
