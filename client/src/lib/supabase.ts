import { createClient } from '@supabase/supabase-js';

/**
 * Browser-side Supabase client.
 *
 * Supabase Auth handles sessions natively: after sign-in, every
 * request from this client carries the user's access token and
 * RLS policies evaluate as that user (auth.uid() in SQL).
 *
 * persistSession is ON so that refreshing the page keeps the user
 * signed in. autoRefreshToken keeps the session alive across long
 * tabs. detectSessionInUrl is ON so OAuth callbacks (if we add
 * providers later) complete correctly.
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '[Supabase] Missing configuration. Set VITE_SUPABASE_URL and ' +
      'VITE_SUPABASE_ANON_KEY.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'plaindr.auth',
  },
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
