import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  Info,
  Shapes,
  type LucideIcon,
} from "lucide-react";
import type { Company, DiffDocument } from "@/lib/api";
import { riskTone, type RiskLevel } from "./diff-helpers";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────────
 * Overview widgets — macro views that only live here.
 *
 * The Overview page is the bird's-eye. Every other surface in the
 * product is a drill-down (sidebar feed, Policies page, Diffs page,
 * Chat). These three widgets do what only an aggregated view can:
 *
 *   - PulseChart: cadence of changes over time. "Is the AI policy
 *     world calm or busy this week?" Nowhere else shows *time*.
 *   - RiskLedger: distribution by severity over the last 30 days.
 *     Nowhere else shows the *shape* of recent risk.
 *   - ConceptWatchlist: recent changes grouped by what they touched
 *     (training opt-out, retention, subprocessors, EU…), not by
 *     which company shipped them. The distinctive Plaindr view —
 *     every other surface is company-indexed.
 * ───────────────────────────────────────────────────────────── */

/* ── helpers ────────────────────────────────────────────────── */

const DAY_MS = 86_400_000;

/**
 * Normalise an ISO timestamp down to a YYYY-MM-DD day key in the
 * user's local time. Using local time matches what the user sees on
 * tile timestamps — UTC would split diffs across midnight oddly.
 */
function dayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Inclusive list of YYYY-MM-DD day keys for the last N days, oldest first. */
function lastNDayKeys(days: number): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * DAY_MS);
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
  }
  return out;
}

/**
 * The canonical policy-concept dictionary. Each concept has a label,
 * the keywords we scan diff text for, and the comparative question
 * the row fires when clicked.
 *
 * Ordered most-important first so ties in match score resolve to the
 * more user-facing concept.
 */
type Concept = {
  id: string;
  label: string;
  keywords: RegExp;
  question: string;
};

const CONCEPTS: Concept[] = [
  {
    id: "training",
    label: "Training opt-out",
    keywords:
      /\b(training|train\s+(?:our|the)\s+model|model\s+improvement|fine-?tun|do\s+not\s+train)\b/i,
    question:
      "Which AI tools changed their training-data or model-improvement clauses this month?",
  },
  {
    id: "retention",
    label: "Data retention",
    keywords: /\b(retention|retain|how\s+long|storage\s+duration|keep\s+your\s+data)\b/i,
    question:
      "Which AI tools adjusted data-retention periods this month?",
  },
  {
    id: "third-party",
    label: "Third-party sharing",
    keywords: /\b(third[-\s]?part|subprocessor|sub-?processor|data\s+shar|disclos)\b/i,
    question:
      "Which AI tools updated their third-party or subprocessor policies this month?",
  },
  {
    id: "eu-gdpr",
    label: "EU / GDPR",
    keywords: /\b(gdpr|eea|european\s+union|ireland\s+limited|sccs?|standard\s+contractual|data\s+residency)\b/i,
    question:
      "Which AI tools moved on EU / GDPR provisions this month?",
  },
  {
    id: "deletion",
    label: "Deletion rights",
    keywords: /\b(deletion|delete|erasure|right\s+to\s+be\s+forgotten)\b/i,
    question: "Which AI tools changed deletion or erasure clauses this month?",
  },
  {
    id: "security",
    label: "Security & breach",
    keywords: /\b(security|encryption|breach|incident\s+notification|vulnerability)\b/i,
    question:
      "Which AI tools updated security, encryption or breach-notification terms this month?",
  },
  {
    id: "minors",
    label: "Child / minor use",
    keywords: /\b(child|minor|under\s+13|under\s+16|parental\s+consent)\b/i,
    question: "Which AI tools updated minor-use or parental-consent clauses this month?",
  },
  {
    id: "advertising",
    label: "Advertising & marketing",
    keywords: /\b(advertis|marketing\s+communications|promotional)\b/i,
    question: "Which AI tools adjusted advertising or marketing clauses this month?",
  },
];

/**
 * Scan a diff's analyzer output and return every concept that applies.
 * Empty list means "no canonical concept matched" — we drop those
 * from the watchlist so users aren't distracted by logo swaps and
 * copy tweaks.
 */
