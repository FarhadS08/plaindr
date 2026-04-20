import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Compass,
  Columns2,
  Calendar,
  ShieldCheck,
  ChevronDown,
  Check,
} from "lucide-react";
import { api, type Company, type DiffDocument } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatRelativeTime, riskTone } from "./diff-helpers";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

/* ─────────────────────────────────────────────────────────────
 * Empty-prompts area — the "what can I ask?" surface shown when
 * no conversation is active.
 *
 * Two stacked sections:
 *   1. PulseStrip — 3 most-recent policy diffs, one-click prompts
 *      ("What changed in X's terms 2 days ago?"). Pulls live data
 *      so the page never feels static.
 *   2. ArchetypeCards — four question shapes (Investigate / Compare
 *      / Track / Verify) with fill-in chips backed by the real
 *      company registry. Teaches the product's question vocabulary
 *      without requiring the user to know it.
 * ───────────────────────────────────────────────────────────── */

type Props = {
  onPick: (prompt: string) => void;
};

export function EmptyPromptsArea({ onPick }: Props) {
  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      <PulseStrip onPick={onPick} />
      <ArchetypeCards onPick={onPick} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * Pulse strip: live recent diffs as tappable prompts
 * ───────────────────────────────────────────────────────────── */

function PulseStrip({ onPick }: Props) {
  const { data: diffs } = useQuery({
    queryKey: ["empty-pulse-diffs"],
    queryFn: () => api.recentDiffs(3),
    staleTime: 60_000,
  });
  const { data: companies } = useQuery({
    queryKey: ["empty-pulse-companies"],
    queryFn: api.listCompanies,
    staleTime: 5 * 60_000,
  });

  const items = useMemo(() => {
    if (!diffs) return [];
    return diffs.slice(0, 3).map(d => ({
      diff: d,
      company:
        companies?.find(c => c.id === d.author_id) ?? null,
    }));
  }, [diffs, companies]);

  if (!items.length) return null;

  return (
    <section>
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground mb-2 px-1">
        <Activity className="h-3 w-3" />
        Pulse — what's moving this week
      </div>
      <div className="rounded-lg border border-border bg-background/60 divide-y divide-border overflow-hidden">
        {items.map(({ diff, company }) => (
          <PulseRow
            key={diff.id}
            diff={diff}
            companyName={company?.name ?? "Unknown"}
            onPick={onPick}
          />
        ))}
      </div>
    </section>
  );
}

function PulseRow({
  diff,
  companyName,
  onPick,
}: {
  diff: DiffDocument;
  companyName: string;
  onPick: (prompt: string) => void;
}) {
  const risk = diff.analysis?.risk_level ?? "low";
  const tone = riskTone(risk);
  const headline = diff.analysis?.summary
    ? truncate(diff.analysis.summary, 90)
    : `${diff.stats.lines_added} additions, ${diff.stats.lines_removed} removals`;
  const prompt = `What exactly changed in ${companyName}'s policy on ${formatDate(diff.computed_at)}? Summarize the diff.`;

  return (
    <button
      type="button"
      onClick={() => onPick(prompt)}
      className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-accent/40 transition-colors group"
    >
      <span className={cn("h-1.5 w-1.5 rounded-full mt-1.5 shrink-0", tone.dot)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[12.5px] font-medium truncate">
            {companyName}
          </span>
          <span className="text-[10.5px] font-mono text-muted-foreground shrink-0">
            {formatRelativeTime(diff.computed_at, { short: true })}
          </span>
        </div>
        <p className="text-[12px] text-muted-foreground truncate group-hover:text-foreground transition-colors">
          {headline}
        </p>
      </div>
      <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0 self-center opacity-0 group-hover:opacity-100 transition-opacity">
        Ask →
      </span>
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────
 * Archetype cards: typed question shapes with fill-in chips
 * ───────────────────────────────────────────────────────────── */

type Archetype = {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  // Template with {slot} placeholders; slots resolved from state.
  buildPrompt: (slots: Record<string, string>) => string;
  // Ordered list of chip slots with default values.
  slots: { key: string; defaultValue: string; kind: "company" | "topic" }[];
  // Render the card body with interleaved text + chips.
  renderBody: (chip: (key: string) => React.ReactNode) => React.ReactNode;
};

// Curated topic list for Compare's "topic" chip — keeps comparisons on
// concrete policy dimensions rather than open-ended axes.
const COMPARE_TOPICS = [
  "training-data opt-outs",
  "data retention periods",
  "EU / GDPR compliance",
  "enterprise data handling",
  "third-party sharing",
  "breach notification",
];

const ARCHETYPES: Archetype[] = [
  {
    id: "investigate",
    icon: Compass,
    label: "Investigate",
    buildPrompt: s =>
      `What data does ${s.company} keep about me after I delete my conversations?`,
    slots: [{ key: "company", defaultValue: "ChatGPT", kind: "company" }],
    renderBody: chip => (
      <>What data does {chip("company")} keep about me after I delete my conversations?</>
    ),
  },
  {
    id: "compare",
    icon: Columns2,
    label: "Compare",
    buildPrompt: s => `Compare ${s.a} and ${s.b} on ${s.topic}.`,
    slots: [
      { key: "a", defaultValue: "Claude", kind: "company" },
      { key: "b", defaultValue: "ChatGPT", kind: "company" },
      { key: "topic", defaultValue: "training-data opt-outs", kind: "topic" },
    ],
    renderBody: chip => (
      <>Compare {chip("a")} and {chip("b")} on {chip("topic")}.</>
    ),
  },
  {
    id: "track",
    icon: Calendar,
    label: "Track",
    buildPrompt: s => `What changed in ${s.company}'s terms in the last 30 days?`,
    slots: [{ key: "company", defaultValue: "OpenAI", kind: "company" }],
    renderBody: chip => (
      <>What changed in {chip("company")}'s terms in the last 30 days?</>
    ),
  },
  {
    id: "verify",
    icon: ShieldCheck,
    label: "Verify",
    buildPrompt: s => `Is ${s.company} ${s.topic}?`,
    slots: [
      { key: "company", defaultValue: "Cursor", kind: "company" },
      { key: "topic", defaultValue: "GDPR compliant", kind: "topic" },
    ],
    renderBody: chip => (
      <>Is {chip("company")} {chip("topic")}?</>
    ),
  },
];

const VERIFY_TOPICS = [
  "GDPR compliant",
  "SOC 2 certified",
  "HIPAA compliant",
  "available in the EU",
  "offering EU data residency",
];

function ArchetypeCards({ onPick }: Props) {
  return (
    <section>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {ARCHETYPES.map(a => (
          <ArchetypeCard key={a.id} archetype={a} onPick={onPick} />
        ))}
      </div>
    </section>
  );
}

function ArchetypeCard({
  archetype,
  onPick,
}: {
  archetype: Archetype;
  onPick: (prompt: string) => void;
}) {
  const [slots, setSlots] = useState<Record<string, string>>(() =>
    Object.fromEntries(archetype.slots.map(s => [s.key, s.defaultValue])),
  );

  const chip = (key: string) => {
    const slot = archetype.slots.find(s => s.key === key);
    if (!slot) return null;
    const value = slots[key] ?? slot.defaultValue;
    return (
      <SlotChip
        kind={slot.kind}
        value={value}
        onChange={next =>
          setSlots(prev => ({ ...prev, [key]: next }))
        }
        topicsForSlot={
          slot.kind === "topic"
            ? (archetype.id === "verify" ? VERIFY_TOPICS : COMPARE_TOPICS)
            : []
        }
      />
    );
  };

  const Icon = archetype.icon;

  return (
    <div className="relative flex flex-col gap-2 rounded border border-border bg-background p-3 hover:border-primary/40 hover:bg-accent/20 transition-colors">
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
        <Icon className="h-3 w-3" />
        {archetype.label}
      </div>
      <div className="text-[12.5px] leading-[1.55] text-foreground/90">
        {archetype.renderBody(chip)}
      </div>
      <button
        type="button"
        onClick={() => onPick(archetype.buildPrompt(slots))}
        aria-label={`Ask: ${archetype.buildPrompt(slots)}`}
        className="absolute inset-0 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      />
      {/* Chips sit above the full-card button so they remain clickable. */}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * Slot chip — a small inline popover picker for company / topic
 * ───────────────────────────────────────────────────────────── */

function SlotChip({
  kind,
  value,
  onChange,
  topicsForSlot,
}: {
  kind: "company" | "topic";
  value: string;
  onChange: (next: string) => void;
  topicsForSlot: string[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={e => e.stopPropagation()}
          className="relative z-10 inline-flex items-center gap-0.5 rounded border border-dashed border-primary/40 bg-primary/5 text-primary px-1.5 py-0 mx-0.5 text-[12.5px] font-medium hover:bg-primary/10 hover:border-primary/60 transition-colors align-baseline"
        >
          {value}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 p-0"
        onClick={e => e.stopPropagation()}
      >
        {kind === "company" ? (
          <CompanyList
            selected={value}
            onSelect={v => {
              onChange(v);
              setOpen(false);
            }}
          />
        ) : (
          <TopicList
            topics={topicsForSlot}
            selected={value}
            onSelect={v => {
              onChange(v);
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function CompanyList({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (name: string) => void;
}) {
  const [q, setQ] = useState("");
  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["archetype-companies"],
    queryFn: api.listCompanies,
    staleTime: 5 * 60_000,
  });
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const source = [...companies].sort((a, b) => a.name.localeCompare(b.name));
    if (!term) return source.slice(0, 40);
    return source
      .filter(c => c.name.toLowerCase().includes(term))
      .slice(0, 40);
  }, [companies, q]);

  return (
    <div className="flex flex-col">
      <input
        autoFocus
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Search companies…"
        className="h-9 border-b border-border bg-transparent px-3 text-[12.5px] outline-none placeholder:text-muted-foreground"
      />
      <ScrollArea className="h-56">
        <div className="py-1">
          {filtered.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c.name)}
              className="w-full flex items-center justify-between px-3 py-1.5 text-left text-[12.5px] hover:bg-accent"
            >
              <span className="truncate">{c.name}</span>
              {c.name === selected && (
                <Check className="h-3.5 w-3.5 text-primary shrink-0" />
              )}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-4 text-[11.5px] text-muted-foreground text-center">
              No matches
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function TopicList({
  topics,
  selected,
  onSelect,
}: {
  topics: string[];
  selected: string;
  onSelect: (topic: string) => void;
}) {
  return (
    <div className="py-1">
      {topics.map(t => (
        <button
          key={t}
          type="button"
          onClick={() => onSelect(t)}
          className="w-full flex items-center justify-between px-3 py-1.5 text-left text-[12.5px] hover:bg-accent"
        >
          <span className="truncate">{t}</span>
          {t === selected && (
            <Check className="h-3.5 w-3.5 text-primary shrink-0" />
          )}
        </button>
      ))}
    </div>
  );
}

/* ─── helpers ─── */

function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
