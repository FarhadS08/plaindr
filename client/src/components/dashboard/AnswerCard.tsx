import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowRight,
  Columns2,
  FileText,
  Info,
  Sparkles,
  Table2,
  Zap,
} from "lucide-react";
import type { QuerySource } from "@/lib/api";
import { hostFromUrl } from "./diff-helpers";
import { cn } from "@/lib/utils";

/**
 * Context passed down to citation pills so they can talk to the
 * sources panel sitting in the right rail of the workspace.
 */
export type CitationContext = {
  /** Fires when the user clicks a [N] pill in the rendered answer. */
  onCitationClick?: (index: number) => void;
  /** Fires on hover/focus enter/exit — the panel highlights source N. */
  onCitationHover?: (index: number | null) => void;
};

/**
 * Structured answer card.
 *
 * Takes the RAG markdown response and renders it as a scannable
 * card-based layout. Sources are no longer rendered inline — they live
 * in the workspace's right rail. The inline [N] citation pills talk
 * back to that panel via the optional `citationCtx` prop.
 */
export function AnswerCard({
  text,
  sources,
  isStreaming,
  className,
  citationCtx,
  onFollowUpPick,
}: {
  text: string;
  sources: QuerySource[];
  isStreaming?: boolean;
  className?: string;
  citationCtx?: CitationContext;
  /**
   * Fires when the user clicks a suggested follow-up question in a
   * refusal-style answer ("Try instead"). Threaded from the workspace
   * so the click turns into a new query.
   */
  onFollowUpPick?: (prompt: string) => void;
}) {
  const parsed = useMemo(() => parseAnswer(text), [text]);

  // Refusal handoff: the LLM returned only a "Try instead" section.
  // Render as an educational card with clickable follow-up questions
  // instead of the usual summary + sections card stack.
  if (parsed.tryInstead && !parsed.summary && parsed.sections.length === 0) {
    return (
      <TryInsteadCard
        intro={parsed.tryInstead.intro}
        prompts={parsed.tryInstead.prompts}
        onFollowUpPick={onFollowUpPick}
      />
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {parsed.tldr.length > 0 && <TldrStrip bullets={parsed.tldr} />}

      {parsed.factGrid && (
        <FactGridCard
          grid={parsed.factGrid}
          sources={sources}
          citationCtx={citationCtx}
        />
      )}

      {parsed.summary && (
        <SummaryCard
          text={parsed.summary}
          sources={sources}
          citationCtx={citationCtx}
          isStreaming={isStreaming && parsed.sections.length === 0}
        />
      )}

      {parsed.sections.map((section, i) => (
        <SectionCard
          key={`${section.title}-${i}`}
          section={section}
          sources={sources}
          citationCtx={citationCtx}
        />
      ))}

      {parsed.tryInstead && (
        <TryInsteadCard
          intro={parsed.tryInstead.intro}
          prompts={parsed.tryInstead.prompts}
          onFollowUpPick={onFollowUpPick}
        />
      )}

      {isStreaming && parsed.sections.length > 0 && (
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.08em] text-muted-foreground pl-1">
          <span className="h-1 w-1 rounded-full bg-primary animate-pulse" />
          <span>generating</span>
        </div>
      )}

      {parsed.outro && (
        <div className="px-4 py-3 text-[13px] text-muted-foreground italic leading-relaxed border-l-2 border-primary/30">
          <InlineMarkdown
            text={parsed.outro}
            sources={sources}
            citationCtx={citationCtx}
          />
        </div>
      )}
    </div>
  );
}

/* ──────────────── parsing ──────────────── */

type AnswerSection = {
  title: string;
  body: string;
};

type TryInstead = {
  intro: string;
  prompts: string[];
};

type FactGrid = {
  /** Company names from the header row (one column per company). */
  columns: string[];
  /** One row per dimension. Cell count matches `columns.length`. */
  rows: { dimension: string; cells: string[] }[];
};

