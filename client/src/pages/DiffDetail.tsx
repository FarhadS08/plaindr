import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DiffViewer } from "@/components/dashboard/DiffViewer";
import { AnalysisPanel } from "@/components/dashboard/AnalysisPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  api,
  encodeSourceUrlForRoute,
} from "@/lib/api";
import {
  formatAbsoluteDate,
  formatRelativeTime,
  hostFromUrl,
  riskTone,
} from "@/components/dashboard/diff-helpers";
import { ArrowRight, ExternalLink, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

export default function DiffDetailPage() {
  const [, params] = useRoute("/dashboard/diffs/:id");
  const diffId = params?.id ?? "";

  const { data: diff, isLoading } = useQuery({
    queryKey: ["diff", diffId],
    queryFn: () => api.getDiff(diffId),
    enabled: !!diffId,
  });

  const { data: company } = useQuery({
    queryKey: ["company", diff?.author_id],
    queryFn: () => api.getCompany(diff!.author_id),
    enabled: !!diff?.author_id,
  });

  const tone = riskTone(diff?.analysis?.risk_level);

  return (
    <DashboardShell
      crumbs={[
        { label: "Dashboard", href: "/dashboard" },
        { label: "Diffs" },
        { label: diff ? `v${diff.old_version} → v${diff.new_version}` : "…" },
      ]}
      flush
    >
      {isLoading && (
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 lg:px-8 py-6 space-y-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
            <Skeleton className="h-96" />
            <Skeleton className="h-96" />
          </div>
        </div>
      )}

      {!isLoading && diff && (
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 lg:px-8 py-6 space-y-5">
          <header className="flex items-start gap-4">
            <div
              className={cn(
                "h-10 w-10 rounded-md flex items-center justify-center shrink-0 border",
                tone.badge,
              )}
            >
              <FileText className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Link
                  href={`/dashboard/policies?company=${encodeURIComponent(company?.slug ?? "")}`}
                  className="font-medium text-foreground/80 hover:text-foreground"
                >
                  {company?.name ?? "Unknown"}
                </Link>
                <span className="opacity-40">·</span>
                <span className="font-mono truncate">
                  {hostFromUrl(diff.source_url)}
                </span>
              </div>
              <h1 className="mt-1 text-[22px] font-semibold tracking-tight flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[18px] text-muted-foreground">
                  v{diff.old_version}
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <span className="font-mono text-[18px]">v{diff.new_version}</span>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] uppercase tracking-[0.12em] font-mono h-5 px-1.5 gap-1",
                    tone.badge,
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
                  {tone.label}
                </Badge>
              </h1>

              <div className="mt-2 flex items-center gap-3 flex-wrap text-[12px] font-mono text-muted-foreground">
                <span>
                  <span className="text-emerald-600 dark:text-emerald-400">
                    +{diff.stats.lines_added}
                  </span>
                  <span className="mx-1 opacity-40">/</span>
                  <span className="text-rose-600 dark:text-rose-400">
                    -{diff.stats.lines_removed}
                  </span>{" "}
                  across {diff.stats.hunks} hunk
                  {diff.stats.hunks === 1 ? "" : "s"}
                </span>
                <span className="opacity-40">·</span>
                <span>Computed {formatRelativeTime(diff.computed_at)}</span>
                {diff.old_effective_date && diff.new_effective_date && (
                  <>
                    <span className="opacity-40">·</span>
                    <span>
                      Effective {formatAbsoluteDate(diff.old_effective_date)} →{" "}
                      {formatAbsoluteDate(diff.new_effective_date)}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" asChild>
                <Link
                  href={`/dashboard/policies/${encodeSourceUrlForRoute(diff.source_url)}`}
                  className="gap-1.5"
                >
                  <FileText className="h-3.5 w-3.5" />
                  View policy
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a
                  href={diff.source_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="gap-1.5"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Source
                </a>
              </Button>
            </div>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 items-start">
            <div className="min-w-0">
              <DiffViewer diffText={diff.diff_text} />
            </div>
            <AnalysisPanel diff={diff} className="sticky top-[72px] max-h-[calc(100vh-96px)]" />
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
