import { motion } from "framer-motion";
import { GitBranch, Sparkles } from "lucide-react";

type DiffLine =
  | { type: "ctx"; text: string }
  | { type: "add"; text: string }
  | { type: "del"; text: string };

interface PolicyDiffProps {
  company?: string;
  document?: string;
  date?: string;
  lines?: DiffLine[];
  aiSummary?: string;
}

const DEFAULT_LINES: DiffLine[] = [
  { type: "ctx", text: "3.2 Data Retention" },
  { type: "ctx", text: "" },
  {
    type: "del",
    text: "We retain your prompts for up to 30 days for abuse monitoring.",
  },
  {
    type: "add",
    text: "We retain your prompts for up to 90 days for abuse monitoring,",
  },
  {
    type: "add",
    text: "safety review, and service improvement purposes.",
  },
  { type: "ctx", text: "" },
  { type: "ctx", text: "3.3 Model Training" },
];

export function PolicyDiff({
  company = "OpenAI",
  document = "Privacy Policy",
  date = "Apr 11, 2026",
  lines = DEFAULT_LINES,
  aiSummary = "Retention window extended from 30 to 90 days. Two new stated purposes: safety review and service improvement. Likely affects zero-retention API commitments.",
}: PolicyDiffProps) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/60 backdrop-blur-xl shadow-[0_1px_0_0_rgba(255,255,255,0.6)_inset] dark:shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset] overflow-hidden">
      {/* File header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-muted/40">
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="font-mono text-xs text-muted-foreground truncate">
            {company.toLowerCase()}/{document.toLowerCase().replace(/\s+/g, "-")}.md
          </span>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {date}
        </span>
      </div>

      {/* Diff body */}
      <div className="font-mono text-[12.5px] leading-relaxed py-2">
        {lines.map((line, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: i * 0.04, duration: 0.3 }}
            className={[
              "grid grid-cols-[2.5rem_1fr] items-start px-0 min-h-[1.5rem]",
              line.type === "add"
                ? "bg-emerald-500/10 dark:bg-emerald-400/10"
                : line.type === "del"
                ? "bg-rose-500/10 dark:bg-rose-400/10"
                : "",
            ].join(" ")}
          >
            <span
              className={[
                "text-center select-none shrink-0 pt-0.5",
                line.type === "add"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : line.type === "del"
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-muted-foreground/50",
              ].join(" ")}
            >
              {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
            </span>
            <span
              className={[
                "pr-4 py-0.5 break-words",
                line.type === "add"
                  ? "text-emerald-900 dark:text-emerald-100"
                  : line.type === "del"
                  ? "text-rose-900 dark:text-rose-100 line-through decoration-rose-500/40"
                  : "text-foreground/80",
              ].join(" ")}
            >
              {line.text || "\u00A0"}
            </span>
          </motion.div>
        ))}
      </div>

      {/* AI summary footer */}
      <div className="border-t border-border/60 bg-gradient-to-br from-violet-500/5 via-transparent to-fuchsia-500/5 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 shrink-0 w-5 h-5 rounded-md bg-violet-500/15 text-violet-600 dark:text-violet-400 flex items-center justify-center">
            <Sparkles className="w-3 h-3" />
          </div>
          <div className="min-w-0">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-violet-600 dark:text-violet-300 mb-1">
              AI summary
            </p>
            <p className="text-[13px] leading-relaxed text-foreground/85">
              {aiSummary}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