type ParsedAnswer = {
  /** Bullets extracted from the `## TL;DR` section, if any. */
  tldr: string[];
  /** The signature "At a glance" matrix — null if the LLM skipped it. */
  factGrid: FactGrid | null;
  /** Prose summary from the `## Summary` section (or preamble). */
  summary: string | null;
  /** Substantive topic sections (excludes TL;DR, Summary, Try instead, Facts). */
  sections: AnswerSection[];
  /** Present when the LLM gave a subjective-refusal handoff. */
  tryInstead: TryInstead | null;
  outro: string | null;
};

function parseAnswer(text: string): ParsedAnswer {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      tldr: [],
      factGrid: null,
      summary: null,
      sections: [],
      tryInstead: null,
      outro: null,
    };
  }

  const lines = trimmed.split("\n");
  const sections: AnswerSection[] = [];
  let preamble = "";
  let currentTitle: string | null = null;
  let currentBody: string[] = [];

  const pushSection = () => {
    if (currentTitle !== null && currentBody.length > 0) {
      sections.push({
        title: currentTitle,
        body: currentBody.join("\n").trim(),
      });
    }
    currentTitle = null;
    currentBody = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{2,3})\s+(.*)$/);
    if (headingMatch) {
      pushSection();
      currentTitle = headingMatch[2].trim();
      continue;
    }
    if (currentTitle === null) {
      preamble += line + "\n";
    } else {
      currentBody.push(line);
    }
  }
  pushSection();

  // Pull out reserved sections (TL;DR, At a glance, Summary, Try
  // instead) before handing the remainder to the UI as topic cards.
  let tldr: string[] = [];
  let factGrid: FactGrid | null = null;
  let summary: string | null = preamble.trim() || null;
  let tryInstead: TryInstead | null = null;

  const topicSections: AnswerSection[] = [];
  for (const section of sections) {
    const lower = section.title.toLowerCase();
    if (/^tl[;:]?dr$/.test(lower) || lower === "tl dr") {
      tldr = extractBullets(section.body);
      continue;
    }
    if (/^at\s+a\s+glance$/.test(lower) || lower === "facts") {
      factGrid = parseFactGridTable(section.body);
      continue;
    }
    if (lower === "summary") {
      summary = section.body;
      continue;
    }
    if (/try\s+instead/.test(lower) || /try\s+one\s+of/.test(lower)) {
      tryInstead = parseTryInstead(section.body);
      continue;
    }
    topicSections.push(section);
  }

  // Legacy outro detection — some answers still emit an "Overall…" tail
  // as the last topic section. Keep this behavior so older streams
  // still render cleanly.
  let outro: string | null = null;
  if (topicSections.length > 0) {
    const last = topicSections[topicSections.length - 1];
    const isOutro =
      /\b(overall|in summary|in conclusion|all policies|takeaway)/i.test(
        last.body,
      ) && last.body.length < 400;
    if (isOutro) {
      outro = last.body;
      topicSections.pop();
    }
  }

  return {
    tldr,
    factGrid,
    summary,
    sections: topicSections,
    tryInstead,
    outro,
  };
}

/**
 * Parse a GFM markdown table out of an `## At a glance` section body.
 *
 * Returns null when:
 *  - No table is present.
 *  - The header/rows are malformed.
 *  - Fewer than 2 usable data rows (a half-empty grid is uglier than
 *    no grid — the prompt is supposed to catch this upstream, but we
 *    defend here too).
 */
