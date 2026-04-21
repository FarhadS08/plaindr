import { useMemo } from "react";
import { Link, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DiffCard } from "@/components/dashboard/DiffCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type DiffDocument } from "@/lib/api";
import { cn } from "@/lib/utils";
import { riskTone } from "@/components/dashboard/diff-helpers";
import { Activity, ArrowLeft, GitCommitHorizontal } from "lucide-react";

/* ─────────────────────────────────────────────────────────────
 * /dashboard/diffs — filterable list view.
 *
 * Landing target for the Pulse chart (?date=YYYY-MM-DD) and the
 * Risk ledger (?risk=low|medium|high|critical) on the overview.
 * When no filter is set, shows all recent diffs as a plain feed.
 * ───────────────────────────────────────────────────────────── */

type RiskLevel = "low" | "medium" | "high" | "critical";
const VALID_RISKS: RiskLevel[] = ["low", "medium", "high", "critical"];

export default function DiffsPage() {
  const search = useSearch();
  const { date, risk } = parseFilters(search);

  const { data: diffs = [], isLoading } = useQuery({
    queryKey: ["overview-diffs"],
    queryFn: () => api.recentDiffs(90),
    retry: 1,
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["companies"],
    queryFn: api.listCompanies,
    staleTime: 5 * 60_000,
  });

  const companyById = useMemo(
    () => new Map(companies.map(c => [c.id, c])),
    [companies],
  );

  const filtered = useMemo(
    () => filterDiffs(diffs, { date, risk }),
    [diffs, date, risk],
  );

  const hasFilter = Boolean(date || risk);

  return (
    <DashboardShell crumbs={[{ label: "Diffs" }]}>
      <div className="max-w-4xl mx-auto py-8 space-y-5">
        <Header
          date={date}
          risk={risk}
          filteredCount={filtered.length}
          totalCount={diffs.length}
          hasFilter={hasFilter}
        />

        {isLoading ? (
          <SkeletonList />
        ) : filtered.length === 0 ? (
          <EmptyState date={date} risk={risk} hasFilter={hasFilter} />
        ) : (
          <div className="space-y-2">
            {filtered.map((d, i) => (
              <DiffCard
                key={d.id}
                diff={d}
                company={companyById.get(d.author_id)}
                index={i}
              />
            ))}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

/* ── filter parsing ───────────────────────────────────────── */

function parseFilters(search: string): {
  date: string | null;
  risk: RiskLevel | null;
} {
  const params = new URLSearchParams(search);
  const rawDate = params.get("date");
  const rawRisk = params.get("risk");
  return {
    date: rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null,
    risk: rawRisk && (VALID_RISKS as string[]).includes(rawRisk)
      ? (rawRisk as RiskLevel)
      : null,
  };
}

function filterDiffs(
  diffs: DiffDocument[],
  { date, risk }: { date: string | null; risk: RiskLevel | null },
): DiffDocument[] {
  if (!date && !risk) return diffs;
  return diffs.filter(d => {
    if (date && dayKey(d.computed_at) !== date) return false;
    if (risk && (d.analysis?.risk_level ?? "low") !== risk) return false;
    return true;
  });
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ── header ───────────────────────────────────────────────── */

function Header({
  date,
  risk,
  filteredCount,
  totalCount,
  hasFilter,
}: {
  date: string | null;
  risk: RiskLevel | null;
  filteredCount: number;
  totalCount: number;
  hasFilter: boolean;
}) {
  const { label, icon, color } = describeFilter(date, risk);

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn("grid place-items-center h-6 w-6 rounded-md border border-border bg-background", color)}>
            {icon}
          </span>
          <h1 className="text-xl font-semibold">{label}</h1>
        </div>
        <p className="text-[12.5px] text-muted-foreground mt-1.5 font-mono">
          {hasFilter
            ? `${filteredCount} of ${totalCount} diff${totalCount === 1 ? "" : "s"}`
            : `${totalCount} diff${totalCount === 1 ? "" : "s"} · last 90 days`}
        </p>
      </div>
      {hasFilter && (
        <Button asChild variant="ghost" size="sm" className="gap-1.5 shrink-0">
          <Link href="/dashboard/diffs">
            <ArrowLeft className="h-3.5 w-3.5" />
            All diffs
          </Link>
        </Button>
      )}
    </div>
  );
}

function describeFilter(date: string | null, risk: RiskLevel | null) {
  if (date) {
    return {
      label: formatFriendlyDate(date),
      icon: <Activity className="h-3 w-3 text-primary" />,
      color: "text-primary",
    };
  }
  if (risk) {
    const tone = riskTone(risk);
    return {
      label: `${tone.label}-risk changes`,
      icon: <span className={cn("h-2 w-2 rounded-full", tone.dot)} />,
      color: "text-foreground",
    };
  }
  return {
    label: "All diffs",
    icon: <GitCommitHorizontal className="h-3 w-3 text-muted-foreground" />,
    color: "text-muted-foreground",
  };
}

function formatFriendlyDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ms = today.getTime() - date.getTime();
  const days = Math.round(ms / 86_400_000);
  if (days === 0) return "Today's diffs";
  if (days === 1) return "Yesterday's diffs";
  return `Diffs on ${date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}`;
}

/* ── empty + skeleton ─────────────────────────────────────── */

function EmptyState({
  date,
  risk,
  hasFilter,
}: {
  date: string | null;
  risk: RiskLevel | null;
  hasFilter: boolean;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 py-16 text-center">
      <GitCommitHorizontal className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
      <h2 className="text-sm font-semibold">No diffs to show</h2>
      <p className="text-[12.5px] text-muted-foreground mt-1.5 max-w-sm mx-auto">
        {date
          ? "Nothing changed on this day."
          : risk
          ? "No changes at this risk level in the last 90 days."
          : "The weekly cron hasn't found any changes yet."}
      </p>
      {hasFilter && (
        <Button asChild variant="outline" size="sm" className="mt-5">
          <Link href="/dashboard/diffs">See all diffs</Link>
        </Button>
      )}
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="border border-border rounded-lg divide-y divide-border">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16 ml-auto" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}
