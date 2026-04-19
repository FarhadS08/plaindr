import { useMemo } from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import {
  api,
  decodeSourceUrlFromRoute,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowRight,
  Calendar,
  ExternalLink,
  FileText,
  GitCommitHorizontal,
} from "lucide-react";
import {
  formatAbsoluteDate,
  formatRelativeTime,
  hostFromUrl,
  prettyPolicyType,
  riskTone,
} from "@/components/dashboard/diff-helpers";
import { cn } from "@/lib/utils";

export default function PolicyDetailPage() {
  const [, params] = useRoute("/dashboard/policies/:sourceUrlEncoded");
  const sourceUrl = params?.sourceUrlEncoded
    ? decodeSourceUrlFromRoute(params.sourceUrlEncoded)
    : "";

  const { data: policy, isLoading: loadingPolicy } = useQuery({
    queryKey: ["policy", sourceUrl],
    queryFn: () => api.getPolicy(sourceUrl),
    enabled: !!sourceUrl,
  });

  const { data: diffs } = useQuery({
    queryKey: ["policy-diffs", sourceUrl],
    queryFn: () => api.diffsByUrl(sourceUrl),
    enabled: !!sourceUrl,
  });

  const { data: company } = useQuery({
    queryKey: ["company", policy?.author_id],
    queryFn: () => api.getCompany(policy!.author_id),
    enabled: !!policy?.author_id,
  });

  const history = useMemo(
    () =>
      (diffs ?? []).slice().sort((a, b) =>
        b.computed_at.localeCompare(a.computed_at),
      ),
    [diffs],
  );

  return (
    <DashboardShell
      crumbs={[
        { label: "Dashboard", href: "/dashboard" },
        { label: "Policies", href: "/dashboard/policies" },
        { label: policy?.title ?? hostFromUrl(sourceUrl) },
      ]}
    >
      <div className="max-w-[1280px] mx-auto">
        {loadingPolicy && (
          <div className="space-y-4">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}

        {!loadingPolicy && policy && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
            <div className="min-w-0">
              <header className="flex items-start gap-4 mb-6">
                <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-[12px] text-muted-foreground mb-1">
                    <span className="font-medium text-foreground/80">
                      {company?.name ?? hostFromUrl(policy.source_url)}
                    </span>
                    <span className="opacity-40">·</span>
                    <span>{prettyPolicyType(policy.policy_type)}</span>
                    <Badge variant="outline" className="h-4 px-1 text-[10px] font-mono">
                      v{policy.version}
                    </Badge>
                  </div>
                  <h1 className="text-[22px] font-semibold tracking-tight leading-tight">
                    {policy.title}
                  </h1>
                  <div className="mt-2 flex items-center gap-3 text-[12px] font-mono text-muted-foreground">
                    {policy.effective_date && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Effective {formatAbsoluteDate(policy.effective_date)}
                      </span>
                    )}
                    {policy.scraped_at && (
                      <span>
                        Scraped {formatRelativeTime(policy.scraped_at)}
                      </span>
                    )}
                  </div>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={policy.source_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="gap-1.5"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open source
                  </a>
                </Button>
              </header>

              <div className="border border-border bg-card">
                <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-[0.14em] font-mono text-muted-foreground">
                    Policy content
                  </span>
                  <span className="text-[11px] font-mono text-muted-foreground">
                    v{policy.version}
                  </span>
                </div>
                <div className="p-6">
                  {policy.content ? (
                    <article className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-[13.5px] leading-[1.7] text-foreground/90">
                      {policy.content}
                    </article>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      Full content isn't available for this policy snapshot.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <aside className="space-y-4">
              <div className="border border-border bg-card">
                <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                  <GitCommitHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[11px] uppercase tracking-[0.14em] font-mono text-muted-foreground">
                    Version history
                  </span>
                  <span className="ml-auto text-[11px] font-mono text-muted-foreground">
                    {history.length}
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {history.length === 0 && (
                    <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                      No diffs recorded for this policy yet.
                    </div>
                  )}
                  {history.map(d => {
                    const tone = riskTone(d.analysis?.risk_level);
                    return (
                      <Link
                        key={d.id}
                        href={`/dashboard/diffs/${d.id}`}
                        className="flex items-start gap-3 px-4 py-3 hover:bg-accent/40 transition-colors"
                      >
                        <span
                          className={cn(
                            "mt-1 h-1.5 w-1.5 rounded-full shrink-0",
                            tone.dot,
                          )}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-mono">
                            v{d.old_version}
                            <ArrowRight className="h-3 w-3 inline mx-1 opacity-60" />
                            v{d.new_version}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {formatRelativeTime(d.computed_at)}
                          </div>
                          <div className="text-[11px] font-mono text-muted-foreground mt-1">
                            <span className="text-emerald-600 dark:text-emerald-400">
                              +{d.stats.lines_added}
                            </span>
                            <span className="mx-1 opacity-40">/</span>
                            <span className="text-rose-600 dark:text-rose-400">
                              -{d.stats.lines_removed}
                            </span>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>

              <div className="border border-border bg-card p-4">
                <span className="text-[11px] uppercase tracking-[0.14em] font-mono text-muted-foreground">
                  Metadata
                </span>
                <Separator className="my-3" />
                <dl className="space-y-2 text-[12px]">
                  <MetaRow k="Source">
                    <a
                      href={policy.source_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-primary hover:underline font-mono break-all"
                    >
                      {hostFromUrl(policy.source_url)}
                    </a>
                  </MetaRow>
                  <MetaRow k="Company">
                    {company?.name ?? "—"}
                  </MetaRow>
                  <MetaRow k="Type">
                    {prettyPolicyType(policy.policy_type)}
                  </MetaRow>
                  <MetaRow k="Version">v{policy.version}</MetaRow>
                </dl>
              </div>
            </aside>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

function MetaRow({
  k,
  children,
}: {
  k: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <dt className="w-16 shrink-0 text-[10px] uppercase tracking-[0.12em] font-mono text-muted-foreground pt-0.5">
        {k}
      </dt>
      <dd className="flex-1 min-w-0 text-foreground/90">{children}</dd>
    </div>
  );
}
