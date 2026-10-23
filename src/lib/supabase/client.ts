import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const validUrl =
    url && (url.startsWith('http://') || url.startsWith('https://'))
      ? url
      : 'https://placeholder.supabase.co';
  const validKey = key || 'placeholder-key';

  return createBrowserClient(validUrl, validKey);
}

export async function signOutUser() {
  const supabase = createClient();

  // 1. Clear local Supabase session without making remote network call that fails with 400 Bad Request
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch (err) {
    console.warn('Local sign out notice:', err);
  }

  // 2. Clear browser storage
  if (typeof window !== 'undefined') {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('sb-') || k.includes('supabase') || k.includes('auth'))) {
          localStorage.removeItem(k);
        }
      }
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i);
        if (k && (k.startsWith('sb-') || k.includes('supabase') || k.includes('auth'))) {
          sessionStorage.removeItem(k);
        }
      }
      // Expire auth cookies accessible via JavaScript
      document.cookie.split(';').forEach((cookie) => {
        const eqPos = cookie.indexOf('=');
        const name = (eqPos > -1 ? cookie.substring(0, eqPos) : cookie).trim();
        if (name.startsWith('sb-') || name.includes('auth-token') || name.includes('supabase')) {
          document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;`;
          document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=${window.location.hostname};`;
        }
      });
    } catch {}
  }

  // 3. Clear server cookies via route handler
  try {
    await fetch('/auth/signout', { method: 'POST' });
  } catch {}

  // 4. Hard redirect to home to refresh all server components and client state cleanly
  if (typeof window !== 'undefined') {
    window.location.href = '/';
  }
}

