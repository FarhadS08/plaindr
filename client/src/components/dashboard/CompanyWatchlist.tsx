import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Bookmark,
  Check,
  ChevronRight,
  Plus,
  Search,
  X,
} from "lucide-react";
import { api, type Company, type DiffDocument } from "@/lib/api";
import { trpc } from "@/lib/trpc";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatRelativeTime, riskTone, type RiskLevel } from "./diff-helpers";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────────
 * CompanyWatchlist — personal "follow these companies" widget.
 *
 * Lives on the Overview. Complements (does NOT replace) the
 * Concept Watchlist: that one is concept-indexed, this one is
 * company-indexed and personal. Together they answer both shapes
 * of the "what should I pay attention to?" question.
 * ───────────────────────────────────────────────────────────── */

export function CompanyWatchlist({ diffs }: { diffs: DiffDocument[] }) {
  const utils = trpc.useUtils();
  const watchlistQuery = trpc.watchlist.list.useQuery();
  // Surface mutation errors inline — silently failing watchlist
  // writes (RLS, missing table, stale server bundle) used to look
  // like "nothing happens when I click add", which is uninformative.
  const [mutationError, setMutationError] = useState<string | null>(null);
  const add = trpc.watchlist.add.useMutation({
    onSuccess: () => {
      setMutationError(null);
      return utils.watchlist.list.invalidate();
    },
    onError: err => setMutationError(err.message),
  });
  const remove = trpc.watchlist.remove.useMutation({
    onSuccess: () => {
      setMutationError(null);
      return utils.watchlist.list.invalidate();
    },
    onError: err => setMutationError(err.message),
  });
  const { data: companies = [] } = useQuery({
    queryKey: ["watchlist-companies"],
    queryFn: api.listCompanies,
    staleTime: 5 * 60_000,
  });

  const companyById = useMemo(
    () => new Map(companies.map(c => [c.id, c])),
    [companies],
  );
  const watchedIds = useMemo(
    () => new Set((watchlistQuery.data ?? []).map(w => w.company_id)),
    [watchlistQuery.data],
  );

  // Precompute the latest diff per company so each row can show
  // "last moved N days ago" without scanning the full diff list.
  const latestDiffByCompany = useMemo(() => {
    const map = new Map<string, DiffDocument>();
    for (const d of diffs) {
      const existing = map.get(d.author_id);
      if (!existing || d.computed_at > existing.computed_at) {
        map.set(d.author_id, d);
      }
    }
    return map;
  }, [diffs]);

  const watched = useMemo(() => {
    return (watchlistQuery.data ?? [])
      .map(w => {
        const company = companyById.get(w.company_id);
        if (!company) return null;
        return {
          company,
          latest: latestDiffByCompany.get(w.company_id) ?? null,
        };
      })
      .filter((x): x is { company: Company; latest: DiffDocument | null } =>
        Boolean(x),
      );
  }, [watchlistQuery.data, companyById, latestDiffByCompany]);

  return (
    <section>
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <Bookmark className="h-3 w-3 text-primary" />
          <h3 className="text-[10.5px] font-mono uppercase tracking-[0.16em] text-primary">
            Your watchlist
          </h3>
          {watched.length > 0 && (
            <span className="text-[10.5px] font-mono text-muted-foreground">
              · {watched.length}
            </span>
          )}
        </div>
        <AddCompanyPopover
          companies={companies}
          watchedIds={watchedIds}
          onAdd={id => add.mutate({ company_id: id })}
        />
      </div>

      {watchlistQuery.isError && (
        <InlineError
          title="Couldn't load your watchlist"
          detail={watchlistQuery.error?.message ?? "Unknown error"}
        />
      )}
      {mutationError && (
        <InlineError
          title="Couldn't save watchlist change"
          detail={mutationError}
        />
      )}

      {watchlistQuery.isLoading ? (
        <div className="rounded-lg border border-border bg-card h-20 animate-pulse" />
      ) : watched.length === 0 ? (
        <EmptyWatchlist
          companies={companies}
          watchedIds={watchedIds}
          onAdd={id => add.mutate({ company_id: id })}
        />
      ) : (
        <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
          {watched.map(({ company, latest }) => (
            <WatchlistRow
              key={company.id}
              company={company}
              latest={latest}
              onRemove={() => remove.mutate({ company_id: company.id })}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function InlineError({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mb-2 rounded-md border border-destructive/30 bg-destructive/[0.04] px-3 py-2 text-[12px]">
      <p className="font-medium text-destructive">{title}</p>
      <p className="mt-0.5 text-destructive/80 font-mono text-[11px] break-all">
        {detail}
      </p>
    </div>
  );
}

/* ── empty state ─────────────────────────────────────────────── */

function EmptyWatchlist({
  companies,
  watchedIds,
  onAdd,
}: {
  companies: Company[];
  watchedIds: Set<string>;
  onAdd: (companyId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center">
      <div className="mx-auto h-9 w-9 rounded-full bg-background border border-border grid place-items-center mb-3">
        <Bookmark className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="text-[13px] font-medium">Watch the companies you care about.</p>
      <p className="text-[12px] text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
        Add up to a dozen AI tools you actually use. Their changes will
        surface here first — before the ecosystem-wide feed.
      </p>
      <div className="mt-4 flex justify-center">
        <AddCompanyPopover
          companies={companies}
          watchedIds={watchedIds}
          onAdd={onAdd}
          variant="cta"
        />
      </div>
    </div>
  );
}

/* ── row ─────────────────────────────────────────────────────── */

function WatchlistRow({
  company,
  latest,
  onRemove,
}: {
  company: Company;
  latest: DiffDocument | null;
  onRemove: () => void;
}) {
  const [, setLocation] = useLocation();
  const risk = (latest?.analysis?.risk_level as RiskLevel | undefined) ?? "low";
  const tone = riskTone(risk);
  const headline = latest?.analysis?.summary?.trim()
    ? truncate(latest.analysis.summary, 110)
    : latest
      ? `${latest.stats.lines_added}+/${latest.stats.lines_removed}-`
      : "No changes since we started watching.";

  const openCompany = () =>
    setLocation(`/dashboard/policies?company=${encodeURIComponent(company.slug)}`);

  return (
    <div className="group flex items-center gap-3 px-4 py-2.5 hover:bg-accent/30 transition-colors">
      <button
        type="button"
        onClick={openCompany}
        className="flex-1 min-w-0 flex items-start gap-3 text-left"
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full mt-1.5 shrink-0",
            latest ? tone.dot : "bg-muted",
          )}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[12.5px] font-medium truncate">
              {company.name}
            </span>
            {latest && (
              <span className="text-[10.5px] font-mono text-muted-foreground shrink-0">
                {formatRelativeTime(latest.computed_at, { short: true })}
              </span>
            )}
          </div>
          <p className="text-[11.5px] text-muted-foreground truncate mt-0.5 group-hover:text-foreground/80 transition-colors">
            {headline}
          </p>
        </div>
      </button>
      {latest && (
        <button
          type="button"
          onClick={() => setLocation(`/dashboard/diffs/${latest.id}`)}
          aria-label="Open latest diff"
          className="shrink-0 h-7 w-7 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${company.name} from watchlist`}
        className="shrink-0 h-7 w-7 rounded-md grid place-items-center text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ── add-company popover ─────────────────────────────────────── */

function AddCompanyPopover({
  companies,
  watchedIds,
  onAdd,
  variant = "subtle",
}: {
  companies: Company[];
  watchedIds: Set<string>;
  onAdd: (companyId: string) => void;
  variant?: "subtle" | "cta";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const sorted = [...companies].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const term = query.trim().toLowerCase();
    if (!term) return sorted.slice(0, 80);
    return sorted
      .filter(c => c.name.toLowerCase().includes(term))
      .slice(0, 80);
  }, [companies, query]);

  const trigger =
    variant === "cta" ? (
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-primary hover:bg-primary/15 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        Add a company
      </button>
    ) : (
      <button
        type="button"
        aria-label="Add to watchlist"
        className="inline-flex items-center gap-1 text-[10.5px] font-mono text-muted-foreground hover:text-primary transition-colors"
      >
        <Plus className="h-3 w-3" />
        Add
      </button>
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="flex items-center gap-2 border-b border-border px-3 h-9">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search 130+ companies…"
            className="flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ScrollArea className="h-64">
          <div className="py-1">
            {filtered.map(c => {
              const already = watchedIds.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={already}
                  onClick={() => {
                    onAdd(c.id);
                    // Leave the popover open so users can add several
                    // in one sitting without the extra click overhead.
                    setQuery("");
                  }}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-1.5 text-left text-[12.5px] transition-colors",
                    already
                      ? "text-muted-foreground cursor-default"
                      : "hover:bg-accent",
                  )}
                >
                  <span className="truncate">{c.name}</span>
                  {already ? (
                    <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                  ) : (
                    <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-[11.5px] text-muted-foreground text-center">
                No matches
              </div>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

/* ── tiny helpers ───────────────────────────────────────────── */

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}
