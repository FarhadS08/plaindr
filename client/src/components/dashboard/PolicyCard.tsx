import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import type { Company, Policy } from "@/lib/api";
import { encodeSourceUrlForRoute } from "@/lib/api";
import {
  formatAbsoluteDate,
  formatRelativeTime,
  hostFromUrl,
  prettyPolicyType,
} from "./diff-helpers";
import { cn } from "@/lib/utils";
import { FileText, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";

type PolicyCardProps = {
  policy: Policy;
  company?: Company;
  index?: number;
};

export function PolicyCard({ policy, company, index = 0 }: PolicyCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.025, 0.25) }}
    >
      <Link
        href={`/dashboard/policies/${encodeSourceUrlForRoute(policy.source_url)}`}
        className={cn(
          "group relative block border border-border bg-card",
          "hover:bg-accent/30 hover:border-border/80 transition-colors",
          "h-full p-4",
        )}
      >
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-[5px] bg-primary/10 flex items-center justify-center shrink-0">
            <FileText className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2">
              <h3 className="text-[13.5px] font-medium leading-snug line-clamp-2 flex-1">
                {policy.title}
              </h3>
              <Badge
                variant="outline"
                className="text-[9px] uppercase tracking-[0.12em] font-mono h-4 px-1 shrink-0 mt-0.5"
              >
                v{policy.version}
              </Badge>
            </div>
            <div className="mt-1 flex items-center gap-2 flex-wrap text-[11.5px] text-muted-foreground">
              <span className="font-medium text-foreground/80">
                {company?.name ?? hostFromUrl(policy.source_url)}
              </span>
              <span className="opacity-40">·</span>
              <span>{prettyPolicyType(policy.policy_type)}</span>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-[11px] font-mono text-muted-foreground">
          <span>
            Updated {formatRelativeTime(policy.scraped_at ?? policy.effective_date)}
          </span>
          <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            View
            <ExternalLink className="h-3 w-3" />
          </span>
        </div>

        {policy.effective_date && (
          <div className="mt-1 text-[10.5px] font-mono text-muted-foreground/70">
            Effective {formatAbsoluteDate(policy.effective_date)}
          </div>
        )}
      </Link>
    </motion.div>
  );
}
