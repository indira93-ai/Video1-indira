import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  } catch (err) {
    console.warn('Signout warning in /auth/signout:', err);
  }

  const cookieStore = await cookies();
  const allCookies = cookieStore.getAll();
  const url = new URL('/', request.url);
  const response = NextResponse.redirect(url, { status: 303 });

  for (const cookie of allCookies) {
    if (
      cookie.name.startsWith('sb-') ||
      cookie.name.includes('auth-token') ||
      cookie.name.includes('supabase')
    ) {
      try {
        cookieStore.delete(cookie.name);
      } catch {}
      try {
        response.cookies.delete(cookie.name);
      } catch {}
    }
  }

  return response;
}

export async function GET(request: Request) {
  return POST(request);
}
