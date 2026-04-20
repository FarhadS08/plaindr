import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Building2,
  Check,
  ChevronsUpDown,
  Plus,
  Settings,
  User,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/* ─────────────────────────────────────────────────────────────
 * OrgSwitcher — the top-bar identity pivot.
 *
 * Shows the current context ("Personal" or an org name) and lets
 * the user:
 *   - switch between personal mode and any org they're in,
 *   - create a new org (opens CreateOrgDialog).
 *
 * On any context change we invalidate every tanstack-query cache so
 * sidebar + overview re-fetch under the new scope. Blunt but safe —
 * the alternative (hand-picking queries to invalidate) will miss
 * something eventually and leak another org's data.
 * ───────────────────────────────────────────────────────────── */

export function OrgSwitcher() {
  const qc = useQueryClient();
  const utils = trpc.useUtils();
  const [createOpen, setCreateOpen] = useState(false);

  const orgsQuery = trpc.organizations.list.useQuery(undefined, {
    staleTime: 60_000,
  });
  const activeQuery = trpc.organizations.getActive.useQuery(undefined, {
    staleTime: 60_000,
  });

  const setActive = trpc.organizations.setActive.useMutation({
    onSuccess: async () => {
      // Refetch the active pointer, then blow away every other
      // cache so org-scoped data re-fetches fresh.
      await utils.organizations.getActive.invalidate();
      await qc.invalidateQueries();
    },
    onError: err => toast.error(`Couldn't switch: ${err.message}`),
  });

  const active = activeQuery.data;
  const orgs = orgsQuery.data ?? [];
  const currentLabel = active?.name ?? "Personal";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-2 h-8 rounded-md border border-border bg-muted/40 hover:bg-muted/60 px-2.5 text-[12.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 max-w-[180px]"
          >
            {active ? (
              <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
            ) : (
              <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}
            <span className="truncate">{currentLabel}</span>
            <ChevronsUpDown className="h-3 w-3 text-muted-foreground shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-[10.5px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            Current context
          </DropdownMenuLabel>

          <DropdownMenuItem
            onClick={() =>
              !setActive.isPending &&
              setActive.mutate({ organization_id: null })
            }
            className="gap-2"
          >
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1">Personal</span>
            {!active && <Check className="h-3.5 w-3.5 text-primary" />}
          </DropdownMenuItem>

          {orgs.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10.5px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                Your organizations
              </DropdownMenuLabel>
              {orgs.map(o => (
                <DropdownMenuItem
                  key={o.id}
                  onClick={() =>
                    !setActive.isPending &&
                    setActive.mutate({ organization_id: o.id })
                  }
                  className="gap-2"
                >
                  <Building2 className="h-4 w-4 text-primary" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{o.name}</div>
                    <div className="text-[10.5px] font-mono uppercase tracking-wider text-muted-foreground">
                      {o.role}
                    </div>
                  </div>
                  {active?.id === o.id && (
                    <Check className="h-3.5 w-3.5 text-primary" />
                  )}
                </DropdownMenuItem>
              ))}
            </>
          )}

          {active && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="gap-2">
                <Link href="/settings/org">
                  <Settings className="h-4 w-4 text-muted-foreground" />
                  <span>Manage organization</span>
                </Link>
              </DropdownMenuItem>
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setCreateOpen(true)}
            className="gap-2"
          >
            <Plus className="h-4 w-4 text-primary" />
            <span className="text-primary">Create organization…</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateOrgDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────
 * CreateOrgDialog — minimal name + slug form.
 *
 * Slug auto-derives from the name but stays independently editable;
 * once the user types in the slug field we stop auto-syncing so they
 * don't lose edits.
 * ───────────────────────────────────────────────────────────── */

function CreateOrgDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  const create = trpc.organizations.create.useMutation({
    onSuccess: async () => {
      toast.success("Organization created");
      await utils.organizations.list.invalidate();
      await utils.organizations.getActive.invalidate();
      await qc.invalidateQueries();
      onOpenChange(false);
    },
    onError: err => toast.error(err.message),
  });

  // Reset form whenever the dialog closes so reopening gives a
  // clean slate without stale values flashing.
  useEffect(() => {
    if (!open) {
      setName("");
      setSlug("");
      setSlugTouched(false);
    }
  }, [open]);

  // Auto-derive slug from name until the user taps the slug field.
  const derivedSlug = useMemo(() => toSlug(name), [name]);
  useEffect(() => {
    if (!slugTouched) setSlug(derivedSlug);
  }, [derivedSlug, slugTouched]);

  const canSubmit =
    name.trim().length >= 1 &&
    slug.length >= 2 &&
    /^[a-z0-9-]+$/.test(slug) &&
    !create.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
          <DialogDescription>
            Organizations let your team share watchlists, conversations, and
            policy notes. You can always create more later.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={e => {
            e.preventDefault();
            if (!canSubmit) return;
            create.mutate({ name: name.trim(), slug });
          }}
          className="space-y-4 py-2"
        >
          <div>
            <Label htmlFor="org-name">Name</Label>
            <Input
              id="org-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Acme Legal"
              maxLength={100}
              className="mt-1.5"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="org-slug">Slug</Label>
            <Input
              id="org-slug"
              value={slug}
              onChange={e => {
                setSlug(e.target.value.toLowerCase());
                setSlugTouched(true);
              }}
              placeholder="acme-legal"
              maxLength={64}
              className="mt-1.5 font-mono text-[13px]"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Used in invite links. Lowercase letters, digits, dashes.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              className={cn(create.isPending && "opacity-75")}
            >
              {create.isPending ? "Creating…" : "Create organization"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function toSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