function parseFactGridTable(body: string): FactGrid | null {
  const lines = body.split("\n").map(l => l.trim()).filter(Boolean);
  const tableLines = lines.filter(l => l.startsWith("|"));
  if (tableLines.length < 3) return null;

  const splitRow = (line: string): string[] =>
    line
      .split("|")
      .slice(1, -1) // strip leading/trailing empty cells from outer pipes
      .map(c => c.trim());

  const headerCells = splitRow(tableLines[0]);
  if (headerCells.length < 2) return null;

  // Second line should be the `---` separator. Skip it regardless of
  // whether it matches exactly — some LLMs vary on hyphen count.
  const dataLines = /^\|\s*:?-+:?\s*\|/.test(tableLines[1])
    ? tableLines.slice(2)
    : tableLines.slice(1);

  const rows: FactGrid["rows"] = [];
  for (const raw of dataLines) {
    const cells = splitRow(raw);
    if (cells.length !== headerCells.length) continue;
    const [dimension, ...rest] = cells;
    if (!dimension) continue;
    rows.push({ dimension, cells: rest });
  }
  if (rows.length < 2) return null;

  // First header cell is the "Dimension" label, which we render as
  // decoration — drop it so columns lines up with row.cells.
  return { columns: headerCells.slice(1), rows };
}

/** Stance derived from the verdict word leading a fact cell. */
type Stance = "positive" | "partial" | "negative" | "silent";

// Multi-word patterns come before single-word ones — more specific beats
// less specific. The single-word groups are alternations for brevity.
const STANCE_PATTERNS: Array<[RegExp, Stance]> = [
  [/^upon\s+request\b/i, "partial"],
  [/^default\s+off\b/i, "partial"],
  [/^opt-?in\s+required\b/i, "partial"],
  [/^case[- ]by[- ]case\b/i, "partial"],
  [/^enterprise\s+only\b/i, "partial"],
  [/^not\s+offered\b/i, "negative"],
  [/^does\s+not\b/i, "negative"],
  [/^default\s+on\b/i, "negative"],
  [/^not\s+specified\b/i, "silent"],
  [/^(yes|offers|provides|complies|supports|available|required|guaranteed|published)\b/i, "positive"],
  [/^(partial|limited|conditional)\b/i, "partial"],
  [/^(no|prohibited|unavailable|restricted)\b/i, "negative"],
];

function detectStance(cellText: string): Stance {
  const text = cellText.trim();
  if (!text) return "silent";
  for (const [re, stance] of STANCE_PATTERNS) {
    if (re.test(text)) return stance;
  }
  return "silent";
}

/** Extract bullet lines from a markdown block, stripping the marker. */
function extractBullets(body: string): string[] {
  return body
    .split("\n")
    .map(l => l.trim())
    .filter(l => /^[-*]\s+/.test(l))
    .map(l => l.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
}

function parseTryInstead(body: string): TryInstead {
  const prompts = extractBullets(body);
  const introLines = body
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !/^[-*]\s+/.test(l));
  const intro = introLines.join(" ").replace(/^>\s*/, "").trim();
  return {
    intro: intro || "Here are factual questions I can answer instead:",
    prompts,
  };
}

/**
 * Split a section body into company-led paragraphs if the LLM structured
 * the section that way. Returns null when the shape doesn't apply —
 * callers fall back to the regular single-column prose renderer.
 *
 * A comparison section is one where 2+ paragraphs each START with a
 * bold name (e.g. `**Anthropic** retains…`, `**OpenAI** offers…`).
 */
type CompanyParagraph = { company: string; body: string };

function splitCompanyParagraphs(body: string): CompanyParagraph[] | null {
  const blocks = body
    .split(/\n\s*\n/)
    .map(b => b.trim())
    .filter(Boolean);
  const leads: CompanyParagraph[] = [];
  for (const block of blocks) {
    // Accept only **Name** at the very start, followed by any character
    // (space, comma, verb). Company names rarely contain asterisks.
    const m = block.match(/^\*\*([^*\n]+)\*\*\s*[:,\-]?\s*([\s\S]+)$/);
    if (!m) return null;
    leads.push({ company: m[1].trim(), body: m[2].trim() });
  }
  if (leads.length < 2) return null;
  const distinct = new Set(leads.map(l => l.company.toLowerCase())).size;
  if (distinct < 2) return null;
  return leads;
}

/* ──────────────── cards ──────────────── */

