import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const errorParam = searchParams.get('error_description') || searchParams.get('error');
  const next = searchParams.get('next') ?? '/dashboard';

  // If OAuth provider returned an error directly
  if (errorParam) {
    console.error('OAuth callback error parameter:', errorParam);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(errorParam)}`);
  }

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    
    if (!error && data?.session) {
      // Ensure real user details (Google Gmail & name) are recorded in the profiles table
      const user = data.session.user;
      if (user) {
        try {
          await supabase.from('profiles').upsert(
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

      const forwardedHost = request.headers.get('x-forwarded-host');
      const isLocalEnv = process.env.NODE_ENV === 'development';
      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`);
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      } else {
        return NextResponse.redirect(`${origin}${next}`);
      }
    } else if (error) {
      console.error('exchangeCodeForSession failed:', error.message);
      return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
