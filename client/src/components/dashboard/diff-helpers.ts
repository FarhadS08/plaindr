/**
 * Small presentation-layer helpers shared across the dashboard.
 * Keeping these in one file means components can stay focused on markup.
 */

import { formatDistanceToNowStrict } from "date-fns";
import type { DiffAnalysis, DiffDocument } from "@/lib/api";

export type ChangeType = "added" | "removed" | "modified";
export type Severity = "info" | "warning" | "breaking";
export type RiskLevel = DiffAnalysis["risk_level"];

/**
 * Returns colour classes for a risk level. We return class strings (not
 * inline style) so Tailwind's JIT keeps everything in the build.
 */
export function riskTone(level: RiskLevel | undefined | null) {
  switch (level) {
    case "critical":
      return {
        dot: "bg-rose-500",
        badge:
          "bg-rose-500/10 text-rose-600 border-rose-500/30 dark:text-rose-400 dark:border-rose-500/40",
        ring: "ring-rose-500/20",
        label: "Critical",
      };
    case "high":
      return {
        dot: "bg-orange-500",
        badge:
          "bg-orange-500/10 text-orange-600 border-orange-500/30 dark:text-orange-400 dark:border-orange-500/40",
        ring: "ring-orange-500/20",
        label: "High",
      };
    case "medium":
      return {
        dot: "bg-amber-500",
        badge:
          "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300 dark:border-amber-500/40",
        ring: "ring-amber-500/20",
        label: "Medium",
      };
    case "low":
      return {
        dot: "bg-zinc-400",
        badge:
          "bg-zinc-500/10 text-zinc-600 border-zinc-500/30 dark:text-zinc-300 dark:border-zinc-500/40",
        ring: "ring-zinc-500/10",
        label: "Low",
      };
    default:
      return {
        dot: "bg-muted-foreground/50",
        badge: "bg-muted text-muted-foreground border-border",
        ring: "ring-border",
        label: "Pending",
      };
  }
}

export function changeTypeTone(type: ChangeType) {
  switch (type) {
    case "added":
      return {
        badge:
          "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300 dark:border-emerald-500/40",
        symbol: "+",
      };
    case "removed":
      return {
        badge:
          "bg-rose-500/10 text-rose-700 border-rose-500/30 dark:text-rose-300 dark:border-rose-500/40",
        symbol: "−",
      };
    case "modified":
      return {
        badge:
          "bg-sky-500/10 text-sky-700 border-sky-500/30 dark:text-sky-300 dark:border-sky-500/40",
        symbol: "~",
      };
  }
}

export function severityTone(sev: Severity) {
  switch (sev) {
    case "breaking":
      return "bg-rose-500/10 text-rose-700 border-rose-500/30 dark:text-rose-300";
    case "warning":
      return "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300";
    case "info":
      return "bg-sky-500/10 text-sky-700 border-sky-500/30 dark:text-sky-300";
  }
}

export function formatRelativeTime(
  iso: string | null | undefined,
  opts: { short?: boolean } = {},
): string {
  if (!iso) return "—";
  try {
    const rel = formatDistanceToNowStrict(new Date(iso), { addSuffix: false });
    if (opts.short) {
      // "5 minutes" -> "5m", "2 hours" -> "2h", "3 days" -> "3d", "1 month" -> "1mo"
      return rel
        .replace(/ seconds?/, "s")
        .replace(/ minutes?/, "m")
        .replace(/ hours?/, "h")
        .replace(/ days?/, "d")
        .replace(/ months?/, "mo")
        .replace(/ years?/, "y");
    }
    return `${rel} ago`;
  } catch {
    return "—";
  }
}

export function formatAbsoluteDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

/** Short human-friendly label for a policy type. */
export function prettyPolicyType(type: string): string {
  return type
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, l => l.toUpperCase());
}

/** Pull a domain out of a URL for display. */
export function hostFromUrl(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Summarises a diff into a short human sentence when analysis is missing. */
export function diffFallbackSummary(d: DiffDocument): string {
  const hunkLabel = d.stats.hunks === 1 ? "change" : "changes";
  return `${d.stats.lines_added} additions, ${d.stats.lines_removed} removals across ${d.stats.hunks} ${hunkLabel}.`;
}