function conceptsForDiff(diff: DiffDocument): Concept[] {
  const a = diff.analysis;
  if (!a) return [];
  const text = [
    a.summary,
    a.consequences,
    ...a.key_changes.map(k => `${k.section} ${k.description}`),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return CONCEPTS.filter(c => c.keywords.test(text));
}

/* ── Pulse chart ─────────────────────────────────────────────── */

type PulsePoint = {
  key: string; // YYYY-MM-DD
  count: number;
  topRisk: RiskLevel | null;
};

export function PulseChart({ diffs }: { diffs: DiffDocument[] }) {
  const [, setLocation] = useLocation();
  const points = useMemo<PulsePoint[]>(() => {
    const days = lastNDayKeys(30);
    const byDay = new Map<string, { count: number; topRisk: RiskLevel | null }>();
    for (const day of days) byDay.set(day, { count: 0, topRisk: null });

    const RISK_ORDER: RiskLevel[] = ["low", "medium", "high", "critical"];
    const rank = (r: RiskLevel | null | undefined) =>
      r ? RISK_ORDER.indexOf(r) : -1;

    for (const d of diffs) {
      const day = dayKey(d.computed_at);
      const bucket = byDay.get(day);
      if (!bucket) continue;
      bucket.count += 1;
      const diffRisk = (d.analysis?.risk_level as RiskLevel | undefined) ?? "low";
      if (rank(diffRisk) > rank(bucket.topRisk)) bucket.topRisk = diffRisk;
    }

    return days.map(key => ({
      key,
      count: byDay.get(key)?.count ?? 0,
      topRisk: byDay.get(key)?.topRisk ?? null,
    }));
  }, [diffs]);

  const maxCount = Math.max(1, ...points.map(p => p.count));
  const total = points.reduce((s, p) => s + p.count, 0);
  const activeDays = points.filter(p => p.count > 0).length;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-background border border-border grid place-items-center">
            <Activity className="h-3 w-3 text-primary" />
          </div>
          <h3 className="text-[10.5px] font-mono uppercase tracking-[0.16em] text-primary">
            Pulse · 30 days
          </h3>
        </div>
        <div className="text-[10.5px] font-mono text-muted-foreground">
          {total} diffs · {activeDays} active {activeDays === 1 ? "day" : "days"}
        </div>
      </div>

      <div className="flex items-end gap-[2px] h-24">
        {points.map(p => {
          const tone = p.count === 0 ? null : riskTone(p.topRisk ?? "low");
          const heightPct = p.count === 0 ? 3 : 10 + (p.count / maxCount) * 90;
          const label = `${p.count} diff${p.count === 1 ? "" : "s"} on ${p.key}`;
          return (
            <button
              key={p.key}
              type="button"
              title={label}
              aria-label={label}
              disabled={p.count === 0}
              onClick={() => setLocation(`/dashboard/diffs?date=${p.key}`)}
              className={cn(
                "flex-1 rounded-sm transition-opacity",
                p.count === 0
                  ? "bg-muted/60 cursor-default"
                  : cn(tone?.dot, "hover:opacity-75 cursor-pointer"),
              )}
              style={{ height: `${heightPct}%` }}
            />
          );
        })}
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[9.5px] font-mono text-muted-foreground">
        <span>{formatShortDate(points[0]?.key)}</span>
        <span>today</span>
      </div>
    </section>
  );
}

