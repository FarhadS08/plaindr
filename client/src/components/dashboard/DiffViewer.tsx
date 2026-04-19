import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Columns2, Rows, Copy, Check } from "lucide-react";

/**
 * Renders a unified-diff (the output of `git diff` / `difflib.unified_diff`)
 * as either a single- or two-column view. We parse the format ourselves to
 * avoid pulling in a dependency and to keep full control over styling.
 */

type LineKind = "context" | "add" | "remove" | "hunk" | "meta";

type ParsedLine = {
  kind: LineKind;
  oldNum: number | null;
  newNum: number | null;
  text: string;
};

type Hunk = {
  header: string;
  oldStart: number;
  newStart: number;
  lines: ParsedLine[];
};

function parseUnifiedDiff(diffText: string): Hunk[] {
  const hunks: Hunk[] = [];
  const lines = diffText.split("\n");
  let current: Hunk | null = null;
  let oldCursor = 0;
  let newCursor = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = /@@\s*-(\d+)(?:,\d+)?\s*\+(\d+)(?:,\d+)?\s*@@/.exec(line);
      if (match) {
        oldCursor = parseInt(match[1], 10);
        newCursor = parseInt(match[2], 10);
      } else {
        oldCursor = 1;
        newCursor = 1;
      }
      current = {
        header: line,
        oldStart: oldCursor,
        newStart: newCursor,
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (
      line.startsWith("---") ||
      line.startsWith("+++") ||
      line.startsWith("diff ") ||
      line.startsWith("index ")
    ) {
      if (current) {
        current.lines.push({
          kind: "meta",
          oldNum: null,
          newNum: null,
          text: line,
        });
      }
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+")) {
      current.lines.push({
        kind: "add",
        oldNum: null,
        newNum: newCursor,
        text: line.slice(1),
      });
      newCursor++;
    } else if (line.startsWith("-")) {
      current.lines.push({
        kind: "remove",
        oldNum: oldCursor,
        newNum: null,
        text: line.slice(1),
      });
      oldCursor++;
    } else {
      const text = line.startsWith(" ") ? line.slice(1) : line;
      current.lines.push({
        kind: "context",
        oldNum: oldCursor,
        newNum: newCursor,
        text,
      });
      oldCursor++;
      newCursor++;
    }
  }

  return hunks;
}

type SplitRow =
  | { kind: "hunk"; header: string }
  | {
      kind: "pair";
      left: { num: number | null; text: string; kind: LineKind } | null;
      right: { num: number | null; text: string; kind: LineKind } | null;
    };

function hunksToSplitRows(hunks: Hunk[]): SplitRow[] {
  const rows: SplitRow[] = [];
  for (const h of hunks) {
    rows.push({ kind: "hunk", header: h.header });
    let i = 0;
    while (i < h.lines.length) {
      const line = h.lines[i];
      if (line.kind === "context") {
        rows.push({
          kind: "pair",
          left: { num: line.oldNum, text: line.text, kind: "context" },
          right: { num: line.newNum, text: line.text, kind: "context" },
        });
        i++;
        continue;
      }
      if (line.kind === "remove") {
        const removes: ParsedLine[] = [];
        while (i < h.lines.length && h.lines[i].kind === "remove") {
          removes.push(h.lines[i]);
          i++;
        }
        const adds: ParsedLine[] = [];
        while (i < h.lines.length && h.lines[i].kind === "add") {
          adds.push(h.lines[i]);
          i++;
        }
        const pairCount = Math.max(removes.length, adds.length);
        for (let p = 0; p < pairCount; p++) {
          const r = removes[p];
          const a = adds[p];
          rows.push({
            kind: "pair",
            left: r ? { num: r.oldNum, text: r.text, kind: "remove" } : null,
            right: a ? { num: a.newNum, text: a.text, kind: "add" } : null,
          });
        }
        continue;
      }
      if (line.kind === "add") {
        const adds: ParsedLine[] = [];
        while (i < h.lines.length && h.lines[i].kind === "add") {
          adds.push(h.lines[i]);
          i++;
        }
        for (const a of adds) {
          rows.push({
            kind: "pair",
            left: null,
            right: { num: a.newNum, text: a.text, kind: "add" },
          });
        }
        continue;
      }
      i++;
    }
  }
  return rows;
}

const rowBg = {
  add: "bg-emerald-500/[0.08] dark:bg-emerald-400/[0.07]",
  remove: "bg-rose-500/[0.08] dark:bg-rose-400/[0.07]",
  context: "",
  hunk: "bg-sky-500/[0.06] dark:bg-sky-400/[0.08]",
  meta: "bg-muted/40",
} as const;

const gutterBg = {
  add: "bg-emerald-500/[0.14] dark:bg-emerald-400/[0.12]",
  remove: "bg-rose-500/[0.14] dark:bg-rose-400/[0.12]",
  context: "bg-muted/30",
  hunk: "bg-sky-500/[0.12] dark:bg-sky-400/[0.14]",
  meta: "bg-muted/50",
} as const;

const gutterText = {
  add: "text-emerald-700 dark:text-emerald-300",
  remove: "text-rose-700 dark:text-rose-300",
  context: "text-muted-foreground/60",
  hunk: "text-sky-700 dark:text-sky-300",
  meta: "text-muted-foreground/60",
} as const;

const gutterSymbol = {
  add: "+",
  remove: "\u2212",
  context: " ",
  hunk: "@",
  meta: " ",
} as const;

type DiffViewerProps = {
  diffText: string;
  initialView?: "unified" | "split";
  className?: string;
};

