import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/ClerkContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AnimatedOrb } from '@/components/AnimatedOrb';
import { useTheme } from '@/contexts/ThemeContext';

export default function SignUp() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();
  const { theme } = useTheme();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const redirectTo = getRedirect();
  useEffect(() => {
    if (!isLoading && isAuthenticated) setLocation(redirectTo);
  }, [isLoading, isAuthenticated, setLocation, redirectTo]);

  function getRedirect(): string {
    if (typeof window === 'undefined') return '/dashboard';
    const raw = new URLSearchParams(window.location.search).get('redirect');
    if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
    return '/dashboard';
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName || undefined },
      },
    });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    if (data.session) {
      setLocation(redirectTo);
    } else {
      setNotice(
        'Check your email to confirm your account. Once verified, sign in to continue.',
      );
    }
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground overflow-hidden flex items-center justify-center px-4 py-10">
      {/* Ambient background wash — matches landing */}
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
        <div className="absolute top-[-10%] right-[-10%] w-[60vw] h-[60vw] rounded-full bg-violet-500/20 dark:bg-violet-500/15 blur-[120px]" />
        <div className="absolute bottom-[-20%] left-[-15%] w-[50vw] h-[50vw] rounded-full bg-fuchsia-500/10 dark:bg-fuchsia-500/10 blur-[120px]" />
      </div>

      {/* Floating orb */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] opacity-[0.35] dark:opacity-[0.45] -z-10">
        <AnimatedOrb hue={290} isActive intensity={0.8} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="w-full max-w-md"
      >
        {/* Header */}
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
            Start reading policy{' '}
            <span className="italic font-serif text-violet-600 dark:text-violet-300">
              the right way
            </span>
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Free for your first 50 questions. No credit card.
          </p>
        </div>

        {/* Card */}
        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-border/70 bg-card/60 backdrop-blur-xl p-8 space-y-5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset,0_30px_80px_-20px_rgba(80,0,180,0.25)]"
        >
          <div className="space-y-2">
            <Label
              htmlFor="fullName"
              className="text-xs uppercase tracking-[0.14em] text-muted-foreground"
            >
              Full name
            </Label>
            <Input
              id="fullName"
              autoComplete="name"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              className="h-11 rounded-xl bg-background/60"
              placeholder="Your name"
            />
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="email"
              className="text-xs uppercase tracking-[0.14em] text-muted-foreground"
            >
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
            <Label
              htmlFor="password"
              className="text-xs uppercase tracking-[0.14em] text-muted-foreground"
            >
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="h-11 rounded-xl bg-background/60"
              placeholder="At least 8 characters"
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
          {notice && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-sm text-muted-foreground flex items-start gap-2 p-3 rounded-xl bg-violet-500/10 border border-violet-500/20"
              role="status"
            >
              <Check className="w-4 h-4 text-violet-600 dark:text-violet-300 shrink-0 mt-0.5" />
              <span className="flex-1">{notice}</span>
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
                Create account
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>

          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Check className="w-3 h-3 text-emerald-500" />
              50 free questions
            </span>
            <span className="inline-flex items-center gap-1">
              <Check className="w-3 h-3 text-emerald-500" />
              No credit card
            </span>
            <span className="inline-flex items-center gap-1">
              <Check className="w-3 h-3 text-emerald-500" />
              30-second setup
            </span>
          </div>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already on Plaindr?{' '}
          <Link
            href="/sign-in"
            className="text-foreground font-medium hover:text-violet-600 dark:hover:text-violet-300 transition-colors"
          >
            Sign in
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
