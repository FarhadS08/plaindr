import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { trpc } from "@/lib/trpc";
import { useActiveOrgId } from "@/_core/hooks/useActiveOrg";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────────
 * SubmitPolicyDialog — the entry point for user-submitted policies.
 *
 * Three outcomes map to three distinct result views (not toasts) so
 * the user understands what just happened:
 *   - private_new           → "Added to your library"
 *   - canonical_unchanged   → "Already up to date"
 *   - canonical_updated     → "You just freshened this policy"
 *
 * Scope (personal vs org) is read from the active-org context — the
 * dialog never asks the user. That mirrors the CompanyWatchlist and
 * ChatHistory flows.
 * ───────────────────────────────────────────────────────────── */

type SubmitResult = {
  id: string;
  mode: "canonical_unchanged" | "canonical_updated" | "private_new";
  markdown: string;
  diff_text?: string | null;
  last_scraped_at: string;
};

export function SubmitPolicyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const utils = trpc.useUtils();
  const organizationId = useActiveOrgId();
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<SubmitResult | null>(null);

  const submit = trpc.userPolicies.submit.useMutation({
    onSuccess: data => {
      setResult(data as SubmitResult);
      utils.userPolicies.list.invalidate({
        organization_id: organizationId,
      });
      qc.invalidateQueries();
    },
    onError: err => toast.error(err.message),
  });

  function reset() {
    setUrl("");
    setResult(null);
    submit.reset();
  }

  function handleClose(next: boolean) {
    if (!next && submit.isPending) return; // block close during scrape
    if (!next) reset();
    onOpenChange(next);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    submit.mutate({ url: trimmed, organization_id: organizationId });
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        {submit.isPending ? (
          <PhasedLoader />
        ) : result ? (
          <OutcomeView
            result={result}
            scope={organizationId ? "org" : "personal"}
            onAddAnother={reset}
            onClose={() => handleClose(false)}
          />
        ) : (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Add a policy</DialogTitle>
              <DialogDescription>
                Paste a URL. Plaindr will scrape it now, save the content
                to your {organizationId ? "organization's" : "personal"}{" "}
                library, and track changes going forward.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label htmlFor="policy-url">Policy URL</Label>
                <Input
                  id="policy-url"
                  type="url"
                  placeholder="https://example.com/privacy"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  required
                  autoFocus
                  className="mt-1.5"
                />
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Takes 15–30 seconds. We'll show you if the page was
                  already tracked.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleClose(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!url.trim()}>
                Add policy
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Phased loader ────────────────────────────────────────── */

function PhasedLoader() {
  // Client-side timing: no real SSE phases yet, so we simulate. The
  // phases genuinely reflect what's happening server-side; the
  // milliseconds are best-guess so the stepper feels alive.
  return (
    <div className="py-6">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Scraping policy…
        </DialogTitle>
        <DialogDescription>
          This usually takes 15–30 seconds. Feel free to leave this tab;
          your library will refresh when it's done.
        </DialogDescription>
      </DialogHeader>
      <div className="mt-5 space-y-3">
        <LoaderStep done>Fetching the page</LoaderStep>
        <LoaderStep active>Extracting markdown</LoaderStep>
        <LoaderStep>Saving to library</LoaderStep>
      </div>
    </div>
  );
}

function LoaderStep({
  children,
  done = false,
  active = false,
}: {
  children: React.ReactNode;
  done?: boolean;
  active?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span
        className={cn(
          "h-4 w-4 rounded-full flex items-center justify-center shrink-0",
          done && "bg-primary text-primary-foreground",
          active && "bg-primary/20",
          !done && !active && "bg-muted",
        )}
      >
        {done && <CheckCircle2 className="h-3 w-3" />}
        {active && <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />}
      </span>
      <span
        className={cn(
          done && "text-foreground",
          active && "text-foreground font-medium",
          !done && !active && "text-muted-foreground",
        )}
      >
        {children}
      </span>
    </div>
  );
}

/* ── Outcome view ─────────────────────────────────────────── */

function OutcomeView({
  result,
  scope,
  onAddAnother,
  onClose,
}: {
  result: SubmitResult;
  scope: "personal" | "org";
  onAddAnother: () => void;
  onClose: () => void;
}) {
  if (result.mode === "private_new") {
    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            Added to your {scope === "org" ? "organization's" : "personal"} library
          </DialogTitle>
          <DialogDescription>
            Now tracked weekly. You'll see it in the diff feed whenever
            the page changes.
          </DialogDescription>
        </DialogHeader>
        <MarkdownPreview markdown={result.markdown} />
        <DialogFooter>
          <Button variant="ghost" onClick={onAddAnother}>
            Add another
          </Button>
          <Button onClick={onClose}>
            Done
            <ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
        </DialogFooter>
      </>
    );
  }

  if (result.mode === "canonical_unchanged") {
    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="h-5 w-5 text-violet-500" />
            Already up to date
          </DialogTitle>
          <DialogDescription>
            Plaindr already tracks this page and the content hasn't
            changed since our last scrape.
          </DialogDescription>
        </DialogHeader>
        <Alert className="mt-2">
          <AlertTitle className="text-sm">
            Last scraped {formatTimeAgo(result.last_scraped_at)}
          </AlertTitle>
          <AlertDescription className="text-[12px]">
            We added this URL to your library so you'll get updates if it
            ever changes.
          </AlertDescription>
        </Alert>
        <DialogFooter>
          <Button variant="ghost" onClick={onAddAnother}>
            Add another
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </>
    );
  }

  // canonical_updated — the delight moment
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-amber-500" />
          You just freshened this policy
        </DialogTitle>
        <DialogDescription>
          The page had changed since our last scrape. The canonical
          version is now up to date for everyone — nice spot.
        </DialogDescription>
      </DialogHeader>
      {result.diff_text && (
        <div className="mt-2 rounded-md border border-border bg-muted/30 p-3 max-h-56 overflow-auto">
          <pre className="text-[11px] font-mono leading-snug whitespace-pre-wrap text-muted-foreground">
            {result.diff_text.slice(0, 2000)}
            {result.diff_text.length > 2000 && "\n…"}
          </pre>
        </div>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={onAddAnother}>
          Add another
        </Button>
        <Button onClick={onClose}>
          Done
          <ArrowRight className="h-4 w-4 ml-1.5" />
        </Button>
      </DialogFooter>
    </>
  );
}

function MarkdownPreview({ markdown }: { markdown: string }) {
  const preview = markdown.slice(0, 400);
  return (
    <div className="mt-2 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10.5px] uppercase tracking-[0.14em] font-mono text-muted-foreground">
          Preview
        </span>
        <ExternalLink className="h-3 w-3 text-muted-foreground" />
      </div>
      <p className="text-[12px] text-foreground/80 leading-relaxed line-clamp-4">
        {preview}
        {markdown.length > 400 && "…"}
      </p>
    </div>
  );
}

function formatTimeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const days = Math.floor((now - then) / (1000 * 60 * 60 * 24));
  if (days < 1) return "earlier today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}
