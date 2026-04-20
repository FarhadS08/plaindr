import { useEffect } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Building2,
  Check,
  Loader2,
  Mail,
  ShieldAlert,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/ClerkContext";
import { Button } from "@/components/ui/button";
import { AnimatedOrb } from "@/components/AnimatedOrb";
import { useTheme } from "@/contexts/ThemeContext";

/* ─────────────────────────────────────────────────────────────
 * /invite/:code — accept an org invite.
 *
 * Three states:
 *   1. Not signed in → show invite preview, push to sign-in with
 *      a returnTo so they come back here.
 *   2. Signed in, email doesn't match → explain the mismatch.
 *   3. Signed in, all clear → one-click accept, land on dashboard
 *      with the new org as active context.
 * ───────────────────────────────────────────────────────────── */

export default function InviteAccept() {
  const [, params] = useRoute<{ code: string }>("/invite/:code");
  const code = params?.code ?? "";
  const [, setLocation] = useLocation();
  const { theme } = useTheme();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const qc = useQueryClient();
  const utils = trpc.useUtils();

  const peek = trpc.invites.peek.useQuery(
    { code },
    { enabled: !!code, retry: false },
  );

  const accept = trpc.invites.accept.useMutation({
    onSuccess: async () => {
      toast.success("You're in!");
      await utils.organizations.list.invalidate();
      await utils.organizations.getActive.invalidate();
      await qc.invalidateQueries();
      setLocation("/dashboard");
    },
    onError: err => toast.error(err.message),
  });

  useEffect(() => {
    if (!code) setLocation("/");
  }, [code, setLocation]);

  const invite = peek.data;
  const loading = peek.isLoading || authLoading;

  return (
    <div className="relative min-h-screen bg-background text-foreground overflow-hidden flex items-center justify-center px-4 py-10">
      {/* Ambient wash — matches sign-in */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-[-10%] right-[-10%] w-[60vw] h-[60vw] rounded-full bg-violet-500/20 dark:bg-violet-500/15 blur-[120px]" />
        <div className="absolute bottom-[-20%] left-[-15%] w-[50vw] h-[50vw] rounded-full bg-fuchsia-500/10 dark:bg-fuchsia-500/10 blur-[120px]" />
      </div>
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] opacity-[0.35] dark:opacity-[0.45] -z-10">
        <AnimatedOrb hue={280} isActive intensity={0.8} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <Link href="/" className="inline-block mb-6">
            <img
              src={
                theme === "dark"
                  ? "/plaindrlogotypebw/Plaindr_logo_WORD_white.svg"
                  : "/plaindrlogotypebw/Plaindr_logo_WORD_black.svg"
              }
              alt="Plaindr"
              className="h-8 w-auto mx-auto"
            />
          </Link>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card/60 backdrop-blur-xl p-8 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset,0_30px_80px_-20px_rgba(80,0,180,0.25)]">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !invite?.found ? (
            <InviteError
              title="Invite not found"
              body="This link may have been revoked or never existed."
            />
          ) : invite.accepted_at ? (
            <InviteError
              title="Already used"
              body="This invite was already accepted. Ask for a new one if you need to rejoin."
            />
          ) : new Date(invite.expires_at ?? "").getTime() < Date.now() ? (
            <InviteError
              title="Invite expired"
              body="Ask your admin to send a fresh invite."
            />
          ) : !isAuthenticated ? (
            <InvitePrompt
              invite={invite}
              code={code}
            />
          ) : !invite.email_matches ? (
            <InviteError
              title="Email mismatch"
              body={
                invite.email
                  ? `This invite is for ${invite.email}. Sign in with that email to accept.`
                  : "Email check failed."
              }
            />
          ) : (
            <InviteConfirm
              invite={invite}
              accepting={accept.isPending}
              onAccept={() => accept.mutate({ code })}
            />
          )}
        </div>
      </motion.div>
    </div>
  );
}

function InviteError({ title, body }: { title: string; body: string }) {
  return (
    <div className="text-center space-y-4">
      <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
        <ShieldAlert className="h-6 w-6 text-destructive" />
      </div>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
      <Button asChild variant="outline" className="mt-2">
        <Link href="/">Back home</Link>
      </Button>
    </div>
  );
}

type InvitePreview = {
  found: boolean;
  organization_name?: string;
  organization_slug?: string;
  role?: "admin" | "member";
  email?: string | null;
  expires_at?: string;
  accepted_at?: string | null;
  email_matches?: boolean;
};

function InvitePrompt({
  invite,
  code,
}: {
  invite: InvitePreview;
  code: string;
}) {
  return (
    <div className="space-y-5 text-center">
      <div className="mx-auto w-12 h-12 rounded-xl bg-violet-500/10 flex items-center justify-center">
        <Building2 className="h-6 w-6 text-violet-600 dark:text-violet-300" />
      </div>
      <div>
        <h1 className="text-xl font-semibold">
          Join {invite.organization_name}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          You've been invited as{" "}
          <span className="font-mono text-foreground">{invite.role}</span>.
          Sign in to continue.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Button asChild className="w-full gap-2">
          <Link href={`/sign-in?redirect=/invite/${code}`}>
            Sign in
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link href={`/sign-up?redirect=/invite/${code}`}>
            Create an account
          </Link>
        </Button>
      </div>
    </div>
  );
}

function InviteConfirm({
  invite,
  accepting,
  onAccept,
}: {
  invite: InvitePreview;
  accepting: boolean;
  onAccept: () => void;
}) {
  return (
    <div className="space-y-5 text-center">
      <div className="mx-auto w-12 h-12 rounded-xl bg-violet-500/10 flex items-center justify-center">
        <Building2 className="h-6 w-6 text-violet-600 dark:text-violet-300" />
      </div>
      <div>
        <h1 className="text-xl font-semibold">
          Join {invite.organization_name}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          You'll join as a{" "}
          <span className="font-mono text-foreground">{invite.role}</span>.
        </p>
        {invite.email && (
          <p className="text-[12px] text-muted-foreground mt-2 inline-flex items-center gap-1.5">
            <Mail className="h-3 w-3" />
            Invited email: {invite.email}
          </p>
        )}
      </div>
      <Button onClick={onAccept} disabled={accepting} className="w-full gap-2">
        {accepting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <Check className="h-4 w-4" />
            Accept invite
          </>
        )}
      </Button>
    </div>
  );
}
