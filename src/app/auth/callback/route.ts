import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getAppBaseUrl } from '@/lib/api-utils';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const baseUrl = getAppBaseUrl(request);
  const code = searchParams.get('code');
  const errorParam = searchParams.get('error_description') || searchParams.get('error');
  const next = searchParams.get('next') ?? '/dashboard';

  // If OAuth provider returned an error directly
  if (errorParam) {
    console.error('OAuth callback error parameter:', errorParam);
    return NextResponse.redirect(`${baseUrl}/login?error=${encodeURIComponent(errorParam)}`);
  }

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data?.session) {
      const user = data.session.user;
      if (user) {
        try {
          const adminSupabase = createAdminClient();
          await adminSupabase.from('profiles').upsert(
            {
              id: user.id,
              email: user.email,
              full_name:
                user.user_metadata?.full_name ||
                user.user_metadata?.name ||
                user.email?.split('@')[0] ||
                '',
              avatar_url:
                user.user_metadata?.avatar_url ||
                user.user_metadata?.picture ||
                '',
            },
            { onConflict: 'id' }
          );
        } catch (profileErr) {
          console.warn('Profile sync in auth callback notice:', profileErr);
        }
      }

      return NextResponse.redirect(`${baseUrl}${next}`);
    } else if (error) {
      console.error('exchangeCodeForSession failed:', error.message);
      return NextResponse.redirect(`${baseUrl}/login?error=${encodeURIComponent(error.message)}`);
    }
  }

  return NextResponse.redirect(`${baseUrl}/login?error=auth_failed`);
}
