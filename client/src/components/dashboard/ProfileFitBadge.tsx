import { Link } from "wouter";
import { Building2, ChevronRight, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";

/* ─────────────────────────────────────────────────────────────
 * ProfileFitBadge — the tiny "here's your fit profile" strip
 * that lives at the top of Overview once the user has filled in
 * their organization profile. One glance tells them the context
 * Plaindr is using to evaluate tools for them.
 *
 * When the profile is empty, a single-line CTA asks them to fill
 * it in — not a billboard, not redundant with anything else on
 * the page.
 * ───────────────────────────────────────────────────────────── */

const INDUSTRY_LABELS: Record<string, string> = {
  technology: "Technology",
  healthcare: "Healthcare",
  finance: "Finance",
  legal: "Legal",
  education: "Education",
  pharmaceutical: "Pharmaceutical",
  retail: "Retail",
  media: "Media",
  government: "Government",
  nonprofit: "Non-profit",
  consulting: "Consulting",
  manufacturing: "Manufacturing",
  other: "Other",
};

const RESIDENCY_LABELS: Record<string, string> = {
  any: "Any region",
  EU: "EU only",
  US: "US only",
  UK: "UK only",
  other: "Custom residency",
};

export function ProfileFitBadge() {
  const { data: profile, isLoading } = trpc.profiles.get.useQuery();

  if (isLoading) return null;

  const industry = profile?.industry as string | undefined;
  const compliance = (profile?.compliance_requirements as string[]) ?? [];
  const residency = profile?.data_residency as string | undefined;
  const orgName = profile?.organization_name as string | undefined;

  const isEmpty =
    !profile ||
    (!industry && compliance.length === 0 && !residency && !orgName);

  if (isEmpty) {
    return (
      <Link
        href="/profile"
        className="group flex items-center gap-3 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-2.5 hover:border-primary/40 hover:bg-primary/[0.04] transition-colors"
      >
        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-[12.5px] flex-1 truncate">
          <span className="font-medium">Tell Plaindr about your organization</span>
          <span className="text-muted-foreground">
            {" "}
            — industry, compliance, residency. We'll flag tools that fit.
          </span>
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-transform shrink-0" />
      </Link>
    );
  }

  return (
    <Link
      href="/profile"
      className="group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 hover:border-primary/30 transition-colors"
    >
      <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
      <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
        <span className="text-[10.5px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
          Your fit
        </span>
        {orgName && (
          <span className="text-[12.5px] font-medium truncate">{orgName}</span>
        )}
        {industry && (
          <FactChip label={INDUSTRY_LABELS[industry] ?? industry} />
        )}
        {residency && residency !== "any" && (
          <FactChip label={RESIDENCY_LABELS[residency] ?? residency} />
        )}
        {compliance.slice(0, 4).map(c => (
          <FactChip key={c} label={c} tone="primary" />
        ))}
        {compliance.length > 4 && (
          <span className="text-[10.5px] font-mono text-muted-foreground">
            +{compliance.length - 4} more
          </span>
        )}
      </div>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-transform shrink-0" />
    </Link>
  );
}

function FactChip({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "primary";
}) {
  return (
    <span
      className={
        "inline-flex items-center rounded border px-1.5 py-0 text-[10.5px] font-mono uppercase tracking-wider " +
        (tone === "primary"
          ? "border-primary/25 bg-primary/[0.06] text-primary"
          : "border-border bg-background text-muted-foreground")
      }
    >
      {label}
    </span>
  );
}