function SummaryCard({
  text,
  sources,
  isStreaming,
  citationCtx,
}: {
  text: string;
  sources: QuerySource[];
  isStreaming?: boolean;
  citationCtx?: CitationContext;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-primary/20 bg-gradient-to-br from-primary/[0.07] via-primary/[0.03] to-transparent p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-6 w-6 rounded-md bg-primary/15 grid place-items-center">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
        </div>
        <span className="text-[11px] font-mono uppercase tracking-[0.1em] text-primary/80">
          Summary
        </span>
        {isStreaming && (
          <span className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
            <span className="h-1 w-1 rounded-full bg-primary animate-pulse" />
            live
          </span>
        )}
      </div>
      <div className="text-[14px] leading-[1.6] text-foreground/90">
        <InlineMarkdown text={text} sources={sources} citationCtx={citationCtx} />
      </div>
    </div>
  );
}

function SectionCard({
  section,
  sources,
  citationCtx,
}: {
  section: AnswerSection;
  sources: QuerySource[];
  citationCtx?: CitationContext;
}) {
  const refs = extractCitationIndices(section.body);
  const split = splitCompanyParagraphs(section.body);
  const isComparison = split !== null;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border/60 bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-6 w-6 rounded-md bg-background border border-border grid place-items-center flex-shrink-0">
            {isComparison ? (
              <Columns2 className="h-3 w-3 text-primary" />
            ) : (
              <FileText className="h-3 w-3 text-muted-foreground" />
            )}
          </div>
          <h3 className="text-[13px] font-semibold tracking-tight truncate">
            {section.title}
          </h3>
        </div>
        {refs.length > 0 && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {refs.slice(0, 4).map(n => (
              <CitationPill
                key={n}
                index={n}
                sources={sources}
                compact
                citationCtx={citationCtx}
              />
            ))}
          </div>
        )}
      </div>
      {isComparison ? (
        <ComparisonBody
          paragraphs={split}
          sources={sources}
          citationCtx={citationCtx}
        />
      ) : (
        <div className="px-4 py-3 text-[13.5px] leading-[1.6]">
          <InlineMarkdown
            text={section.body}
            sources={sources}
            citationCtx={citationCtx}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Split-column body for sections where each paragraph leads with a
 * bold company name. Groups same-company paragraphs into one column.
 * Falls back to a 2-column grid for the two most-cited companies; any
 * additional companies stack beneath. Stackable on narrow viewports.
 */
function ComparisonBody({
  paragraphs,
  sources,
  citationCtx,
}: {
  paragraphs: CompanyParagraph[];
  sources: QuerySource[];
  citationCtx?: CitationContext;
}) {
  const byCompany = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of paragraphs) {
      const arr = map.get(p.company) ?? [];
      arr.push(p.body);
      map.set(p.company, arr);
    }
    return Array.from(map.entries()).map(([company, bodies]) => ({
      company,
      body: bodies.join("\n\n"),
    }));
  }, [paragraphs]);

  return (
    <div
      className={cn(
        "grid divide-y md:divide-y-0 md:divide-x divide-border",
        byCompany.length === 2 ? "md:grid-cols-2" : "md:grid-cols-1",
      )}
    >
      {byCompany.map(({ company, body }) => (
        <div key={company} className="px-4 py-3">
          <div className="inline-flex items-center gap-1.5 mb-2 rounded border border-primary/25 bg-primary/[0.06] px-1.5 py-0.5 text-[10.5px] font-mono uppercase tracking-wider text-primary">
            {company}
          </div>
          <div className="text-[13px] leading-[1.6]">
            <InlineMarkdown
              text={body}
              sources={sources}
              citationCtx={citationCtx}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ──────────────── Fact Grid — the signature element ──────────────── */

/**
 * Fact Grid: the dense policy matrix shown at the top of comparison
 * and single-company answers. Each row is a canonical dimension; each
 * column is a company. Cells lead with a verdict word that drives the
 * stance dot (●/◐/○/—), then the fact, then inline [N] citations.
 *
 * Typography is intentionally mono + compact — this is the "data"
 * layer of the answer. The prose below is the "narrative" layer.
 */
function FactGridCard({
  grid,
  sources,
  citationCtx,
}: {
  grid: FactGrid;
  sources: QuerySource[];
  citationCtx?: CitationContext;
}) {
  const colCount = grid.columns.length;
  const isSingle = colCount === 1;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border/60 bg-muted/30">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-background border border-border grid place-items-center">
            <Table2 className="h-3 w-3 text-primary" />
          </div>
          <h3 className="text-[10.5px] font-mono uppercase tracking-[0.16em] text-primary">
            At a glance
          </h3>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">
          {grid.rows.length} {grid.rows.length === 1 ? "fact" : "facts"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-border/60">
              <th
                className="px-4 py-2 text-left font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground font-normal"
                style={{ width: isSingle ? "45%" : "26%" }}
              >
                Dimension
              </th>
              {grid.columns.map(col => (
                <th key={col} className="px-4 py-2 text-left">
                  <span className="inline-flex items-center rounded border border-primary/25 bg-primary/[0.06] px-1.5 py-0.5 text-[10.5px] font-mono uppercase tracking-wider text-primary">
                    {col}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row, i) => (
              <FactRow
                key={`${row.dimension}-${i}`}
                row={row}
                sources={sources}
                citationCtx={citationCtx}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FactRow({
  row,
  sources,
  citationCtx,
}: {
  row: FactGrid["rows"][number];
  sources: QuerySource[];
  citationCtx?: CitationContext;
}) {
  // Hover the row → highlight the first source cited in ANY cell so
  // the cockpit scrolls to it. Matches the inline citation-pill UX.
  const firstCitedIndex = useMemo(() => {
    for (const cell of row.cells) {
      const m = cell.match(/\[Source (\d+)\]/);
      if (m) return parseInt(m[1], 10);
    }
    return null;
  }, [row.cells]);

  return (
    <tr
      className="group border-b border-border/40 last:border-b-0 hover:bg-primary/[0.03] transition-colors"
      onMouseEnter={() =>
        firstCitedIndex !== null && citationCtx?.onCitationHover?.(firstCitedIndex)
      }
      onMouseLeave={() => citationCtx?.onCitationHover?.(null)}
    >
      <td className="px-4 py-2.5 align-top font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground group-hover:text-foreground/80 transition-colors">
        {row.dimension}
      </td>
      {row.cells.map((cell, i) => (
        <td key={i} className="px-4 py-2.5 align-top">
          <FactCell text={cell} sources={sources} citationCtx={citationCtx} />
        </td>
      ))}
    </tr>
  );
}

function FactCell({
  text,
  sources,
  citationCtx,
}: {
  text: string;
  sources: QuerySource[];
  citationCtx?: CitationContext;
}) {
  const stance = detectStance(text);
  return (
    <div className="flex items-start gap-2">
      <StanceDot stance={stance} />
      <span className="leading-snug text-foreground/90">
        {withCitationChips(text, sources, citationCtx)}
      </span>
    </div>
  );
}

// Visuals chosen so silent/absence is clearly the "low-information" case
// (small, muted em-dash), and the three present-values form a ring cycle —
// filled / half-filled / open (well, all filled here, but partial uses a
// gradient so only 50% of the dot reads as "on").
const DOT_STYLES: Record<
  Exclude<Stance, "silent">,
  { label: string; fill: string; border: string }
> = {
  positive: {
    label: "Yes",
    fill: "bg-emerald-500",
    border: "border-emerald-500",
  },
  partial: {
    label: "Partial",
    // Half-fill via a hard-stop gradient — amber on the left half, the
    // border alone on the right half. Border stays amber for continuity.
    fill: "bg-gradient-to-r from-amber-400 from-50% to-transparent to-50%",
    border: "border-amber-400",
  },
  negative: {
    label: "No",
    fill: "bg-rose-500",
    border: "border-rose-500",
  },
};

function StanceDot({ stance }: { stance: Stance }) {
  if (stance === "silent") {
    return (
      <span
        aria-label="Not specified"
        className="mt-1.5 inline-block h-2 w-2 text-center leading-none text-muted-foreground/70"
      >
        —
      </span>
    );
  }
  const { label, fill, border } = DOT_STYLES[stance];
  return (
    <span
      aria-label={label}
      className={cn(
        "mt-[5px] inline-block h-2 w-2 rounded-full border shrink-0",
        fill,
        border,
      )}
    />
  );
}

function TldrStrip({ bullets }: { bullets: string[] }) {
  return (
    <div className="rounded-lg border border-primary/25 bg-primary/[0.04] p-3">
      <div className="flex items-center gap-1.5 mb-2 text-[10px] font-mono uppercase tracking-[0.14em] text-primary/80">
        <Zap className="h-3 w-3" /> TL;DR
      </div>
      <ul className="space-y-1">
        {bullets.map((b, i) => (
          <li
            key={i}
            className="relative pl-4 text-[13px] leading-[1.55] text-foreground/90 before:content-[''] before:absolute before:left-1 before:top-[0.65em] before:w-1 before:h-1 before:rounded-full before:bg-primary"
          >
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TryInsteadCard({
  intro,
  prompts,
  onFollowUpPick,
}: {
  intro: string;
  prompts: string[];
  onFollowUpPick?: (prompt: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60 bg-muted/30">
        <div className="h-6 w-6 rounded-md bg-background border border-border grid place-items-center">
          <Info className="h-3 w-3 text-muted-foreground" />
        </div>
        <h3 className="text-[13px] font-semibold tracking-tight">
          Try a factual question instead
        </h3>
      </div>
      <div className="px-4 py-3 space-y-3">
        <p className="text-[13px] text-muted-foreground leading-relaxed">
          {intro}
        </p>
        <ul className="space-y-1.5">
          {prompts.map((p, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => onFollowUpPick?.(p)}
                disabled={!onFollowUpPick}
                className={cn(
                  "w-full flex items-center justify-between gap-3 rounded border border-border bg-background px-3 py-2 text-left text-[13px] leading-snug transition-colors",
                  "hover:border-primary/40 hover:bg-accent/40 disabled:opacity-70 disabled:pointer-events-none",
                )}
              >
                <span className="truncate">{p}</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ──────────────── inline helpers ──────────────── */

function InlineMarkdown({
  text,
  sources,
  citationCtx,
}: {
  text: string;
  sources: QuerySource[];
  citationCtx?: CitationContext;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p className="text-[13.5px] leading-[1.6] text-foreground/90 my-1.5 first:mt-0">
            {withCitationChips(children, sources, citationCtx)}
          </p>
        ),
        li: ({ children }) => (
          <li className="pl-4 relative text-[13.5px] leading-[1.6] text-foreground/90 my-0.5 before:content-[''] before:absolute before:left-1 before:top-[0.65em] before:w-1 before:h-1 before:rounded-full before:bg-primary/50">
            {withCitationChips(children, sources, citationCtx)}
          </li>
        ),
        ul: ({ children }) => (
          <ul className="my-1.5 space-y-0.5">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="my-1.5 space-y-0.5 list-decimal pl-5">{children}</ol>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-foreground">
            {children}
          </strong>
        ),
        em: ({ children }) => (
          <em className="italic text-foreground/95">{children}</em>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary hover:underline"
          >
            {children}
          </a>
        ),
        h4: ({ children }) => (
          <h4 className="text-[12.5px] font-semibold uppercase tracking-wide text-muted-foreground mt-3 mb-1">
            {children}
          </h4>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

/**
 * Replace `[Source N]` text inside rendered nodes with pill chips.
 */
function withCitationChips(
  children: React.ReactNode,
  sources: QuerySource[],
  citationCtx?: CitationContext,
): React.ReactNode {
  const replaceInString = (str: string, keyPrefix: string) => {
    const parts: React.ReactNode[] = [];
    const matches = Array.from(str.matchAll(/\[Source (\d+)\]/g));
    let last = 0;
    matches.forEach((m, i) => {
      const mi = m.index ?? 0;
      if (mi > last) parts.push(str.slice(last, mi));
      parts.push(
        <CitationPill
          key={`${keyPrefix}-${i}`}
          index={parseInt(m[1], 10)}
          sources={sources}
          citationCtx={citationCtx}
        />,
      );
      last = mi + m[0].length;
    });
    if (last < str.length) parts.push(str.slice(last));
    return parts.length > 0 ? parts : str;
  };

  if (typeof children === "string") {
    return replaceInString(children, "t");
  }
  if (Array.isArray(children)) {
    return children.map((c, i) => {
      if (typeof c === "string") {
        return <span key={`s-${i}`}>{replaceInString(c, `s-${i}`)}</span>;
      }
      return c;
    });
  }
  return children;
}

function CitationPill({
  index,
  sources,
  compact,
  citationCtx,
}: {
  index: number;
  sources: QuerySource[];
  compact?: boolean;
  citationCtx?: CitationContext;
}) {
  const src = sources[index - 1];
  if (!src) {
    return (
      <span className="inline-flex items-center text-[10.5px] font-mono text-muted-foreground px-1">
        [{index}]
      </span>
    );
  }

  const baseCls = cn(
    "inline-flex items-center gap-0.5 rounded border border-border bg-background hover:bg-primary/10 hover:border-primary/50 text-[10.5px] font-mono font-semibold transition-colors align-baseline no-underline cursor-pointer select-none",
    compact
      ? "h-4 w-4 justify-center text-muted-foreground hover:text-primary"
      : "px-1.5 py-0 text-primary hover:text-primary mx-0.5",
  );
  const title = `${src.company_name || ""} — ${hostFromUrl(src.source_url)}`;
  const label = compact ? index : `[${index}]`;

  // When we're inside the workspace, clicking scrolls the right-rail
  // source into view instead of opening a tab (user can still click the
  // tile on the right to open the URL).
  if (citationCtx) {
    return (
      <button
        type="button"
        title={title}
        onClick={() => citationCtx.onCitationClick?.(index)}
        onMouseEnter={() => citationCtx.onCitationHover?.(index)}
        onMouseLeave={() => citationCtx.onCitationHover?.(null)}
        onFocus={() => citationCtx.onCitationHover?.(index)}
        onBlur={() => citationCtx.onCitationHover?.(null)}
        className={baseCls}
      >
        {label}
      </button>
    );
  }

  // Fallback: no workspace context, open source URL directly.
  return (
    <a
      href={src.source_url}
      target="_blank"
      rel="noreferrer noopener"
      title={title}
      className={baseCls}
    >
      {label}
    </a>
  );
}

function extractCitationIndices(text: string): number[] {
  const set = new Set<number>();
  const matches = Array.from(text.matchAll(/\[Source (\d+)\]/g));
  for (const m of matches) {
    set.add(parseInt(m[1], 10));
  }
  return Array.from(set).sort((a, b) => a - b);
}

/** The most-recent citation index found in the text, or null. */
export function lastCitationIndex(text: string): number | null {
  const matches = Array.from(text.matchAll(/\[Source (\d+)\]/g));
  if (matches.length === 0) return null;
  return parseInt(matches[matches.length - 1][1], 10);
}

/**
 * Empty state for "no relevant policy" or error cases.
 */
export function AnswerEmpty({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 p-5 flex items-start gap-3">
      <div className="h-8 w-8 rounded-full bg-muted grid place-items-center flex-shrink-0">
        <Info className="h-4 w-4 text-muted-foreground" />
      </div>
      <div>
        <p className="text-[14px] font-medium">{title}</p>
        {detail && (
          <p className="text-[12.5px] text-muted-foreground mt-1 leading-relaxed">
            {detail}
          </p>
        )}
      </div>
    </div>
  );
}
