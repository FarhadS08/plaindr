import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { DiffAnalysis, DiffDocument } from "@/lib/api";
import {
  changeTypeTone,
  riskTone,
  severityTone,
  diffFallbackSummary,
} from "./diff-helpers";
import { AlertTriangle, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type AnalysisPanelProps = {
  diff: DiffDocument;
  className?: string;
};

export function AnalysisPanel({ diff, className }: AnalysisPanelProps) {
  const { analysis, analysis_status } = diff;

  return (
    <aside
      className={cn(
        "border border-border bg-card flex flex-col h-full",
        className,
      )}
    >
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] uppercase tracking-[0.14em] font-mono text-muted-foreground">
            AI analysis
          </span>
        </div>
        <RiskPill level={analysis?.risk_level} />
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-5">
          {analysis_status === "pending" && !analysis && <PendingState />}
          {analysis_status === "failed" && !analysis && <FailedState />}

          {analysis && (
            <>
              <Section label="Summary">
                <p className="text-[13px] leading-relaxed text-foreground/90">
                  {analysis.summary}
                </p>
              </Section>

              <Separator />

              <Section
                label={`Key changes · ${analysis.key_changes.length}`}
              >
                <ul className="space-y-2.5">
                  {analysis.key_changes.map((kc, i) => (
                    <KeyChangeItem key={i} change={kc} />
                  ))}
                  {analysis.key_changes.length === 0 && (
                    <li className="text-xs text-muted-foreground">
                      No discrete changes flagged by the analyzer.
                    </li>
                  )}
                </ul>
              </Section>

              <Separator />

              <Section label="Consequences">
                <p className="text-[13px] leading-relaxed text-foreground/85">
                  {analysis.consequences}
                </p>
              </Section>
            </>
          )}

          {!analysis && analysis_status === "completed" && (
            <p className="text-sm text-muted-foreground">
              {diffFallbackSummary(diff)}
            </p>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-[10px] uppercase tracking-[0.14em] font-mono text-muted-foreground mb-2">
        {label}
      </h3>
      {children}
    </section>
  );
}

function RiskPill({ level }: { level: DiffAnalysis["risk_level"] | undefined }) {
  const tone = riskTone(level);
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] uppercase tracking-[0.12em] font-mono h-5 px-1.5 gap-1",
        tone.badge,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
      {tone.label} risk
    </Badge>
  );
}

function KeyChangeItem({
  change,
}: {
  change: DiffAnalysis["key_changes"][number];
}) {
  const tone = changeTypeTone(change.change_type);
  return (
    <li className="group">
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 h-5 w-5 rounded-[4px] border flex items-center justify-center text-[11px] font-mono shrink-0",
            tone.badge,
          )}
          aria-label={change.change_type}
        >
          {tone.symbol}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12.5px] font-medium truncate">
              {change.section}
            </span>
            <Badge
              variant="outline"
              className={cn(
                "text-[9px] uppercase tracking-[0.12em] font-mono h-4 px-1",
                severityTone(change.severity),
              )}
            >
              {change.severity}
            </Badge>
          </div>
          <p className="text-[12.5px] text-muted-foreground leading-relaxed mt-1">
            {change.description}
          </p>
        </div>
      </div>
    </li>
  );
}

function PendingState() {
  return (
    <div className="flex flex-col items-center text-center py-8 gap-3">
      <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
      <div>
        <p className="text-sm font-medium">Analysis in progress</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-[36ch]">
          We're reading this diff and distilling the important changes.
          Refresh in a moment.
        </p>
      </div>
    </div>
  );
}

function FailedState() {
  return (
    <div className="flex flex-col items-center text-center py-8 gap-3">
      <AlertTriangle className="h-5 w-5 text-amber-500" />
      <div>
        <p className="text-sm font-medium">Analysis unavailable</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-[36ch]">
          The raw diff is still shown below. Our analyzer will retry this
          document on the next run.
        </p>
      </div>
      <ShieldCheck className="h-4 w-4 text-muted-foreground/40" />
    </div>
  );
}
