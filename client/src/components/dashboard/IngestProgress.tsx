import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { CheckCircle2, AlertCircle } from "lucide-react";
import type { IngestEvent, IngestPolicyInput } from "@/lib/api";

/* ─────────────────────────────────────────────────────────────
 * IngestProgress — the cinematic scene shown while the SSE ingest
 * stream runs. An orb holds attention while a stage caption and a
 * policy ribbon react to the streamed events. Respects
 * prefers-reduced-motion (falls back to opacity crossfades).
 * ───────────────────────────────────────────────────────────── */

type Status = "pending" | "active" | "done" | "failed";

const STAGE_CAPTIONS: Record<string, string> = {
  fetching: "Reading the page…",
  refining: "Cleaning up the legalese…",
  indexing: "Filing it into the corpus…",
  tracking: "Setting up change tracking…",
};

const STAGE_ORDER = ["fetching", "refining", "indexing", "tracking"];

export function IngestProgress({
  policies,
  events,
}: {
  policies: IngestPolicyInput[];
  events: IngestEvent[];
}) {
  const reduce = useReducedMotion();
  const [statuses, setStatuses] = useState<Status[]>(() =>
    policies.map(() => "pending"),
  );
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [caption, setCaption] = useState("Starting…");

  // Reduce the event log into per-policy status + the active index.
  useEffect(() => {
    const next: Status[] = policies.map(() => "pending");
    let active: number | null = null;
    for (const e of events) {
      if (e.type === "policy_begin") {
        next[e.index] = "active";
        active = e.index;
      } else if (e.type === "policy_done") {
        next[e.index] = e.result === "failed" ? "failed" : "done";
        if (active === e.index) active = null;
      }
    }
    setStatuses(next);
    setActiveIndex(active);
  }, [events, policies]);

  // Cinematic stage caption: cycle stage labels while a policy is active.
  useEffect(() => {
    if (activeIndex === null) {
      const last = events[events.length - 1];
      if (last?.type === "done") setCaption("All done.");
      return;
    }
    let i = 0;
    setCaption(STAGE_CAPTIONS[STAGE_ORDER[0]]);
    const id = setInterval(() => {
      i = (i + 1) % STAGE_ORDER.length;
      setCaption(STAGE_CAPTIONS[STAGE_ORDER[i]]);
    }, 1800);
    return () => clearInterval(id);
  }, [activeIndex, events]);

  const orbHue = activeIndex !== null ? 265 : 150; // violet working, green idle

  return (
    <div className="flex flex-col items-center gap-6 py-6">
      <motion.div
        aria-hidden
        className="h-20 w-20 rounded-full"
        style={{
          background: `radial-gradient(circle at 35% 30%, hsl(${orbHue} 90% 70%), hsl(${orbHue} 80% 45%))`,
          boxShadow: `0 0 48px hsl(${orbHue} 80% 60% / 0.5)`,
        }}
        animate={reduce ? {} : { scale: [1, 1.08, 1] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      />

      <AnimatePresence mode="wait">
        <motion.p
          key={caption}
          initial={{ opacity: 0, y: reduce ? 0 : 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduce ? 0 : -4 }}
          className="text-sm text-foreground/80"
        >
          {caption}
        </motion.p>
      </AnimatePresence>

      <div className="flex flex-wrap justify-center gap-2">
        {policies.map((p, i) => (
          <motion.div
            key={p.url}
            layout={!reduce}
            className={
              "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] " +
              (statuses[i] === "active"
                ? "border-primary bg-primary/10 text-foreground"
                : statuses[i] === "done"
                  ? "border-emerald-500/40 text-foreground"
                  : statuses[i] === "failed"
                    ? "border-muted text-muted-foreground opacity-60"
                    : "border-border text-muted-foreground")
            }
          >
            {statuses[i] === "done" && (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            )}
            {statuses[i] === "failed" && <AlertCircle className="h-3.5 w-3.5" />}
            <span className="truncate max-w-[160px]">{p.title}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
