import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { corsHeaders, handleOptions } from '@/lib/api-utils';

export async function OPTIONS() {
  return handleOptions();
}

export async function POST(request: Request) {
  try {
    const { email, password, fullName } = await request.json().catch(() => ({}));

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400, headers: corsHeaders() }
      );
    }

    const supabaseAdmin = createAdminClient();
    const name = fullName?.trim() || email.split('@')[0] || 'User';

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true, // Automatically confirms the user without sending verification email
      user_metadata: {
        full_name: name,
        name: name,
      },
    });

    if (error) {
      if (
        error.message?.toLowerCase().includes('already registered') ||
        error.message?.toLowerCase().includes('already been registered')
      ) {
        return NextResponse.json(
          { error: 'An account with this email already exists. Please sign in.' },
          { status: 400, headers: corsHeaders() }
        );
      }
      return NextResponse.json(
        { error: error.message },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (data?.user) {
      try {
        await supabaseAdmin.from('profiles').upsert(
          {
            id: data.user.id,
            email: data.user.email,
            full_name: name,
          },
          { onConflict: 'id' }
        );
      } catch (profileErr) {
        console.warn('Profile upsert notice:', profileErr);
      }
    }

    return NextResponse.json(
      { success: true, user: data?.user },
      { headers: corsHeaders() }
    );
  } catch (err) {
    console.error('Registration API error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Registration failed' },
      { status: 500, headers: corsHeaders() }
    );
  }
}
