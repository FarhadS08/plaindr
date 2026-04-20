/**
 * Supabase Auth provider.
 *
 * The file is still named ClerkContext.tsx for import stability —
 * every caller does `from "@/contexts/ClerkContext"`. Contents
 * are 100% Supabase now; Clerk is fully gone.
 *
 * Exports intentionally mirror the old Clerk surface so the pages
 * didn't need a rewrite:
 *   - useAuth()   → { user, isAuthenticated, isLoading, signOut }
 *   - SignedIn / SignedOut  → gating wrappers
 *   - SignInButton / SignUpButton  → redirect shims
 *   - UserButton  → avatar with sign-out
 *   - useUser()   → Clerk-shaped compat object (fullName, firstName,
 *                   imageUrl, emailAddresses, createdAt) so profile
 *                   pages keep rendering without surgery
 */

import type { ReactElement, ReactNode } from 'react';
import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Link, useLocation } from 'wouter';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

type AuthUser = {
  id: string;
  email: string | null;
  name: string | null;
  imageUrl: string | null;
};

type AuthContextType = {
  user: AuthUser | null;
  session: Session | null;
  rawUser: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

function normalizeUser(u: User | null): AuthUser | null {
  if (!u) return null;
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    null;
  const imageUrl =
    (typeof meta.avatar_url === 'string' && meta.avatar_url) || null;
  return {
    id: u.id,
    email: u.email ?? null,
    name,
    imageUrl,
  };
}

export function ClerkAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setIsLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setIsLoading(false);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({
      user: normalizeUser(session?.user ?? null),
      session,
      rawUser: session?.user ?? null,
      isAuthenticated: !!session?.user,
      isLoading,
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [session, isLoading],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within ClerkAuthProvider');
  return ctx;
}

/* ── gating wrappers ────────────────────────────────────────── */

export function SignedIn({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading || !isAuthenticated) return null;
  return <>{children}</>;
}

export function SignedOut({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading || isAuthenticated) return null;
  return <>{children}</>;
}

/* ── redirect shims for old Clerk button APIs ───────────────── */

type AuthButtonProps = {
  children?: ReactNode;
  // Clerk API compat — accepted, ignored. Supabase uses pages, not modals.
  mode?: 'modal' | 'redirect';
  afterSignInUrl?: string;
  afterSignUpUrl?: string;
};

function wrapAsLink(children: ReactNode, href: string, fallback: ReactNode) {
  if (isValidElement(children)) {
    // Mirror Clerk's asChild behavior — wrap the user's element in
    // a Link so styles on the child (Button, etc.) still apply.
    return (
      <Link href={href}>
        {cloneElement(children as ReactElement<Record<string, unknown>>)}
      </Link>
    );
  }
  return <Link href={href}>{fallback}</Link>;
}

export function SignInButton({ children }: AuthButtonProps) {
  return wrapAsLink(
    children,
    '/sign-in',
    <button className="text-sm underline">Sign in</button>,
  );
}

export function SignUpButton({ children }: AuthButtonProps) {
  return wrapAsLink(
    children,
    '/sign-up',
    <button className="text-sm underline">Sign up</button>,
  );
}

/* ── UserButton: avatar + sign-out dropdown ─────────────────── */

export function UserButton({
  afterSignOutUrl = '/',
}: {
  afterSignOutUrl?: string;
}) {
  const { user, signOut } = useAuth();
  const [, setLocation] = useLocation();
  if (!user) return null;
  const initial = (user.name ?? user.email ?? 'U').charAt(0).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Account"
          className="inline-flex items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar className="h-8 w-8">
            {user.imageUrl && (
              <AvatarImage src={user.imageUrl} alt={user.name ?? 'User'} />
            )}
            <AvatarFallback className="text-xs">{initial}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col">
            <span className="text-sm font-medium truncate">
              {user.name ?? 'Signed in'}
            </span>
            {user.email && (
              <span className="text-xs text-muted-foreground truncate">
                {user.email}
              </span>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setLocation('/profile')}>
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={async () => {
            await signOut();
            setLocation(afterSignOutUrl);
          }}
          className="text-destructive focus:text-destructive"
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ── useUser compat shim ────────────────────────────────────── */
// Profile.tsx et al. reach for Clerk-specific fields. We return a
// minimal object shaped like Clerk's User so those pages render
// without needing field-by-field surgery.

export function useUser() {
  const { user, rawUser, isLoading } = useAuth();
  const shaped = useMemo(() => {
    if (!rawUser) return null;
    const first = user?.name?.split(' ')[0] ?? null;
    return {
      id: rawUser.id,
      fullName: user?.name ?? null,
      firstName: first,
      imageUrl: user?.imageUrl ?? undefined,
      primaryEmailAddress: user?.email
        ? { emailAddress: user.email }
        : null,
      emailAddresses: user?.email
        ? [{ emailAddress: user.email }]
        : [],
      createdAt: rawUser.created_at
        ? new Date(rawUser.created_at)
        : undefined,
    };
  }, [rawUser, user]);
  return { user: shaped, isLoaded: !isLoading, isSignedIn: !!rawUser };
}
