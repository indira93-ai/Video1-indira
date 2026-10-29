import { NextResponse } from 'next/server';

/**
 * Standard CORS headers for all API routes.
 * Allows web clients on deployed servers (Vercel, custom domains) to make requests.
 */
export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept',
  };
}

/**
 * Common OPTIONS response for preflight CORS requests.
 */
export function handleOptions() {
  return NextResponse.json({}, { status: 200, headers: corsHeaders() });
}

/**
 * Resolves the absolute production application/backend URL.
 * Never defaults to localhost in production environments.
 */
export function getAppBaseUrl(request?: Request): string {
  // 1. Explicit production URL from env (check both standard and backend specific)
  const envUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_URL;

  if (envUrl && !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
    return envUrl.replace(/\/+$/, '');
  }

  // 2. Vercel deployment URL
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  // 3. Forwarded headers from proxy
  if (request) {
    const forwardedHost = request.headers.get('x-forwarded-host');
    const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
    if (forwardedHost) {
      return `${forwardedProto}://${forwardedHost}`;
    }

    try {
      const url = new URL(request.url);
      return url.origin;
    } catch {
      // ignore
    }
  }

  // 4. Browser environment
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  // 5. Fallback for local development
  return envUrl || 'http://localhost:3000';
}
