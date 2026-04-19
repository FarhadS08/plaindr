import { useQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DiffCard } from "@/components/dashboard/DiffCard";
import { VoiceAskHero } from "@/components/dashboard/VoiceAskHero";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, AlertTriangle, Radio, Telescope } from "lucide-react";
import { cn } from "@/lib/utils";

export default function DashboardPage() {
  const {
    data: diffs,
    isLoading: loadingDiffs,
    isError: diffsError,
    refetch: refetchDiffs,
  } = useQuery({
    queryKey: ["diffs-recent", 20],
    queryFn: () => api.recentDiffs(20),
    retry: 1,
    retryDelay: 2000,
  });

  const { data: companies } = useQuery({
    queryKey: ["companies"],
    queryFn: api.listCompanies,
    staleTime: 5 * 60_000,
  });

  const companiesById = new Map((companies ?? []).map(c => [c.id, c]));

  const criticalCount =
    diffs?.filter(d =>
      ["critical", "high"].includes(d.analysis?.risk_level ?? ""),
    ).length ?? 0;

  return (
    <DashboardShell crumbs={[{ label: "Overview" }]}>
      <div className="max-w-[1280px] mx-auto space-y-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">
              Policy changes across the AI ecosystem
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              The newest diffs, ranked by impact. Ask a question to search across
              every tracked policy.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Stat
              icon={Telescope}
              label="Companies"
              value={companies?.length ?? "—"}
            />
            <Stat
              icon={Activity}
              label="Diffs shown"
              value={diffs?.length ?? "—"}
            />
            <Stat
              icon={AlertTriangle}
              label="High-impact"
              value={criticalCount}
              tone={criticalCount > 0 ? "warn" : undefined}
            />
          </div>
        </header>

        <VoiceAskHero />

        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold tracking-tight">
                Recent changes
              </h2>
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-mono">
                <Radio className="h-3 w-3 animate-pulse" />
                live
              </span>
            </div>
            {diffs && diffs.length > 0 && (
              <span className="text-[11px] font-mono text-muted-foreground">
                {diffs.length} diffs shown
              </span>
            )}
          </div>

          {loadingDiffs && (
            <div className="space-y-0">
              {[0, 1, 2, 3, 4, 5].map(i => (
                <div
                  key={i}
                  className={cn(
                    "border border-t-0 border-border bg-card p-4",
                    i === 0 && "border-t",
                  )}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="ml-auto h-3 w-16" />
                  </div>
                  <Skeleton className="h-3 w-full mt-2" />
                  <Skeleton className="h-3 w-4/5 mt-1" />
                  <Skeleton className="h-3 w-40 mt-3" />
                </div>
              ))}
            </div>
          )}

          {diffsError && (
            <div className="border border-border bg-card p-8 text-center">
              <p className="text-sm font-medium mb-1">
                Couldn't reach the Plaindr API
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                The backend may be warming up (first request after idle).
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

          {!loadingDiffs && diffs && diffs.length === 0 && (
            <div className="border border-border bg-card p-10 text-center">
              <div className="mx-auto h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-3">
                <Radio className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">All quiet on the policy front.</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                No policy changes yet — watching {companies?.length ?? 130}{" "}
                companies across 465+ policies for you.
              </p>
            </div>
          )}

          <div className="space-y-0">
            {diffs?.map((d, i) => (
              <div key={d.id} className={i === 0 ? "" : "border-t-0"}>
                <DiffCard diff={d} company={companiesById.get(d.author_id)} index={i} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  tone?: "warn";
}) {
  return (
    <div
      className={cn(
        "border border-border bg-card px-3 py-2 flex items-center gap-2.5 min-w-[120px]",
        tone === "warn" && "border-amber-500/40 bg-amber-500/[0.04]",
      )}
    >
      <Icon
        className={cn(
          "h-3.5 w-3.5",
          tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
        )}
      />
      <div>
        <div className="text-[10px] uppercase tracking-[0.12em] font-mono text-muted-foreground">
          {label}
        </div>
        <div className="text-[14px] font-semibold tabular-nums leading-tight">
          {value}
        </div>
      </div>
    </div>
  );
}
