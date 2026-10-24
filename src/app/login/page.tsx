'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Sparkles, Mail, Lock, User, ArrowRight, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

function GoogleIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialMode = searchParams.get('mode') === 'signin' ? 'signin' : 'signup';
  
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Sync mode if query param changes
  useEffect(() => {
    const qMode = searchParams.get('mode');
    if (qMode === 'signup' || qMode === 'signin') {
      setMode(qMode);
    }
    const err = searchParams.get('error');
    if (err) {
      if (err === 'auth_failed') {
        setErrorMessage('Authentication was canceled or failed. Please try again.');
      } else {
        setErrorMessage(decodeURIComponent(err));
      }
    }
  }, [searchParams]);

  // Session check in background: if already logged in, navigate to dashboard immediately
  useEffect(() => {
    let isMounted = true;
    const checkSession = async () => {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (session && isMounted) {
          router.replace('/dashboard');
        }
      } catch (err) {
        console.error('Session verification error:', err);
      }
    };
    checkSession();
    return () => {
      isMounted = false;
    };
  }, [router]);

  // Google OAuth sign-in with account chooser (prompt: 'select_account')
  const handleGoogleLogin = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    setIsGoogleLoading(true);

    try {
      const supabase = createClient();
      const redirectUrl = `${window.location.origin}/auth/callback`;
      
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            access_type: 'offline',
            prompt: 'select_account',
          },
        },
      });

      if (error) {
        setErrorMessage(error.message);
        setIsGoogleLoading(false);
      }
      // On success, browser redirects to accounts.google.com account chooser
    } catch (err) {
      console.error('Google login error:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to connect to Google OAuth');
      setIsGoogleLoading(false);
    }
  };

  // Email + Password Sign In
  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setIsSubmitting(true);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setErrorMessage(error.message);
        setIsSubmitting(false);
        return;
      }

      if (data.session) {
        router.replace('/dashboard');
      }
    } catch (err) {
      console.error('Sign in error:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Sign in failed');
      setIsSubmitting(false);
    }
  };

  // Email + Password Sign Up / Registration (Direct access with zero confirmation emails)
  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setIsSubmitting(true);

    try {
      const supabase = createClient();

      // Register and auto-confirm user via server admin endpoint
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          fullName: fullName.trim(),
        }),
      });

      let result: { success?: boolean; error?: string } = {};
      try {
        const text = await res.text();
        if (text && text.trim().startsWith('{')) {
          result = JSON.parse(text);
        }
      } catch {
        result = {};
      }

      if (!res.ok) {
        if (result.error?.includes('already exists')) {
          setErrorMessage('An account with this email already exists. Please sign in.');
          setIsSubmitting(false);
          return;
        }
        // Fallback to client signup
        const { error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: fullName.trim(),
              name: fullName.trim(),
            },
          },
        });
        if (signUpError) {
          throw new Error(signUpError.message);
        }
      }

      // Automatically sign in the user immediately to establish session
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        throw new Error(signInError.message);
      }

      if (signInData.session) {
        router.replace('/dashboard');
      } else {
        router.replace('/dashboard');
      }
    } catch (err) {
      console.error('Registration error:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Registration failed');
      setIsSubmitting(false);
    }
  };


  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="glass-card p-8 sm:p-10 slide-up border border-surface-700/60 shadow-2xl">
          {/* Logo & Header */}
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center mx-auto mb-4 pulse-glow shadow-lg shadow-primary-500/25">
              <Sparkles className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-surface-100 tracking-tight">
              VideoSynopsis AI
            </h1>
            <p className="text-surface-400 text-sm mt-1">
              Intelligent Video Analysis & Meeting Transcription
            </p>
          </div>

          {/* Form Switcher Tabs: Sign In vs Create New Account */}
          <div className="flex bg-surface-900/80 p-1 rounded-xl mb-6 border border-surface-800">
            <button
              type="button"
              id="tab-sign-in"
              onClick={() => {
                setMode('signin');
                setErrorMessage('');
                setSuccessMessage('');
              }}
              className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all duration-200 cursor-pointer ${
                mode === 'signin'
                  ? 'bg-gradient-to-r from-primary-600 to-accent-600 text-white shadow-md'
                  : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/50'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              id="tab-create-account"
              onClick={() => {
                setMode('signup');
                setErrorMessage('');
                setSuccessMessage('');
              }}
              className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all duration-200 cursor-pointer ${
                mode === 'signup'
                  ? 'bg-gradient-to-r from-primary-600 to-accent-600 text-white shadow-md'
                  : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/50'
              }`}
            >
              Create New Account
            </button>
          </div>

          {/* Error & Success Alerts */}
          {errorMessage && (
            <div className="mb-5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-start gap-2.5 fade-in">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div className="flex-1 leading-snug">
                {errorMessage.toLowerCase().includes('invalid login credentials')
                  ? 'Invalid login'
                  : errorMessage}
              </div>
            </div>
          )}

          {successMessage && (
            <div className="mb-5 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm flex items-start gap-2.5 fade-in">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div className="flex-1 leading-snug">{successMessage}</div>
            </div>
          )}

          {/* Google Authentication Button */}
          <div className="mb-6">
            <button
              type="button"
              id="google-auth-button"
              onClick={handleGoogleLogin}
              disabled={isGoogleLoading || isSubmitting}
              className="w-full flex items-center justify-center gap-3 px-5 py-3.5 bg-white hover:bg-gray-50 text-gray-800 font-bold rounded-xl transition-all duration-200 shadow-md hover:shadow-lg hover:shadow-white/10 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer border border-gray-200"
              title="Sign in directly with your Google account"
            >
              {isGoogleLoading ? (
                <div className="w-5 h-5 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
              ) : (
                <GoogleIcon className="w-5 h-5 flex-shrink-0" />
              )}
              <span className="text-sm font-semibold tracking-wide">
                {isGoogleLoading
                  ? 'Connecting to Google...'
                  : mode === 'signup'
                  ? 'Sign up with Google'
                  : 'Sign in with Google'}
              </span>
            </button>
            <div className="mt-2.5 flex items-center gap-1.5 justify-center text-surface-400 text-xs">
              <Mail className="w-3.5 h-3.5 text-primary-400" />
              <span>Select any Gmail account to log straight into your dashboard</span>
            </div>
          </div>

          {/* Divider */}
          <div className="relative flex py-2 items-center mb-6">
            <div className="flex-grow border-t border-surface-700/60"></div>
            <span className="flex-shrink mx-3 text-surface-500 text-xs font-medium uppercase tracking-wider">
              Or continue with email
            </span>
            <div className="flex-grow border-t border-surface-700/60"></div>
          </div>

          {/* Sign In Form */}
          {mode === 'signin' && (
            <form onSubmit={handleEmailSignIn} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-surface-300 mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-surface-500">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    type="email"
                    required
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isSubmitting || isGoogleLoading}
                    className="w-full pl-10 pr-4 py-2.5 bg-surface-900/60 border border-surface-700 rounded-xl text-surface-100 placeholder-surface-500 text-sm focus:outline-none focus:border-primary-500 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-surface-300 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-surface-500">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type="password"
                    required
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isSubmitting || isGoogleLoading}
                    className="w-full pl-10 pr-4 py-2.5 bg-surface-900/60 border border-surface-700 rounded-xl text-surface-100 placeholder-surface-500 text-sm focus:outline-none focus:border-primary-500 transition-colors"
                  />
                </div>
              </div>

              <button
                type="submit"
                id="email-signin-button"
                disabled={isSubmitting || isGoogleLoading}
                className="btn-primary w-full py-3 mt-2 flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <span>Sign In</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup');
                    setErrorMessage('');
                    setSuccessMessage('');
                  }}
                  className="text-xs text-surface-400 hover:text-primary-400 transition-colors"
                >
                  Don&apos;t have an account?{' '}
                  <span className="font-semibold text-primary-400 underline">
                    Create New Account
                  </span>
                </button>
              </div>
            </form>
          )}

          {/* Create New Account / Registration Form */}
          {mode === 'signup' && (
            <form onSubmit={handleEmailSignUp} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-surface-300 mb-1.5">
                  Full Name
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-surface-500">
                    <User className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    required
                    placeholder="Your full name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    disabled={isSubmitting || isGoogleLoading}
                    className="w-full pl-10 pr-4 py-2.5 bg-surface-900/60 border border-surface-700 rounded-xl text-surface-100 placeholder-surface-500 text-sm focus:outline-none focus:border-primary-500 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-surface-300 mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-surface-500">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    type="email"
                    required
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isSubmitting || isGoogleLoading}
                    className="w-full pl-10 pr-4 py-2.5 bg-surface-900/60 border border-surface-700 rounded-xl text-surface-100 placeholder-surface-500 text-sm focus:outline-none focus:border-primary-500 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-surface-300 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-surface-500">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type="password"
                    required
                    minLength={6}
                    placeholder="Min 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isSubmitting || isGoogleLoading}
                    className="w-full pl-10 pr-4 py-2.5 bg-surface-900/60 border border-surface-700 rounded-xl text-surface-100 placeholder-surface-500 text-sm focus:outline-none focus:border-primary-500 transition-colors"
                  />
                </div>
              </div>

              <button
                type="submit"
                id="email-signup-button"
                disabled={isSubmitting || isGoogleLoading}
                className="btn-primary w-full py-3 mt-2 flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Creating account...</span>
                  </>
                ) : (
                  <>
                    <span>Create New Account</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setMode('signin');
                    setErrorMessage('');
                    setSuccessMessage('');
                  }}
                  className="text-xs text-surface-400 hover:text-primary-400 transition-colors"
                >
                  Already have an account?{' '}
                  <span className="font-semibold text-primary-400 underline">
                    Sign In
                  </span>
                </button>
              </div>
            </form>
          )}

          {/* Footer note */}
          <div className="mt-8 pt-5 border-t border-surface-800 text-center">
            <p className="text-surface-500 text-[11px] leading-relaxed">
              By accessing VideoSynopsis AI, you agree to our Terms of Service.
              Your video transcripts and files are protected with row-level security.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
