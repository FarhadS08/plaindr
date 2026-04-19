import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import type { Company, DiffDocument } from "@/lib/api";
import {
  diffFallbackSummary,
  formatRelativeTime,
  hostFromUrl,
  riskTone,
} from "./diff-helpers";
import { cn } from "@/lib/utils";
import { ArrowRight, GitCommitHorizontal } from "lucide-react";
import { motion } from "framer-motion";

type DiffCardProps = {
  diff: DiffDocument;
  company?: Company;
  index?: number;
};

export function DiffCard({ diff, company, index = 0 }: DiffCardProps) {
  const risk = riskTone(diff.analysis?.risk_level);
  const summary = diff.analysis?.summary ?? diffFallbackSummary(diff);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.2) }}
    >
      <Link
        href={`/dashboard/diffs/${diff.id}`}
        className={cn(
          "group relative block border border-border bg-card",
          "hover:bg-accent/30 hover:border-border/80 transition-colors",
        )}
      >
        {/* Risk stripe */}
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 left-0 w-[3px]",
            risk.dot,
          )}
        />

        <div className="pl-4 pr-4 py-4">
          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-medium text-foreground truncate">
                  {company?.name ?? "Unknown company"}
                </span>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-[12px] text-muted-foreground font-mono truncate">
                  {hostFromUrl(diff.source_url)}
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] uppercase tracking-[0.12em] font-mono h-5 px-1.5 gap-1",
                    risk.badge,
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", risk.dot)} />
                  {risk.label}
                </Badge>
                <span className="ml-auto text-[11px] text-muted-foreground font-mono">
                  {formatRelativeTime(diff.computed_at)}
                </span>
              </div>

              <p className="mt-2 text-[13.5px] leading-relaxed text-foreground/90 line-clamp-2">
                {summary}
              </p>

              <div className="mt-3 flex items-center gap-3 text-[11.5px] text-muted-foreground font-mono">
                <span className="flex items-center gap-1">
                  <GitCommitHorizontal className="h-3 w-3" />
                  v{diff.old_version}
                  <ArrowRight className="h-2.5 w-2.5 opacity-60" />
                  v{diff.new_version}
                </span>
                <span className="opacity-40">·</span>
                <span>
                  <span className="text-emerald-600 dark:text-emerald-400">
                    +{diff.stats.lines_added}
                  </span>
                  <span className="mx-1 opacity-40">/</span>
                  <span className="text-rose-600 dark:text-rose-400">
                    -{diff.stats.lines_removed}
                  </span>
                </span>
                <span className="opacity-40">·</span>
                <span>
                  {diff.stats.hunks} hunk{diff.stats.hunks === 1 ? "" : "s"}
                </span>
                {diff.analysis?.key_changes.length ? (
                  <>
                    <span className="opacity-40">·</span>
                    <span>
                      {diff.analysis.key_changes.length} key change
                      {diff.analysis.key_changes.length === 1 ? "" : "s"}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
