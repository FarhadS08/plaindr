import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { ArrowRight, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/ClerkContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AnimatedOrb } from '@/components/AnimatedOrb';
import { useTheme } from '@/contexts/ThemeContext';

export default function SignIn() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();
  const { theme } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const redirectTo = getRedirect();
  useEffect(() => {
    if (!isLoading && isAuthenticated) setLocation(redirectTo);
  }, [isLoading, isAuthenticated, setLocation, redirectTo]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setLocation(redirectTo);
  }

  function getRedirect(): string {
    if (typeof window === 'undefined') return '/dashboard';
    const raw = new URLSearchParams(window.location.search).get('redirect');
    // Only allow local paths — blocks open-redirect attempts via ?redirect=https://evil.
    if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
    return '/dashboard';
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground overflow-hidden flex items-center justify-center px-4">
      {/* Ambient background wash — matches landing page */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute inset-0 opacity-[0.35] dark:opacity-[0.25]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
            backgroundSize: '28px 28px',
            color: 'var(--border)',
            maskImage:
              'radial-gradient(ellipse at 50% 0%, black 0%, transparent 70%)',
            WebkitMaskImage:
              'radial-gradient(ellipse at 50% 0%, black 0%, transparent 70%)',
          }}
        />
        <div className="absolute top-[-10%] left-[-10%] w-[60vw] h-[60vw] rounded-full bg-violet-500/20 dark:bg-violet-500/15 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-15%] w-[50vw] h-[50vw] rounded-full bg-fuchsia-500/10 dark:bg-fuchsia-500/10 blur-[120px]" />
      </div>

      {/* Floating orb off to the side */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] opacity-[0.35] dark:opacity-[0.45] -z-10">
        <AnimatedOrb hue={270} isActive intensity={0.8} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="w-full max-w-md"
      >
        {/* Header: logo + welcome */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-block mb-6">
            <img
              src={
                theme === 'dark'
                  ? '/plaindrlogotypebw/Plaindr_logo_WORD_white.svg'
                  : '/plaindrlogotypebw/Plaindr_logo_WORD_black.svg'
              }
              alt="Plaindr"
              className="h-8 w-auto mx-auto"
            />
          </Link>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] leading-[1.05]">
            Welcome{' '}
            <span className="italic font-serif text-violet-600 dark:text-violet-300">
              back
            </span>
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Sign in to keep reading AI policy the Plaindr way.
          </p>
        </div>

        {/* Card */}
        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-border/70 bg-card/60 backdrop-blur-xl p-8 space-y-5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset,0_30px_80px_-20px_rgba(80,0,180,0.25)]"
        >
          <div className="space-y-2">
            <Label htmlFor="email" className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="h-11 rounded-xl bg-background/60"
              placeholder="you@work.com"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password" className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                Password
              </Label>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="h-11 rounded-xl bg-background/60"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-sm text-destructive flex items-start gap-2"
              role="alert"
            >
              <span className="inline-block w-1 h-1 mt-2 rounded-full bg-destructive" />
              <span className="flex-1">{error}</span>
            </motion.p>
          )}

          <Button
            type="submit"
            disabled={submitting}
            className="w-full h-11 rounded-xl bg-foreground text-background hover:bg-foreground/90 gap-2"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                Sign in
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          New to Plaindr?{' '}
          <Link
            href="/sign-up"
            className="text-foreground font-medium hover:text-violet-600 dark:hover:text-violet-300 transition-colors"
          >
            Create an account
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
