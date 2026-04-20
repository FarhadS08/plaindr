import { createClient } from '@supabase/supabase-js';
import type { Request } from 'express';

/**
 * Server-side Supabase auth verification.
 *
 * The browser signs in via Supabase Auth. Every tRPC request then
 * carries the user's Supabase access token in the Authorization
 * header. We verify it here by asking Supabase who the token belongs
 * to — any other approach (local JWT verification, signature check)
 * trades off correctness for a few ms, which we don't need.
 *
 * Returns a normalized AuthedUser shape that the rest of the app
 * already knows how to consume (id, email, name, imageUrl, role).
 */

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';

// A single anon client is enough for verification — we pass the
// caller's bearer token on each getUser() call, so no per-request
// client construction needed.
const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

export interface AuthedUser {
  id: string;
  email: string | null;
  name: string | null;
  imageUrl: string | null;
  role: 'user' | 'admin';
  accessToken: string;
}

export function extractAccessToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  // Supabase stores the session in a cookie named `sb-access-token`
  // in some setups, but we're header-only — keep it simple.
  return null;
}

export async function verifySupabaseSession(
  req: Request,
): Promise<AuthedUser | null> {
  const token = extractAccessToken(req);
  if (!token) return null;

  try {
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data?.user) return null;
    const u = data.user;
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
    const displayName =
      (typeof meta.full_name === 'string' && meta.full_name) ||
      (typeof meta.name === 'string' && meta.name) ||
      null;
    const avatarUrl =
      (typeof meta.avatar_url === 'string' && meta.avatar_url) || null;
    const appMeta = (u.app_metadata ?? {}) as Record<string, unknown>;
    const role = appMeta.role === 'admin' ? 'admin' : 'user';

    return {
      id: u.id,
      email: u.email ?? null,
      name: displayName,
      imageUrl: avatarUrl,
      role,
      accessToken: token,
    };
  } catch (err) {
    console.warn('[supabaseAuth] verification failed:', err);
    return null;
  }
}
