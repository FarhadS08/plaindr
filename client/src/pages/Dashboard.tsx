import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  Flame,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  ConceptWatchlist,
  PulseChart,
  RiskLedger,
  StatTile,
} from "@/components/dashboard/OverviewWidgets";

/* ─────────────────────────────────────────────────────────────
 * Dashboard / Overview — the bird's-eye view.
 *
 * Deliberately not a feed. The sidebar, Pulse strip in chat, and
 * /dashboard/diffs all show recent diffs as lists already. Repeating
 * the list here would be noise. Instead this page surfaces three
 * aggregate views that don't live anywhere else: Pulse over time,
 * Risk distribution, and the Concept watchlist (what *topics* moved).
 * ───────────────────────────────────────────────────────────── */

const DAY_MS = 86_400_000;

export default function DashboardPage() {
  // Pull a broad diff window once and fan it out to every widget.
  // 90 items gives Pulse a full 30-day chart on an active week while
  // staying cheap — the in-memory diff store returns instantly.
  const {
    data: diffs = [],
    isLoading: loadingDiffs,
    isError: diffsError,
    refetch: refetchDiffs,
  } = useQuery({
    queryKey: ["overview-diffs"],
    queryFn: () => api.recentDiffs(90),
    retry: 1,
    retryDelay: 2000,
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["companies"],
    queryFn: api.listCompanies,
    staleTime: 5 * 60_000,
  });

  // Derived stats — everything computed from the one diff array so
  // the three tiles, chart and watchlist stay in lock-step.
  const stats = useMemo(() => {
    const now = Date.now();
    const weekAgo = now - 7 * DAY_MS;
    const monthAgo = now - 30 * DAY_MS;
    let diffsThisWeek = 0;
    let criticalThisMonth = 0;
    const moversThisWeek = new Set<string>();
    for (const d of diffs) {
      const t = new Date(d.computed_at).getTime();
      if (t >= weekAgo) {
        diffsThisWeek += 1;
        moversThisWeek.add(d.author_id);
      }
      if (t >= monthAgo) {
        const level = d.analysis?.risk_level;
        if (level === "critical" || level === "high") {
          criticalThisMonth += 1;
        }
      }
    }
    return {
      diffsThisWeek,
      moversThisWeek: moversThisWeek.size,
      criticalThisMonth,
    };
  }, [diffs]);

  return (
    <DashboardShell crumbs={[{ label: "Overview" }]}>
      <div className="max-w-[1280px] mx-auto space-y-5">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">
              Policy pulse across the AI ecosystem
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              The macro view: how much is moving, what's risky, and which
              policy concepts are actually shifting.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StatTile
              icon={TrendingUp}
              label="This week"
              value={loadingDiffs ? "—" : stats.diffsThisWeek}
            />
            <StatTile
              icon={Building2}
              label="Movers · 7d"
              value={loadingDiffs ? "—" : stats.moversThisWeek}
            />
            <StatTile
              icon={Flame}
              label="Critical · 30d"
              value={loadingDiffs ? "—" : stats.criticalThisMonth}
              tone={stats.criticalThisMonth > 0 ? "warn" : undefined}
            />
          </div>
        </header>

        {/* Slim Ask Plaindr tile — not a billboard. The sidebar nav
            and ⌘K already do this job loudly; this is a one-line
            pointer for users who landed here by accident. */}
        <Link
          href="/dashboard/chat"
          className="group flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/[0.03] px-4 py-2.5 hover:border-primary/40 hover:bg-primary/[0.06] transition-colors"
        >
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          <span className="text-[13px] font-medium flex-1 truncate">
            Ask Plaindr
          </span>
          <span className="text-[11px] text-muted-foreground truncate">
            Cited answers across 465 policies
          </span>
          <ArrowUpRight className="h-3.5 w-3.5 text-primary group-hover:translate-x-0.5 transition-transform shrink-0" />
        </Link>

        {diffsError && (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <AlertTriangle className="h-5 w-5 text-amber-500 mx-auto mb-2" />
            <p className="text-sm font-medium mb-1">
              Couldn't reach the Plaindr API
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              The backend may be warming up. Retry in a moment.
            </p>
            <button
              type="button"
              onClick={() => refetchDiffs()}
              className="text-xs font-medium text-primary hover:underline"
            >
              Retry
            </button>
          </div>
        )}

        {loadingDiffs ? (
          <OverviewSkeleton />
        ) : (
          !diffsError && (
            <>
              <PulseChart diffs={diffs} />
              <RiskLedger diffs={diffs} />
              <ConceptWatchlist diffs={diffs} companies={companies} />
            </>
          )
        )}
      </div>
    </DashboardShell>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-40 w-full rounded-lg" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[0, 1, 2, 3].map(i => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}
