import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronRight,
  ExternalLink,
  FileText,
  Info,
  Quote,
  Sparkles,
} from "lucide-react";
import type { QuerySource } from "@/lib/api";
import { hostFromUrl } from "./diff-helpers";
import { cn } from "@/lib/utils";

/**
 * Structured answer card.
 *
 * Takes the RAG markdown response and renders it as a scannable
 * card-based layout instead of a wall of text:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ [spark] Summary                              │
 *   │ The one-sentence takeaway (intro prose).     │
 *   └──────────────────────────────────────────────┘
 *   ┌──────────────────────────────────────────────┐
 *   │ Section title                            [1] │
 *   │ ─ point a                                    │
 *   │ ─ point b                                    │
 *   └──────────────────────────────────────────────┘
 *   ┌──────────────────────────────────────────────┐
 *   │ Cited sources                                │
 *   │ [1] host.com • ChatGPT — Privacy Policy      │
 *   │ [2] host.com • ChatGPT — Data Processing     │
 *   └──────────────────────────────────────────────┘
 */
export function AnswerCard({
  text,
  sources,
  isStreaming,
  className,
}: {
  text: string;
  sources: QuerySource[];
  isStreaming?: boolean;
  className?: string;
}) {
  const parsed = useMemo(() => parseAnswer(text), [text]);

  return (
    <div className={cn("space-y-3", className)}>
      {parsed.summary && (
        <SummaryCard
          text={parsed.summary}
          sources={sources}
          isStreaming={isStreaming && parsed.sections.length === 0}
        />
      )}

      {parsed.sections.map((section, i) => (
        <SectionCard
          key={`${section.title}-${i}`}
          section={section}
          sources={sources}
        />
      ))}

      {isStreaming && parsed.sections.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground pl-4">
          <span className="h-1 w-1 rounded-full bg-primary animate-pulse" />
          <span>generating…</span>
        </div>
      )}

      {parsed.outro && (
        <div className="px-4 py-3 text-[13px] text-muted-foreground italic leading-relaxed border-l-2 border-primary/30">
          <InlineMarkdown text={parsed.outro} sources={sources} />
        </div>
      )}

      {sources.length > 0 && <SourcesCard sources={sources} />}
    </div>
  );
}

/* ──────────────── parsing ──────────────── */

type AnswerSection = {
  title: string;
  body: string;
};

type ParsedAnswer = {
  summary: string | null;
  sections: AnswerSection[];
  outro: string | null;
};

function parseAnswer(text: string): ParsedAnswer {
  const trimmed = text.trim();
  if (!trimmed) return { summary: null, sections: [], outro: null };

  const lines = trimmed.split("\n");
  const sections: AnswerSection[] = [];
  let summary = "";
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
      summary += line + "\n";
    } else {
      currentBody.push(line);
    }
  }
  pushSection();

  if (sections.length === 0) {
    return { summary: summary.trim() || null, sections: [], outro: null };
  }

  const last = sections[sections.length - 1];
  const isOutro =
    /\b(overall|in summary|in conclusion|all policies|takeaway)/i.test(
      last.body,
    ) && last.body.length < 400;
  let outro: string | null = null;
  if (isOutro) {
    outro = last.body;
    sections.pop();
  }

  return {
    summary: summary.trim() || null,
    sections,
    outro,
  };
}

/* ──────────────── cards ──────────────── */

function SummaryCard({
  text,
  sources,
  isStreaming,
}: {
  text: string;
  sources: QuerySource[];
  isStreaming?: boolean;
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
        <InlineMarkdown text={text} sources={sources} />
      </div>
    </div>
  );
}

function SectionCard({
  section,
  sources,
}: {
  section: AnswerSection;
  sources: QuerySource[];
}) {
  const refs = extractCitationIndices(section.body);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border/60 bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-6 w-6 rounded-md bg-background border border-border grid place-items-center flex-shrink-0">
            <FileText className="h-3 w-3 text-muted-foreground" />
          </div>
          <h3 className="text-[13px] font-semibold tracking-tight truncate">
            {section.title}
          </h3>
        </div>
        {refs.length > 0 && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {refs.slice(0, 4).map(n => (
              <CitationPill key={n} index={n} sources={sources} compact />
            ))}
          </div>
        )}
      </div>
      <div className="px-4 py-3 text-[13.5px] leading-[1.6]">
        <InlineMarkdown text={section.body} sources={sources} />
      </div>
    </div>
  );
}

