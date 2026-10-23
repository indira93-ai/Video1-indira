import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const { email, password, fullName } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: 'Server authentication configuration is missing' },
        { status: 500 }
      );
    }

    // Use admin client with service role key to auto-confirm email without sending emails
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

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
      // If user already registered
      if (
        error.message?.toLowerCase().includes('already registered') ||
        error.message?.toLowerCase().includes('already been registered')
      ) {
        return NextResponse.json(
          { error: 'An account with this email already exists. Please sign in.' },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (data?.user) {
      // Ensure profile row is synced
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

    return NextResponse.json({ success: true, user: data?.user });
  } catch (err) {
    console.error('Registration API error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Registration failed' },
      { status: 500 }
    );
  }
}
