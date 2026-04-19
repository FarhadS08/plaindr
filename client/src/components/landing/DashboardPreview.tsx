import { motion } from "framer-motion";
import {
  Activity,
  Bell,
  Search,
  Shield,
  FileText,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";

export function DashboardPreview() {
  return (
    <div className="relative rounded-[20px] border border-border/70 bg-card/70 backdrop-blur-2xl overflow-hidden shadow-2xl shadow-violet-500/10">
      {/* Window chrome */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60 bg-muted/40">
        <div className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-400/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/70" />
        </div>
        <div className="flex-1 flex justify-center">
          <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-background/60 border border-border/50 text-[11px] font-mono text-muted-foreground">
            <span className="text-violet-500">plaindr.com</span>
            <span className="text-muted-foreground/50">/dashboard</span>
          </div>
        </div>
        <div className="w-12" />
      </div>

      {/* Dashboard layout */}
      <div className="grid grid-cols-[180px_1fr] min-h-[420px]">
        {/* Sidebar */}
        <aside className="border-r border-border/60 bg-muted/20 py-4 px-2.5 space-y-0.5">
          <SideItem icon={Activity} label="Overview" active />
          <SideItem icon={FileText} label="Policies" count={465} />
          <SideItem icon={Bell} label="Changes" count={12} accent />
          <SideItem icon={Shield} label="Companies" count={130} />
          <div className="pt-3 mt-3 border-t border-border/50">
            <p className="px-2.5 text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1.5">
              Watchlist
            </p>
            {["OpenAI", "Anthropic", "Google"].map((c) => (
              <div
                key={c}
                className="flex items-center gap-2 px-2.5 py-1 text-[12px] text-foreground/70 hover:text-foreground cursor-default"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {c}
              </div>
            ))}
          </div>
        </aside>

        {/* Main */}
        <main className="p-5 space-y-4">
          {/* Search bar */}
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg bg-background/60 border border-border/60">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[13px] text-muted-foreground">
              Ask anything. Try:{" "}
              <span className="text-foreground/80">
                "compare data retention across top 10 LLMs"
              </span>
            </span>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="Tools tracked" value="130" delta="+4" up />
            <StatTile label="Policy changes" value="12" delta="+3" up accent />
            <StatTile label="Your queries" value="287" delta="−8" />
          </div>

          {/* Activity feed */}
          <div className="rounded-lg border border-border/60 bg-background/40 overflow-hidden">
            <div className="px-3.5 py-2 border-b border-border/50 flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Recent changes
              </p>
              <span className="text-[10px] text-muted-foreground/70">Live</span>
            </div>
            <div className="divide-y divide-border/50">
              <FeedRow
                company="OpenAI"
                doc="Privacy Policy"
                change="Retention extended 30 → 90 days"
                time="2h ago"
                severity="high"
              />
              <FeedRow
                company="Anthropic"
                doc="Usage Policies"
                change="Added clause on agentic use cases"
                time="5h ago"
                severity="med"
              />
              <FeedRow
                company="Google"
                doc="Gemini Terms"
                change="Clarified training data scope"
                time="1d ago"
                severity="low"
              />
            </div>
          </div>
        </main>
      </div>

      {/* Ambient glow */}
      <div className="pointer-events-none absolute -inset-20 -z-10 bg-gradient-to-tr from-violet-500/20 via-transparent to-fuchsia-500/20 blur-3xl" />
    </div>
  );
}

function SideItem({
  icon: Icon,
  label,
  count,
  active,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count?: number;
  active?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className={[
        "flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-[12.5px]",
        active
          ? "bg-violet-500/15 text-violet-700 dark:text-violet-200 font-medium"
          : "text-foreground/75",
      ].join(" ")}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      {typeof count === "number" && (
        <span
          className={[
            "text-[10px] px-1.5 py-0.5 rounded-full tabular-nums",
            accent
              ? "bg-rose-500/15 text-rose-600 dark:text-rose-300"
              : "bg-muted text-muted-foreground",
          ].join(" ")}
        >
          {count}
        </span>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  delta,
  up,
  accent,
}: {
  label: string;
  value: string;
  delta: string;
  up?: boolean;
  accent?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className={[
        "rounded-lg border border-border/60 p-3",
        accent
          ? "bg-gradient-to-br from-violet-500/10 via-transparent to-fuchsia-500/10"
          : "bg-background/40",
      ].join(" ")}
    >
      <p className="text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground mb-1.5">
        {label}
      </p>
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        <span
          className={[
            "inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums",
            up
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-rose-600 dark:text-rose-400",
          ].join(" ")}
        >
          {up ? (
            <ArrowUpRight className="w-3 h-3" />
          ) : (
            <ArrowDownRight className="w-3 h-3" />
          )}
          {delta}
        </span>
      </div>
    </motion.div>
  );
}

function FeedRow({
  company,
  doc,
  change,
  time,
  severity,
}: {
  company: string;
  doc: string;
  change: string;
  time: string;
  severity: "high" | "med" | "low";
}) {
  const sev = {
    high: "bg-rose-500",
    med: "bg-amber-500",
    low: "bg-emerald-500",
  }[severity];
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5 text-[12.5px]">
      <span className={`w-1.5 h-1.5 rounded-full ${sev}`} />
      <span className="font-medium text-foreground/90 min-w-[72px]">
        {company}
      </span>
      <span className="text-muted-foreground min-w-[110px] truncate">
        {doc}
      </span>
      <span className="flex-1 truncate text-foreground/80">{change}</span>
      <span className="text-muted-foreground text-[11px] tabular-nums">
        {time}
      </span>
    </div>
  );
}