function formatShortDate(key: string | undefined): string {
  if (!key) return "";
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ── Risk ledger ─────────────────────────────────────────────── */

const RISK_BUCKETS: { level: RiskLevel; label: string }[] = [
  { level: "critical", label: "Critical" },
  { level: "high", label: "High" },
  { level: "medium", label: "Medium" },
  { level: "low", label: "Low" },
];

export function RiskLedger({ diffs }: { diffs: DiffDocument[] }) {
  const [, setLocation] = useLocation();
  const now = Date.now();
  const counts = useMemo(() => {
    const out: Record<RiskLevel, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };
    for (const d of diffs) {
      const t = new Date(d.computed_at).getTime();
      if (now - t > 30 * DAY_MS) continue;
      const level = (d.analysis?.risk_level as RiskLevel | undefined) ?? "low";
      out[level] = (out[level] ?? 0) + 1;
    }
    return out;
  }, [diffs, now]);

  return (
    <section>
      <div className="flex items-center gap-2 mb-2 px-1">
        <AlertTriangle className="h-3 w-3 text-muted-foreground" />
        <h3 className="text-[10.5px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
          Risk ledger · last 30 days
        </h3>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {RISK_BUCKETS.map(b => {
          const tone = riskTone(b.level);
          const count = counts[b.level];
          return (
            <button
              key={b.level}
              type="button"
              onClick={() => setLocation(`/dashboard/diffs?risk=${b.level}`)}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 hover:border-primary/40 hover:bg-accent/20 transition-colors text-left"
            >
              <span
                className={cn("h-1.5 w-1.5 rounded-full shrink-0", tone.dot)}
              />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  {b.label}
                </div>
                <div className="text-[22px] font-semibold tracking-tight leading-none mt-0.5">
                  {count}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ── Concept watchlist ──────────────────────────────────────── */

type ConceptBucket = {
  concept: Concept;
  diffs: DiffDocument[];
  companyIds: Set<string>;
};

export function ConceptWatchlist({
  diffs,
  companies,
}: {
  diffs: DiffDocument[];
  companies: Company[];
}) {
  const [, setLocation] = useLocation();
  const [expanded, setExpanded] = useState<string | null>(null);
  const companyById = useMemo(
    () => new Map(companies.map(c => [c.id, c])),
    [companies],
  );

  const buckets = useMemo<ConceptBucket[]>(() => {
    const now = Date.now();
    const cutoff = now - 30 * DAY_MS;
    const byConcept = new Map<string, ConceptBucket>();
    for (const c of CONCEPTS) {
      byConcept.set(c.id, { concept: c, diffs: [], companyIds: new Set() });
    }
    for (const d of diffs) {
      if (new Date(d.computed_at).getTime() < cutoff) continue;
      const matched = conceptsForDiff(d);
      for (const c of matched) {
        const b = byConcept.get(c.id);
        if (!b) continue;
        b.diffs.push(d);
        b.companyIds.add(d.author_id);
      }
    }
    return Array.from(byConcept.values())
      .filter(b => b.diffs.length > 0)
      .sort((a, b) => b.diffs.length - a.diffs.length);
  }, [diffs]);

  return (
    <section>
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <Shapes className="h-3 w-3 text-primary" />
          <h3 className="text-[10.5px] font-mono uppercase tracking-[0.16em] text-primary">
            Concept watchlist · last 30 days
          </h3>
        </div>
        <span className="text-[10.5px] font-mono text-muted-foreground">
          grouped by what changed, not by who
        </span>
      </div>

      {buckets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 flex items-start gap-3">
          <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
          <div>
            <p className="text-[13px] font-medium">No concept movement yet.</p>
            <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
              We group recent diffs by the topic they touched (training
              opt-out, retention, subprocessors, EU compliance…). Nothing
              in the last 30 days matched a tracked concept — check back
              after the next scrape.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
          {buckets.map(b => (
            <ConceptRow
              key={b.concept.id}
              bucket={b}
              open={expanded === b.concept.id}
              onToggle={() =>
                setExpanded(prev =>
                  prev === b.concept.id ? null : b.concept.id,
                )
              }
              onAsk={() =>
                setLocation(
                  `/dashboard/chat?q=${encodeURIComponent(b.concept.question)}`,
                )
              }
              companyById={companyById}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ConceptRow({
  bucket,
  open,
  onToggle,
  onAsk,
  companyById,
}: {
  bucket: ConceptBucket;
  open: boolean;
  onToggle: () => void;
  onAsk: () => void;
  companyById: Map<string, Company>;
}) {
  const companies = Array.from(bucket.companyIds)
    .map(id => companyById.get(id)?.name ?? "Unknown")
    .slice(0, 6);
  const rest = bucket.companyIds.size - companies.length;
  const Icon = ChevronRight;

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/30 transition-colors"
      >
        <Icon
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform",
            open && "rotate-90 text-primary",
          )}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[10.5px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
              {bucket.concept.label}
            </span>
            <span className="text-[11px] font-mono text-primary">
              {bucket.diffs.length}{" "}
              {bucket.diffs.length === 1 ? "change" : "changes"}
            </span>
            <span className="text-[10.5px] font-mono text-muted-foreground">
              · {bucket.companyIds.size}{" "}
              {bucket.companyIds.size === 1 ? "company" : "companies"}
            </span>
          </div>
          <div className="text-[12.5px] text-foreground/80 truncate mt-0.5">
            {companies.join(" · ")}
            {rest > 0 && (
              <span className="text-muted-foreground"> +{rest} more</span>
            )}
          </div>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-3 pt-1 space-y-2 border-t border-border/50 bg-muted/10">
          <div className="flex items-center justify-between pt-2">
            <span className="text-[11px] text-muted-foreground">
              {bucket.diffs.length} diffs touched this concept.
            </span>
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                onAsk();
              }}
              className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/15 transition-colors"
            >
              Ask Plaindr
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          <ul className="space-y-1">
            {bucket.diffs.slice(0, 6).map(d => (
              <ConceptDiffItem
                key={d.id}
                diff={d}
                companyName={
                  companyById.get(d.author_id)?.name ?? "Unknown"
                }
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ConceptDiffItem({
  diff,
  companyName,
}: {
  diff: DiffDocument;
  companyName: string;
}) {
  const [, setLocation] = useLocation();
  const tone = riskTone(
    (diff.analysis?.risk_level as RiskLevel | undefined) ?? "low",
  );
  const headline =
    diff.analysis?.summary?.trim() ||
    `${diff.stats.lines_added}+/${diff.stats.lines_removed}-`;

  return (
    <li>
      <button
        type="button"
        onClick={() => setLocation(`/dashboard/diffs/${diff.id}`)}
        className="w-full flex items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-accent/40 transition-colors"
      >
        <span
          className={cn("h-1.5 w-1.5 rounded-full mt-1.5 shrink-0", tone.dot)}
        />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium truncate">{companyName}</div>
          <div className="text-[11.5px] text-muted-foreground truncate">
            {truncate(headline, 110)}
          </div>
        </div>
      </button>
    </li>
  );
}

/* ── shared tiny helpers ─────────────────────────────────────── */

export function StatTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  tone?: "warn";
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5",
        tone === "warn"
          ? "border-amber-500/30 bg-amber-500/[0.06]"
          : "border-border bg-card",
      )}
    >
      <Icon
        className={cn(
          "h-3.5 w-3.5",
          tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
        )}
      />
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            "text-[13px] font-semibold tracking-tight",
            tone === "warn" && "text-amber-700 dark:text-amber-300",
          )}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}
