import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, Info, Sparkles } from "lucide-react";
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
}: {
  text: string;
  sources: QuerySource[];
  isStreaming?: boolean;
  className?: string;
  citationCtx?: CitationContext;
}) {
  const parsed = useMemo(() => parseAnswer(text), [text]);

  return (
    <div className={cn("space-y-3", className)}>
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
      <div className="px-4 py-3 text-[13.5px] leading-[1.6]">
        <InlineMarkdown
          text={section.body}
          sources={sources}
          citationCtx={citationCtx}
        />
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
