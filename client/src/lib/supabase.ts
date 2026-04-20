import { createClient } from '@supabase/supabase-js';

/**
 * Browser-side Supabase client.
 *
 * Every request is signed with the current Clerk JWT via a custom
 * fetch. Realtime WebSocket auth uses the same mechanism. Until the
 * Clerk JWT template named "supabase" is configured (Clerk dashboard
 * → JWT Templates → New → signed HS256 with Supabase's JWT Secret),
 * getToken() returns null and requests go unauthenticated — in which
 * case RLS (migration 006) will reject every read/write. Sign-in
 * must therefore complete AND the template must exist before this
 * client can see any data.
 *
 * The server-side Supabase client (in server/routers.ts) uses the
 * SERVICE ROLE key, which bypasses RLS entirely. Browser and server
 * are separate code paths that never share credentials.
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

console.log('[Supabase] Configuration:', {
  hasUrl: !!supabaseUrl,
  hasKey: !!supabaseAnonKey,
  urlPrefix: supabaseUrl ? supabaseUrl.substring(0, 30) + '...' : 'MISSING',
});

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '[Supabase] Missing configuration! Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.',
  );
}

// Module-level token getter that the Clerk-aware bootstrapper populates
// once the session is ready. Kept in a mutable ref so every request
// grabs the freshest token without recreating the Supabase client.
let currentTokenGetter: (() => Promise<string | null>) | null = null;
let warnedMissingTemplate = false;

export function setSupabaseTokenGetter(
  getter: (() => Promise<string | null>) | null,
): void {
  currentTokenGetter = getter;
}

async function fetchWithClerkToken(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  let token: string | null = null;
  try {
    token = currentTokenGetter ? await currentTokenGetter() : null;
  } catch (err) {
    console.warn('[Supabase] Clerk token fetch failed:', err);
  }
  if (!token && !warnedMissingTemplate) {
    warnedMissingTemplate = true;
    console.warn(
      "[Supabase] No Clerk JWT available for this request. Create a Clerk " +
      'JWT template named "supabase" (HS256, signed with Supabase JWT secret) ' +
      'and make sure the user is signed in. Until then, RLS will deny access.',
    );
  }
  const headers = new Headers(init.headers ?? {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  // Keep our own token lifecycle — Clerk is the source of truth.
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: { fetch: fetchWithClerkToken },
});

export interface Conversation {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  audio_url: string | null;
  created_at: string;
}
