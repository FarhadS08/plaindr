import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, CheckCircle2 } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { useActiveOrgId } from "@/_core/hooks/useActiveOrg";
import { supabase } from "@/lib/supabase";
import {
  api,
  type IngestCompanyInput,
  type IngestEvent,
  type IngestPolicyInput,
} from "@/lib/api";
import { IngestProgress } from "./IngestProgress";

/* ─────────────────────────────────────────────────────────────
 * SubmitPolicyDialog — the entry point for the Library.
 *
 * The user pastes a company's MAIN URL; we crawl it, let them confirm
 * the company and pick which discovered policies to add, then scrape
 * + promote the selection into the shared corpus with a cinematic
 * progress view. Four states: input → review → ingesting → done.
 *
 * Scope (personal vs org) is read from the active-org context — the
 * dialog never asks.
 * ───────────────────────────────────────────────────────────── */

type Phase = "input" | "review" | "ingesting" | "done";

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

  const [phase, setPhase] = useState<Phase>("input");
  const [url, setUrl] = useState("");
  const [company, setCompany] = useState<IngestCompanyInput | null>(null);
  const [policies, setPolicies] = useState<IngestPolicyInput[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [events, setEvents] = useState<IngestEvent[]>([]);

  const discover = trpc.userPolicies.discover.useMutation({
    onSuccess: data => {
      setCompany(data.company as IngestCompanyInput);
      setPolicies(data.policies);
      setChecked(Object.fromEntries(data.policies.map(p => [p.url, true])));
      setPhase("review");
    },
    onError: err => toast.error(err.message),
  });

  const selected = useMemo(
    () => policies.filter(p => checked[p.url]),
    [policies, checked],
  );

  function reset() {
    setPhase("input");
    setUrl("");
    setCompany(null);
    setPolicies([]);
    setChecked({});
    setEvents([]);
    discover.reset();
  }

  function handleClose(next: boolean) {
    if (!next && phase === "ingesting") return; // block close mid-ingest
    if (!next) reset();
    onOpenChange(next);
  }

  async function startIngest() {
    if (!company || selected.length === 0) return;
    setEvents([]);
    setPhase("ingesting");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? "";
    let sawDone = false;
    await api.ingestPoliciesStream(
      { company, organization_id: organizationId, policies: selected },
      {
        accessToken: token,
        onEvent: e => {
          setEvents(prev => [...prev, e]);
          if (e.type === "done") {
            sawDone = true;
            setPhase("done");
            utils.userPolicies.list.invalidate({
              organization_id: organizationId,
            });
            qc.invalidateQueries();
          } else if (e.type === "error") {
            toast.error(e.message);
          }
        },
        onError: err =>
          toast.error(err instanceof Error ? err.message : "Ingest failed"),
      },
    );
    // The stream ended. If no terminal `done` frame arrived (network
    // drop, token expiry, server killed mid-stream), don't strand the
    // dialog in "ingesting" — surface what completed and let the user
    // out. Any partially-promoted policies show in the Library.
    if (!sawDone) {
      toast.error("Connection interrupted before finishing — check your Library.");
      utils.userPolicies.list.invalidate({ organization_id: organizationId });
      qc.invalidateQueries();
      setPhase("done");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        {phase === "input" && (
          <form
            onSubmit={e => {
              e.preventDefault();
              const t = url.trim();
              if (t)
                discover.mutate({ url: t, organization_id: organizationId });
            }}
          >
            <DialogHeader>
              <DialogTitle>Add a company</DialogTitle>
              <DialogDescription>
                Paste a company's main URL. Plaindr finds its privacy,
                terms, and security pages — you pick which to add.
              </DialogDescription>
            </DialogHeader>
            <div className="py-3">
              <Label htmlFor="company-url">Company URL</Label>
              <Input
                id="company-url"
                type="url"
                autoFocus
                required
                placeholder="https://chatgpt.com"
                value={url}
                onChange={e => setUrl(e.target.value)}
                className="mt-1.5"
              />
              <p className="text-[11px] text-muted-foreground mt-1.5">
                We'll scan the site for policy pages — takes a few seconds.
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleClose(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!url.trim() || discover.isPending}
              >
                {discover.isPending ? "Scanning…" : "Find policies"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {phase === "review" && company && (
          <>
            <DialogHeader>
              <DialogTitle>Confirm & pick policies</DialogTitle>
              <DialogDescription>
                Found {policies.length} policy page
                {policies.length === 1 ? "" : "s"} on {company.main_url}.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3 py-2">
              <div>
                <Label htmlFor="co-name">Company</Label>
                <Input
                  id="co-name"
                  value={company.name}
                  className="mt-1.5"
                  onChange={e =>
                    setCompany({ ...company, name: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="co-cat">Category</Label>
                <Input
                  id="co-cat"
                  value={company.category}
                  className="mt-1.5"
                  onChange={e =>
                    setCompany({ ...company, category: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="max-h-56 overflow-auto space-y-1.5 py-1">
              {policies.length === 0 && (
                <p className="text-[12px] text-muted-foreground px-2 py-3">
                  No policy pages found on that site. Try a more specific URL.
                </p>
              )}
              {policies.map(p => (
                <label
                  key={p.url}
                  className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/50 cursor-pointer"
                >
                  <Checkbox
                    checked={!!checked[p.url]}
                    onCheckedChange={v =>
                      setChecked(c => ({ ...c, [p.url]: !!v }))
                    }
                  />
                  <span className="text-[12px] truncate flex-1">{p.title}</span>
                  <span className="text-[10px] font-mono uppercase text-muted-foreground">
                    {p.policy_type}
                  </span>
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPhase("input")}>
                Back
              </Button>
              <Button onClick={startIngest} disabled={selected.length === 0}>
                Add {selected.length}{" "}
                {selected.length === 1 ? "policy" : "policies"}
              </Button>
            </DialogFooter>
          </>
        )}

        {phase === "ingesting" && (
          <>
            <DialogHeader>
              <DialogTitle>Adding policies…</DialogTitle>
              <DialogDescription>
                Hang tight — we're reading and filing each page.
              </DialogDescription>
            </DialogHeader>
            <IngestProgress policies={selected} events={events} />
          </>
        )}

        {phase === "done" && company && (
          <DoneView
            company={company}
            events={events}
            selected={selected}
            onAddAnother={reset}
            onClose={() => handleClose(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Done view ────────────────────────────────────────────── */

function DoneView({
  company,
  events,
  selected,
  onAddAnother,
  onClose,
}: {
  company: IngestCompanyInput;
  events: IngestEvent[];
  selected: IngestPolicyInput[];
  onAddAnother: () => void;
  onClose: () => void;
}) {
  const doneEvent = events.find(e => e.type === "done") as
    | Extract<IngestEvent, { type: "done" }>
    | undefined;
  // Per-policy results from the stream. Used to label failed titles and,
  // when the terminal `done` frame never arrived, to derive the totals.
  const policyDone = events.filter(
    (e): e is Extract<IngestEvent, { type: "policy_done" }> =>
      e.type === "policy_done",
  );
  const added =
    doneEvent?.added ?? policyDone.filter(e => e.result !== "failed").length;
  const failed =
    doneEvent?.failed ?? policyDone.filter(e => e.result === "failed").length;
  const failedTitles = selected
    .filter((_, i) =>
      policyDone.some(e => e.index === i && e.result === "failed"),
    )
    .map(p => p.title);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          {failed === 0
            ? `Added ${added} ${added === 1 ? "policy" : "policies"} to ${company.name}`
            : `Added ${added}, couldn't read ${failed}`}
        </DialogTitle>
        <DialogDescription>
          Now tracked for changes — you'll see updates in the diff feed.
          {failedTitles.length > 0 && (
            <span className="block mt-1 text-[12px]">
              Skipped: {failedTitles.join(", ")}
            </span>
          )}
        </DialogDescription>
      </DialogHeader>
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
