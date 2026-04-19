import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, type QuerySource } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  ArrowUp,
  ExternalLink,
  Loader2,
  Sparkles,
  Square,
} from "lucide-react";
import { hostFromUrl } from "./diff-helpers";
import { AnimatePresence, motion } from "framer-motion";

type AskWidgetProps = {
  variant?: "inline" | "full";
  className?: string;
  /** Optional starter question to prefill on mount. */
  initialQuestion?: string;
};

type AskState =
  | { status: "idle" }
  | { status: "streaming"; answer: string; sources: QuerySource[] }
  | { status: "done"; answer: string; sources: QuerySource[] }
  | { status: "error"; error: string };

const SUGGESTIONS = [
  "What changed in OpenAI's data retention policy this month?",
  "Which tools explicitly allow training on customer data?",
  "Summarise Anthropic's latest usage policy in one paragraph",
  "Who recently added age-restriction requirements?",
];

export function AskWidget({
  variant = "inline",
  className,
  initialQuestion,
}: AskWidgetProps) {
  const [question, setQuestion] = useState(initialQuestion ?? "");
  const [state, setState] = useState<AskState>({ status: "idle" });
  const [slowHint, setSlowHint] = useState<null | "warming" | "thinking">(null);
  const abortRef = useRef<AbortController | null>(null);
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastQuestionRef = useRef<string>("");

  // auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [question]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const clearSlowTimer = useCallback(() => {
    if (slowTimerRef.current) {
      clearTimeout(slowTimerRef.current);
      slowTimerRef.current = null;
    }
    setSlowHint(null);
  }, []);

  const submit = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      lastQuestionRef.current = trimmed;

      setState({ status: "streaming", answer: "", sources: [] });

      // Show a helpful hint if the backend is slow to respond — Railway
      // cold starts can take 30-60s while the policy store warms up.
      clearSlowTimer();
      slowTimerRef.current = setTimeout(() => {
        setSlowHint("warming");
      }, 4000);

      await api.streamQuery(
        { question: trimmed },
        {
          signal: controller.signal,
          onSources: sources => {
            setSlowHint("thinking");
            setState(prev =>
              prev.status === "streaming"
                ? { ...prev, sources }
                : prev,
            );
          },
          onToken: text => {
            clearSlowTimer();
            setState(prev =>
              prev.status === "streaming"
                ? { ...prev, answer: prev.answer + text }
                : prev,
            );
          },
          onDone: () => {
            clearSlowTimer();
            setState(prev =>
              prev.status === "streaming"
                ? { status: "done", answer: prev.answer, sources: prev.sources }
                : prev,
            );
          },
          onError: err => {
            clearSlowTimer();
            setState({
              status: "error",
              error: err instanceof Error ? err.message : String(err),
            });
          },
        },
      );
    },
    [clearSlowTimer],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setState(prev => {
      if (prev.status === "streaming") {
        return { status: "done", answer: prev.answer, sources: prev.sources };
      }
      return prev;
    });
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit(question);
  }

  const isStreaming = state.status === "streaming";
  const hasOutput =
    (state.status === "streaming" && (state.answer || state.sources.length)) ||
    state.status === "done" ||
    state.status === "error";

  return (
    <section
      className={cn(
        "border border-border bg-card",
        variant === "full" && "h-full flex flex-col",
        className,
      )}
    >
      <form
        onSubmit={handleSubmit}
        className="px-4 pt-4 pb-3 border-b border-border"
      >
        <div className="flex items-start gap-2.5">
          <div className="mt-1 h-7 w-7 rounded-md bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shrink-0">
            <Sparkles className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <label className="sr-only" htmlFor="ask-input">
              Ask Plaindr
            </label>
            <Textarea
              id="ask-input"
              ref={textareaRef}
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(question);
                }
              }}
              placeholder="Ask anything about 465 policies across 130 AI companies…"
              rows={1}
              className={cn(
                "resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:border-0",
                "text-[14px] leading-6 px-0 min-h-0 py-1.5",
                "placeholder:text-muted-foreground/70",
              )}
            />
          </div>
          <div className="pt-0.5">
            {isStreaming ? (
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={stop}
                className="h-8 w-8"
                aria-label="Stop streaming"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                disabled={!question.trim()}
                className="h-8 w-8"
                aria-label="Ask"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {!hasOutput && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setQuestion(s);
                  submit(s);
                }}
                className="text-[11.5px] text-muted-foreground hover:text-foreground border border-border hover:border-foreground/20 bg-background hover:bg-accent/50 px-2.5 py-1 rounded-full transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </form>

      <AnimatePresence mode="wait">
        {hasOutput && (
          <motion.div
            key="output"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={cn(
              "grid",
              variant === "full"
                ? "flex-1 min-h-0 grid-cols-1 md:grid-cols-[1fr_280px]"
                : "grid-cols-1",
            )}
          >
            <div
              className={cn(
                "p-4 min-w-0",
                variant === "full" && "overflow-auto",
              )}
            >
              <AnswerBody
                state={state}
                slowHint={slowHint}
                onRetry={
                  lastQuestionRef.current
                    ? () => submit(lastQuestionRef.current)
                    : undefined
                }
              />
            </div>
            {variant === "full" && (
              <SourcesSidebar
                sources={
                  state.status === "streaming" || state.status === "done"
                    ? state.sources
                    : []
                }
                isStreaming={isStreaming}
              />
            )}
            {variant === "inline" &&
              (state.status === "streaming" || state.status === "done") &&
              state.sources.length > 0 && (
                <div className="px-4 pb-4">
                  <InlineSources sources={state.sources.slice(0, 4)} />
                </div>
              )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function AnswerBody({
  state,
  slowHint,
  onRetry,
}: {
  state: AskState;
  slowHint: null | "warming" | "thinking";
  onRetry?: () => void;
}) {
  if (state.status === "error") {
    const rateLimit = /rate limit|429|too many/i.test(state.error);
    const aborted = /abort/i.test(state.error);
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <div className="font-medium text-destructive mb-1">
          {rateLimit
            ? "Too many queries just now"
            : aborted
              ? "Request cancelled"
              : "Something went wrong"}
        </div>
        <div className="text-foreground/80 text-[13px] mb-2">
          {rateLimit
            ? "The AI service is rate-limited. Wait a few seconds and retry."
            : aborted
              ? "You stopped the response."
              : state.error}
        </div>
        {onRetry && !aborted && (
          <button
            type="button"
            onClick={onRetry}
            className="text-[12px] font-medium text-primary hover:underline"
          >
            Retry
          </button>
        )}
      </div>
    );
  }
  const answer =
    state.status === "streaming" || state.status === "done" ? state.answer : "";
  const isStreaming = state.status === "streaming";

  return (
    <div>
      {!answer && isStreaming && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>
            {slowHint === "warming"
              ? "Waking up the policy engine…"
              : slowHint === "thinking"
                ? "Reading policy documents…"
                : "Thinking…"}
          </span>
        </div>
      )}
      {answer && (
        <p className="text-[14px] leading-[1.65] text-foreground/90 whitespace-pre-wrap">
          {answer}
          {isStreaming && (
            <span
              aria-hidden
              className="inline-block w-[2px] h-[1em] align-[-0.15em] ml-0.5 bg-primary animate-pulse"
            />
          )}
        </p>
      )}
    </div>
  );
}

function InlineSources({ sources }: { sources: QuerySource[] }) {
  return (
    <div className="border-t border-border pt-3">
      <div className="text-[10px] uppercase tracking-[0.14em] font-mono text-muted-foreground mb-2">
        Sources
      </div>
      <ul className="space-y-1">
        {sources.map((s, i) => (
          <li key={`${s.source_url}-${i}`}>
            <a
              href={s.source_url}
              target="_blank"
              rel="noreferrer noopener"
              className="group flex items-center gap-2 text-[12px] text-muted-foreground hover:text-foreground"
            >
              <Badge
                variant="outline"
                className="h-4 px-1 text-[9px] font-mono tabular-nums"
              >
                {i + 1}
              </Badge>
              <span className="truncate">
                {s.section_heading || hostFromUrl(s.source_url)}
              </span>
              <span className="ml-auto text-[10px] opacity-60 font-mono shrink-0">
                {Math.round(s.relevance_score * 100)}%
              </span>
              <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 shrink-0" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourcesSidebar({
  sources,
  isStreaming,
}: {
  sources: QuerySource[];
  isStreaming: boolean;
}) {
  return (
    <aside className="border-l border-border bg-muted/20 flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.14em] font-mono text-muted-foreground">
          Citations
        </span>
        <span className="text-[11px] font-mono text-muted-foreground">
          {sources.length}
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {sources.length === 0 && !isStreaming && (
            <p className="text-xs text-muted-foreground px-1">
              No sources returned.
            </p>
          )}
          {sources.length === 0 && isStreaming && (
            <p className="text-xs text-muted-foreground px-1 flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Retrieving passages…
            </p>
          )}
          {sources.map((s, i) => (
            <a
              key={`${s.source_url}-${i}`}
              href={s.source_url}
              target="_blank"
              rel="noreferrer noopener"
              className="block border border-border bg-card hover:bg-accent/40 transition-colors p-3"
            >
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="h-4 px-1 text-[9px] font-mono tabular-nums"
                >
                  {i + 1}
                </Badge>
                <span className="text-[11.5px] font-medium truncate flex-1">
                  {s.section_heading || "Untitled section"}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {Math.round(s.relevance_score * 100)}%
                </span>
              </div>
              <div className="mt-1 text-[10.5px] font-mono text-muted-foreground truncate">
                {hostFromUrl(s.source_url)}
              </div>
              {s.policy_summary && (
                <p className="mt-1.5 text-[11.5px] text-muted-foreground line-clamp-2">
                  {s.policy_summary}
                </p>
              )}
              <p className="mt-2 text-[11.5px] text-foreground/80 line-clamp-3 border-l-2 border-primary/40 pl-2 italic">
                {s.text}
              </p>
            </a>
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}