export function DiffViewer({ diffText, initialView = "unified", className }: DiffViewerProps) {
  const [view, setView] = useState<"unified" | "split">(initialView);
  const [copied, setCopied] = useState(false);

  const hunks = useMemo(() => parseUnifiedDiff(diffText), [diffText]);
  const isEmpty = hunks.length === 0;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(diffText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <div
      className={cn(
        "border border-border bg-card overflow-hidden",
        className,
      )}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-mono">
          <span>Unified diff</span>
          <span className="opacity-40">·</span>
          <span>{hunks.length} hunk{hunks.length === 1 ? "" : "s"}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="flex items-center rounded-md border border-border p-0.5 bg-background">
            <button
              onClick={() => setView("unified")}
              className={cn(
                "flex items-center gap-1 text-[11px] px-2 py-1 rounded-[5px] transition-colors",
                view === "unified"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={view === "unified"}
            >
              <Rows className="h-3 w-3" />
              Unified
            </button>
            <button
              onClick={() => setView("split")}
              className={cn(
                "flex items-center gap-1 text-[11px] px-2 py-1 rounded-[5px] transition-colors",
                view === "split"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={view === "split"}
            >
              <Columns2 className="h-3 w-3" />
              Split
            </button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" /> Copy
              </>
            )}
          </Button>
        </div>
      </div>

      {isEmpty ? (
        <div className="px-6 py-12 text-center text-sm text-muted-foreground">
          No diff content available for this change.
        </div>
      ) : (
        <div className="overflow-x-auto">
          {view === "unified" ? (
            <UnifiedView hunks={hunks} />
          ) : (
            <SplitView hunks={hunks} />
          )}
        </div>
      )}
    </div>
  );
}

function UnifiedView({ hunks }: { hunks: Hunk[] }) {
  return (
    <table className="w-full font-mono text-[12.5px] leading-[1.55] border-collapse">
      <tbody>
        {hunks.map((h, hi) => (
          <HunkRows key={hi} hunk={h} />
        ))}
      </tbody>
    </table>
  );
}

function HunkRows({ hunk }: { hunk: Hunk }) {
  return (
    <>
      <tr className={rowBg.hunk}>
        <td
          colSpan={3}
          className="px-3 py-1 text-[11px] font-mono text-sky-700 dark:text-sky-300 select-none"
        >
          {hunk.header}
        </td>
      </tr>
      {hunk.lines.map((line, i) => (
        <tr key={i} className={cn(rowBg[line.kind], "group")}>
          <td
            className={cn(
              "px-2 py-0.5 text-right select-none w-[52px] min-w-[52px] tabular-nums border-r border-border/40 text-[11px]",
              gutterBg.context,
              gutterText.context,
            )}
          >
            {line.oldNum ?? ""}
          </td>
          <td
            className={cn(
              "px-2 py-0.5 text-right select-none w-[52px] min-w-[52px] tabular-nums border-r border-border/40 text-[11px]",
              gutterBg.context,
              gutterText.context,
            )}
          >
            {line.newNum ?? ""}
          </td>
          <td className="px-0 py-0 align-top">
            <div className="flex items-start">
              <span
                className={cn(
                  "w-6 shrink-0 text-center py-0.5 select-none",
                  gutterBg[line.kind],
                  gutterText[line.kind],
                )}
              >
                {gutterSymbol[line.kind]}
              </span>
              <span className="px-3 py-0.5 whitespace-pre-wrap break-all flex-1">
                {line.text || "\u00A0"}
              </span>
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

function SplitView({ hunks }: { hunks: Hunk[] }) {
  const rows = useMemo(() => hunksToSplitRows(hunks), [hunks]);
  return (
    <table className="w-full font-mono text-[12.5px] leading-[1.55] border-collapse table-fixed">
      <colgroup>
        <col style={{ width: "44px" }} />
        <col />
        <col style={{ width: "44px" }} />
        <col />
      </colgroup>
      <tbody>
        {rows.map((row, ri) => {
          if (row.kind === "hunk") {
            return (
              <tr key={ri} className={rowBg.hunk}>
                <td
                  colSpan={4}
                  className="px-3 py-1 text-[11px] font-mono text-sky-700 dark:text-sky-300 select-none"
                >
                  {row.header}
                </td>
              </tr>
            );
          }
          const { left, right } = row;
          return (
            <tr key={ri}>
              <SplitCell side={left} />
              <SplitCell side={right} />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SplitCell({
  side,
}: {
  side: { num: number | null; text: string; kind: LineKind } | null;
}) {
  if (!side) {
    return (
      <>
        <td className="bg-muted/20 border-r border-border/40" />
        <td className="bg-muted/10" />
      </>
    );
  }
  return (
    <>
      <td
        className={cn(
          "px-2 py-0.5 text-right select-none tabular-nums border-r border-border/40 text-[11px] align-top",
          gutterBg[side.kind],
          gutterText[side.kind],
        )}
      >
        {side.num ?? ""}
      </td>
      <td className={cn("align-top", rowBg[side.kind])}>
        <div className="flex items-start">
          <span
            className={cn(
              "w-5 shrink-0 text-center py-0.5 select-none text-[11px]",
              gutterText[side.kind],
            )}
          >
            {gutterSymbol[side.kind]}
          </span>
          <span className="px-2 py-0.5 whitespace-pre-wrap break-all flex-1">
            {side.text || "\u00A0"}
          </span>
        </div>
      </td>
    </>
  );
}