function SourcesCard({ sources }: { sources: QuerySource[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? sources : sources.slice(0, 4);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border/60 bg-muted/30">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-background border border-border grid place-items-center">
            <Quote className="h-3 w-3 text-muted-foreground" />
          </div>
          <h3 className="text-[13px] font-semibold tracking-tight">
            Cited sources
          </h3>
          <span className="text-[11px] font-mono text-muted-foreground">
            {sources.length}
          </span>
        </div>
        {sources.length > 4 && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
          >
            {expanded ? "Show less" : `Show all ${sources.length}`}
            <ChevronRight
              className={cn(
                "h-3 w-3 transition-transform",
                expanded && "rotate-90",
              )}
            />
          </button>
        )}
      </div>
      <ul className="divide-y divide-border/60">
        {visible.map((s, i) => (
          <SourceRow key={`${s.source_url}-${i}`} index={i + 1} source={s} />
        ))}
      </ul>
    </div>
  );
}

function SourceRow({
  index,
  source,
}: {
  index: number;
  source: QuerySource;
}) {
  return (
    <li>
      <a
        href={source.source_url}
        target="_blank"
        rel="noreferrer noopener"
        className="group flex items-start gap-3 px-4 py-2.5 hover:bg-accent/30 transition-colors"
      >
        <span className="flex-shrink-0 mt-0.5 h-5 w-5 rounded-full border border-border bg-background grid place-items-center text-[10px] font-mono font-semibold text-muted-foreground group-hover:text-foreground group-hover:border-primary/40">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[12px]">
            <span className="font-medium text-foreground truncate">
              {source.company_name || hostFromUrl(source.source_url)}
            </span>
            {source.company_name && (
              <span className="text-muted-foreground">·</span>
            )}
            {source.company_name && (
              <span className="text-muted-foreground font-mono truncate">
                {hostFromUrl(source.source_url)}
              </span>
            )}
          </div>
          {source.section_heading && (
            <div className="text-[11.5px] text-muted-foreground truncate mt-0.5">
              {source.section_heading}
            </div>
          )}
        </div>
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0 mt-1 group-hover:text-foreground" />
      </a>
    </li>
  );
}

/* ──────────────── inline helpers ──────────────── */

function InlineMarkdown({
  text,
  sources,
}: {
  text: string;
  sources: QuerySource[];
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p className="text-[13.5px] leading-[1.6] text-foreground/90 my-1.5 first:mt-0">
            {withCitationChips(children, sources)}
          </p>
        ),
        li: ({ children }) => (
          <li className="pl-4 relative text-[13.5px] leading-[1.6] text-foreground/90 my-0.5 before:content-[''] before:absolute before:left-1 before:top-[0.65em] before:w-1 before:h-1 before:rounded-full before:bg-primary/50">
            {withCitationChips(children, sources)}
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
}: {
  index: number;
  sources: QuerySource[];
  compact?: boolean;
}) {
  const src = sources[index - 1];
  if (!src) {
    return (
      <span className="inline-flex items-center text-[10.5px] font-mono text-muted-foreground px-1">
        [{index}]
      </span>
    );
  }
  return (
    <a
      href={src.source_url}
      target="_blank"
      rel="noreferrer noopener"
      title={`${src.company_name || ""} — ${hostFromUrl(src.source_url)}`}
      className={cn(
        "inline-flex items-center gap-0.5 rounded border border-border bg-background hover:bg-accent hover:border-primary/40 text-[10.5px] font-mono font-semibold transition-colors align-baseline no-underline",
        compact
          ? "h-4 w-4 justify-center text-muted-foreground hover:text-foreground"
          : "px-1.5 py-0 text-primary hover:text-primary mx-0.5",
      )}
    >
      {compact ? index : `[${index}]`}
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
