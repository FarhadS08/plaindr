import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUp,
  ExternalLink,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Mic,
  MicOff,
  Minimize2,
  Radio,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useVoiceAgent } from "@/hooks/useVoiceAgent";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Kbd } from "@/components/ui/kbd";
import { trpc } from "@/lib/trpc";
import { api, type QuerySource } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatRelativeTime, hostFromUrl } from "./diff-helpers";
import { AnswerCard, lastCitationIndex } from "./AnswerCard";

/* ─────────────────────────────────────────────────────────────
 * ChatWorkspace — the Plaindr cockpit.
 *
 *   ┌──────────┬────────────────────────────┬─────────────────────┐
 *   │ History  │ Conversation               │ Sources panel       │
 *   │ (240px)  │ (flex, scrollable)         │ (340px)             │
 *   └──────────┴────────────────────────────┴─────────────────────┘
 *
 * Goals:
 *   - Full-bleed height, each rail scrolls independently.
 *   - Answer citations talk to the sources rail (scroll + highlight).
 *   - Live streaming status visible at all times in the right rail.
 *   - Works as both embedded view and full-screen overlay.
 *   - Keyboard-first: ⌘K focus, ⌘Enter submit, Esc exit overlay.
 * ───────────────────────────────────────────────────────────── */

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  sources?: QuerySource[];
};

type StreamState =
  | { kind: "idle" }
  | { kind: "streaming"; text: string; sources: QuerySource[] };

const SUGGESTIONS = [
  "What data does ChatGPT keep after I delete a conversation?",
  "Compare Anthropic and OpenAI's training-data opt-outs.",
  "Which AI tools changed their privacy policy in the last 30 days?",
  "Can Midjourney use my uploads to train their models?",
];

export function ChatWorkspace() {
  const utils = trpc.useUtils();
  const conversationsQuery = trpc.conversations.list.useQuery();
  const createConversation = trpc.conversations.create.useMutation();
  const addMessage = trpc.messages.add.useMutation();
  const generateTitle = trpc.conversations.generateTitle.useMutation();
  const deleteConversation = trpc.conversations.delete.useMutation();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [stream, setStream] = useState<StreamState>({ kind: "idle" });
  const [fullscreen, setFullscreen] = useState(false);
  const [hoveredCitation, setHoveredCitation] = useState<number | null>(null);
  const [highlightedCitation, setHighlightedCitation] = useState<number | null>(
    null,
  );
  // True on first render — lets us auto-pick the newest conversation only
  // once. After the user clicks "New chat" or an item, we respect their choice.
  const hasInitiallySelectedRef = useRef(false);

  const voice = useVoiceAgent();
  const voiceActive = voice.isSessionActive;

  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const centerScrollRef = useRef<HTMLDivElement | null>(null);
  const sourceRefs = useRef<Map<number, HTMLElement>>(new Map());
  // Sources persistence: DB is the source of truth (via `messages.sources`
  // JSONB column added in migration 002). We also mirror to localStorage
  // so citations survive a refresh immediately, even before the backend
  // migration has been applied.
  const sourcesByMessageId = useRef<Map<string, QuerySource[]>>(
    loadSourcesFromStorage(),
  );
  // Sources captured during the current stream — handed to the message
  // when onDone persists it.
  const pendingSourcesRef = useRef<QuerySource[]>([]);

  // Pick newest conversation ONCE on first successful load. After that,
  // respect whatever the user chose (including null from "New chat").
  useEffect(() => {
    if (hasInitiallySelectedRef.current) return;
    if (!conversationsQuery.data) return;
    hasInitiallySelectedRef.current = true;
    if (conversationsQuery.data.length > 0 && !activeId) {
      setActiveId(conversationsQuery.data[0].id);
    }
  }, [conversationsQuery.data, activeId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const messagesQuery = trpc.conversations.get.useQuery(
    { id: activeId ?? "" },
    { enabled: !!activeId },
  );

  const isStreaming = stream.kind === "streaming";

  /* ───── citation interaction ───── */

  const flashCitation = useCallback((index: number) => {
    setHighlightedCitation(index);
    const el = sourceRefs.current.get(index);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      setHighlightedCitation(prev => (prev === index ? null : prev));
    }, 1600);
  }, []);

  const citationCtx = useMemo(
    () => ({
      onCitationClick: flashCitation,
      onCitationHover: (idx: number | null) => setHoveredCitation(idx),
    }),
    [flashCitation],
  );

  /* ───── submit ───── */

  async function submit() {
    const trimmed = question.trim();
    if (!trimmed || isStreaming) return;
    setQuestion("");

    let conversationId: string;
    let freshConversation = false;
    if (activeId) {
      conversationId = activeId;
    } else {
      const conv = await createConversation.mutateAsync({
        title: trimmed.slice(0, 60),
      });
      conversationId = conv.id;
      setActiveId(conversationId);
      freshConversation = true;
    }

    await addMessage.mutateAsync({
      conversationId,
      role: "user",
      content: trimmed,
    });
    utils.conversations.get.invalidate({ id: conversationId });

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStream({ kind: "streaming", text: "", sources: [] });

    let finalText = "";

    pendingSourcesRef.current = [];

    await api.streamQuery(
      { question: trimmed },
      {
        signal: controller.signal,
        onSources: sources => {
          pendingSourcesRef.current = sources;
          setStream(prev =>
            prev.kind === "streaming" ? { ...prev, sources } : prev,
          );
        },
        onToken: token => {
          finalText += token;
          setStream(prev =>
            prev.kind === "streaming"
              ? { ...prev, text: prev.text + token }
              : prev,
          );
        },
        onDone: async () => {
          if (!conversationId) return;
          // Don't persist empty answers — that happens when the stream
          // errored before any tokens arrived, and writing an empty row
          // would leave a ghost message in the sidebar.
          if (!finalText.trim()) {
            setStream({ kind: "idle" });
            return;
          }
          const capturedSources = pendingSourcesRef.current;
          try {
            const persisted = await addMessage.mutateAsync({
              conversationId,
              role: "assistant",
              content: finalText,
              sources: capturedSources,
            });
            // Cache in-memory + localStorage so the cockpit rail keeps
            // working while we wait for the conversations.get query to
            // revalidate, and survives a page refresh even if the DB
            // migration hasn't been applied yet.
            if (persisted && typeof persisted.id === "string") {
              sourcesByMessageId.current.set(persisted.id, capturedSources);
              saveSourcesToStorage(sourcesByMessageId.current);
            }
            await utils.conversations.get.invalidate({ id: conversationId });
            await utils.conversations.list.invalidate();
            setStream({ kind: "idle" });

            if (freshConversation) {
              try {
                await generateTitle.mutateAsync({ id: conversationId });
                await utils.conversations.list.invalidate();
              } catch {
                /* non-fatal */
              }
            }
          } catch (err) {
            // Persistence failed (bad sources payload, network, etc).
            // Keep the streamed answer visible on screen by leaving
            // `stream` in its current state and logging — losing the
            // text after the user waited is the worst outcome.
            console.error("[chat] failed to persist assistant message", err);
            setStream({ kind: "idle" });
          }
        },
        onError: err => {
          console.error("[chat] stream error", err);
          setStream({ kind: "idle" });
        },
      },
    );
  }

  function newChat() {
    abortRef.current?.abort();
    setActiveId(null);
    setStream({ kind: "idle" });
    setHighlightedCitation(null);
    setHoveredCitation(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  /* ───── keyboard shortcuts ───── */

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        textareaRef.current?.focus();
        return;
      }
      if (meta && e.key === "Enter") {
        e.preventDefault();
        submit();
        return;
      }
      if (e.key === "Escape" && fullscreen) {
        e.preventDefault();
        setFullscreen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // submit intentionally not in deps – using refs/state via closures is fine here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen, question, isStreaming, activeId]);

  /* ───── derived ───── */

  const messages: Message[] = useMemo(() => {
    const raw = (messagesQuery.data?.messages ?? []) as Message[];
    // Attach remembered sources to persisted assistant messages so the
    // cockpit rail works after the stream has ended.
    const withSources = raw.map(m =>
      m.role === "assistant" && !m.sources
        ? { ...m, sources: sourcesByMessageId.current.get(m.id) }
        : m,
    );
    if (stream.kind !== "streaming") return withSources;
    return [
      ...withSources,
      {
        id: "__streaming__",
        role: "assistant",
        content: stream.text,
        created_at: new Date().toISOString(),
        sources: stream.sources,
      },
    ];
  }, [messagesQuery.data, stream]);

  // Current answer being "read" for the sources panel. While streaming
  // that's the in-flight message; otherwise it's the last assistant
  // message with any sources.
  const focusedAnswer = useMemo(() => {
    if (stream.kind === "streaming") {
      return { text: stream.text, sources: stream.sources };
    }
    // Walk back from the end until we find an assistant message with
    // sources attached. The tRPC layer doesn't persist sources yet, so
    // in practice this will only pull from in-session state, but we
    // handle it defensively.
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.role === "assistant" && m.sources && m.sources.length > 0) {
        return { text: m.content, sources: m.sources };
      }
    }
    return { text: "", sources: [] as QuerySource[] };
  }, [stream, messages]);

  // Last source that was cited in the streaming text (for the live
  // highlight halo on the right rail).
  const lastCited = useMemo(() => {
    if (stream.kind !== "streaming") return null;
    return lastCitationIndex(stream.text);
  }, [stream]);

  // Auto-scroll the center pane as new tokens arrive.
  useEffect(() => {
    if (stream.kind !== "streaming") return;
    const el = centerScrollRef.current;
    if (!el) return;
    // Only auto-scroll when we're near the bottom so we don't steal
    // scroll from the user if they've scrolled up to re-read.
    const distanceToBottom =
      el.scrollHeight - (el.scrollTop + el.clientHeight);
    if (distanceToBottom < 120) {
      el.scrollTop = el.scrollHeight;
    }
  }, [stream]);

  /* ───── render ───── */

  const workspace = (
    <div
      className={cn(
        "grid grid-cols-[220px_minmax(0,1fr)_360px] xl:grid-cols-[240px_minmax(0,1fr)_400px] 2xl:grid-cols-[260px_minmax(0,1fr)_440px] h-full w-full bg-background overflow-hidden",
        fullscreen && "fixed inset-0 z-[60]",
      )}
    >
      {/* ──── left rail: conversations ──── */}
      <aside className="flex flex-col min-h-0 border-r border-border bg-muted/20">
        <div className="h-11 px-3 flex items-center justify-between border-b border-border">
          <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            History
          </span>
          <span className="text-[10px] font-mono text-muted-foreground/70">
            {conversationsQuery.data?.length ?? 0}
          </span>
        </div>
        <div className="p-2 border-b border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={newChat}
            className="w-full gap-2 h-8 justify-start text-[12px] font-medium"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            New chat
          </Button>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          {conversationsQuery.isLoading && (
            <div className="p-2 space-y-1.5">
              {[0, 1, 2].map(i => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}
          {conversationsQuery.data?.length === 0 && (
            <p className="px-3 py-4 text-[11px] text-muted-foreground">
              No chats yet. Ask below to start.
            </p>
          )}
          <div className="py-1">
            {conversationsQuery.data?.map(c => (
              <ConversationItem
                key={c.id}
                title={c.title}
                updatedAt={c.updated_at}
                active={c.id === activeId}
                onClick={() => {
                  setActiveId(c.id);
                  setHighlightedCitation(null);
                  setHoveredCitation(null);
                }}
                onDelete={async () => {
                  if (!window.confirm(`Delete "${c.title}"? This cannot be undone.`)) return;
                  try {
                    await deleteConversation.mutateAsync({ id: c.id });
                    if (c.id === activeId) setActiveId(null);
                    await utils.conversations.list.invalidate();
                  } catch {
                    /* non-fatal */
                  }
                }}
              />
            ))}
          </div>
        </ScrollArea>
      </aside>

      {/* ──── center pane: conversation ──── */}
      <section className="flex flex-col min-h-0 border-r border-border">
        <div className="h-11 px-4 flex items-center justify-between border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
              Session
            </span>
            <span className="text-[12px] font-medium truncate">
              {activeId
                ? conversationsQuery.data?.find(c => c.id === activeId)?.title
                : "New query"}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <div className="hidden md:flex items-center gap-1 mr-2 text-[10px] font-mono text-muted-foreground">
              <Kbd className="h-4 text-[9px]">⌘</Kbd>
              <Kbd className="h-4 text-[9px]">K</Kbd>
              <span className="ml-1">focus</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={fullscreen ? "Exit full screen" : "Full screen"}
              onClick={() => setFullscreen(v => !v)}
            >
              {fullscreen ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </Button>
            {fullscreen && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="Close"
                onClick={() => setFullscreen(false)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        <div
          ref={centerScrollRef}
          className="flex-1 min-h-0 overflow-y-auto"
        >
          <div className="max-w-3xl mx-auto w-full px-4 py-6 md:px-6 md:py-8">
            {!activeId && !isStreaming && (
              <EmptyState
                onPick={prompt => {
                  setQuestion(prompt);
                  requestAnimationFrame(() => textareaRef.current?.focus());
                }}
              />
            )}
            {activeId && messagesQuery.isLoading && (
              <div className="space-y-3">
                {[0, 1].map(i => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            )}
            <div className="space-y-5">
              <AnimatePresence initial={false}>
                {messages.map(m => (
                  <MessageRow
                    key={m.id}
                    message={m}
                    citationCtx={citationCtx}
                  />
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* voice status banner */}
        {voiceActive && (
          <div className="border-t border-primary/30 bg-primary/[0.04] px-4 py-2 md:px-6">
            <div className="max-w-3xl mx-auto flex items-center gap-2 text-[11.5px] font-mono uppercase tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-primary">
                {voice.status === "listening" && "Listening…"}
                {voice.status === "speaking" && "Agent speaking"}
                {voice.status === "connected" && "Voice ready — speak now"}
                {voice.status === "connecting" && "Connecting…"}
              </span>
              <span className="text-muted-foreground ml-auto">
                Tap the mic to end
              </span>
            </div>
          </div>
        )}

        {/* ask box */}
        <form
          className="border-t border-border bg-background"
          onSubmit={e => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="max-w-3xl mx-auto px-4 py-3 md:px-6 md:py-4">
            <div className="relative flex items-center gap-2 rounded-lg border border-border bg-muted/20 focus-within:border-primary/50 focus-within:bg-background transition-colors pr-2">
              <Textarea
                ref={textareaRef}
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder="Ask about a policy, company, or recent change…"
                className="min-h-[40px] max-h-[180px] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 text-[13.5px] py-2.5"
                rows={1}
              />
              <div className="flex items-center gap-1.5 self-center">
                <span className="hidden md:inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                  <Kbd className="h-4 text-[9px]">⌘</Kbd>
                  <Kbd className="h-4 text-[9px]">↵</Kbd>
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant={voiceActive ? "default" : "ghost"}
                  onClick={voice.toggleSession}
                  disabled={voice.status === "connecting"}
                  aria-label={voiceActive ? "End voice" : "Start voice"}
                  title={voiceActive ? "End voice session" : "Start voice session"}
                  className={cn(
                    "h-8 w-8 relative",
                    voiceActive && "animate-pulse",
                  )}
                >
                  {voice.status === "connecting" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : voiceActive ? (
                    <MicOff className="h-3.5 w-3.5" />
                  ) : (
                    <Mic className="h-3.5 w-3.5" />
                  )}
                </Button>
                {isStreaming ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    onClick={() => abortRef.current?.abort()}
                    aria-label="Stop"
                    className="h-8 w-8"
                  >
                    <Square className="h-3 w-3 fill-current" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!question.trim()}
                    aria-label="Send"
                    className="h-8 w-8"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </form>
      </section>

      {/* ──── right rail: sources cockpit ──── */}
      <SourcesRail
        sources={focusedAnswer.sources}
        isStreaming={isStreaming}
        hoveredCitation={hoveredCitation}
        highlightedCitation={highlightedCitation}
        lastCited={lastCited}
        registerRef={(idx, el) => {
          if (el) sourceRefs.current.set(idx, el);
          else sourceRefs.current.delete(idx);
        }}
        onCompanyClick={company => {
          // Scroll center to the first mention of the company.
          const root = centerScrollRef.current;
          if (!root) return;
          const target = root.querySelector(
            `[data-company="${cssEscape(company)}"]`,
          ) as HTMLElement | null;
          if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />
    </div>
  );

  return workspace;
}

/* ─────────────────────────────────────────────────────────────
 * Conversation list item
 * ───────────────────────────────────────────────────────────── */

function ConversationItem({
  title,
  updatedAt,
  active,
  onClick,
  onDelete,
}: {
  title: string;
  updatedAt: string;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "relative w-full border-l-2 transition-colors group",
        active
          ? "bg-background border-primary"
          : "border-transparent hover:bg-background/60",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left px-3 py-2 pr-8"
      >
        <div
          className={cn(
            "text-[12.5px] leading-tight break-words line-clamp-2",
            active ? "font-semibold text-foreground" : "font-medium text-foreground/90",
          )}
        >
          {title}
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <span
            className={cn(
              "h-1 w-1 rounded-full",
              active ? "bg-primary" : "bg-muted-foreground/40",
            )}
          />
          <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wide">
            {formatRelativeTime(updatedAt, { short: true })}
          </span>
        </div>
      </button>
      <button
        type="button"
        onClick={e => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label="Delete conversation"
        title="Delete conversation"
        className={cn(
          "absolute top-1.5 right-1.5 h-6 w-6 grid place-items-center rounded",
          "text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10",
          "opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity",
        )}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * Message row — user bubble vs AI AnswerCard
 * ───────────────────────────────────────────────────────────── */

function MessageRow({
  message,
  citationCtx,
}: {
  message: Message;
  citationCtx: { onCitationClick: (n: number) => void; onCitationHover: (n: number | null) => void };
}) {
  const isUser = message.role === "user";

  if (isUser) {
    // Prompt header — not a chat bubble. Looks like a log entry / section
    // divider. Left-accent bar, monospace metadata, dominant prompt text.
    return (
      <motion.div
        initial={{ opacity: 0, y: 2 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.12 }}
        className="relative pl-4 pt-2"
      >
        <span
          aria-hidden
          className="absolute left-0 top-2 bottom-1 w-[2px] bg-primary/60 rounded-full"
        />
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[9.5px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            Prompt
          </span>
          <span className="text-[9.5px] font-mono text-muted-foreground/60">
            {formatRelativeTime(message.created_at)}
          </span>
        </div>
        <div className="text-[15px] font-medium leading-[1.4] text-foreground">
          {message.content}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.14 }}
      className="pl-4 relative"
      data-company-anchors
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9.5px] font-mono uppercase tracking-[0.14em] text-primary/70">
          Answer
        </span>
        {message.id === "__streaming__" && (
          <span className="inline-flex items-center gap-1 text-[9.5px] font-mono uppercase tracking-[0.08em] text-primary">
            <span className="h-1 w-1 rounded-full bg-primary animate-pulse" />
            live
          </span>
        )}
      </div>
      {message.content ? (
        <AnswerCard
          text={message.content}
          sources={message.sources ?? []}
          isStreaming={message.id === "__streaming__"}
          citationCtx={citationCtx}
        />
      ) : (
        <div className="inline-flex items-center gap-2 text-[12px] font-mono text-muted-foreground uppercase tracking-[0.08em]">
          <Loader2 className="h-3 w-3 animate-spin" /> Thinking
        </div>
      )}
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * Right rail: sources cockpit
 * ───────────────────────────────────────────────────────────── */

function SourcesRail({
  sources,
  isStreaming,
  hoveredCitation,
  highlightedCitation,
  lastCited,
  registerRef,
  onCompanyClick,
}: {
  sources: QuerySource[];
  isStreaming: boolean;
  hoveredCitation: number | null;
  highlightedCitation: number | null;
  lastCited: number | null;
  registerRef: (idx: number, el: HTMLElement | null) => void;
  onCompanyClick: (company: string) => void;
}) {
  const companies = useMemo(() => {
    const seen = new Map<string, number>();
    sources.forEach(s => {
      const name = s.company_name || hostFromUrl(s.source_url);
      if (!name) return;
      seen.set(name, (seen.get(name) ?? 0) + 1);
    });
    return Array.from(seen.entries()).map(([name, count]) => ({ name, count }));
  }, [sources]);

  return (
    <aside className="flex flex-col min-h-0 bg-muted/10">
      {/* header */}
      <div className="h-11 px-3 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            Cockpit
          </span>
          {isStreaming ? (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.08em] text-primary">
              <Radio className="h-3 w-3 animate-pulse" />
              <span>reading</span>
              <StreamDots />
            </span>
          ) : (
            <span className="text-[10px] font-mono text-muted-foreground/70">
              {sources.length} source{sources.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-4">
          {/* scope */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[9.5px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                Scope
              </span>
              <span className="text-[9.5px] font-mono text-muted-foreground/60">
                {companies.length} cos
              </span>
            </div>
            {companies.length === 0 ? (
              <div className="text-[11px] text-muted-foreground/70">
                Waiting for the model to select relevant policies.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {companies.map(c => (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => onCompanyClick(c.name)}
                    className="inline-flex items-center gap-1 h-6 px-2 rounded border border-border bg-background hover:border-primary/50 hover:bg-primary/5 text-[10.5px] font-medium transition-colors"
                  >
                    <span className="truncate max-w-[120px]">{c.name}</span>
                    {c.count > 1 && (
                      <span className="font-mono text-muted-foreground text-[9.5px]">
                        {c.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="h-px bg-border/60" />

          {/* sources */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[9.5px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                Cited sources
              </span>
              <span className="text-[9.5px] font-mono text-muted-foreground/60">
                ({sources.length})
              </span>
            </div>
            {sources.length === 0 ? (
              <SourcesSkeleton isStreaming={isStreaming} />
            ) : (
              <div className="space-y-2">
                {sources.map((s, i) => {
                  const idx = i + 1;
                  return (
                    <SourceTile
                      key={`${s.source_url}-${idx}`}
                      index={idx}
                      source={s}
                      hovered={hoveredCitation === idx}
                      highlighted={highlightedCitation === idx}
                      lastCited={lastCited === idx}
                      registerRef={el => registerRef(idx, el)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}

function SourcesSkeleton({ isStreaming }: { isStreaming: boolean }) {
  if (!isStreaming) {
    return (
      <div className="rounded border border-dashed border-border bg-background/40 p-3 text-[11px] text-muted-foreground leading-relaxed">
        Sources will appear here as the answer references policies. Each
        citation <span className="font-mono text-foreground/80">[N]</span> in
        the answer maps to a tile on this rail.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="rounded border border-border bg-background/60 p-3 space-y-2"
        >
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-2 w-1/2" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}

function SourceTile({
  index,
  source,
  hovered,
  highlighted,
  lastCited,
  registerRef,
}: {
  index: number;
  source: QuerySource;
  hovered: boolean;
  highlighted: boolean;
  lastCited: boolean;
  registerRef: (el: HTMLElement | null) => void;
}) {
  const host = hostFromUrl(source.source_url);
  const company = source.company_name || host;
  const policyType = inferPolicyType(source);
  const excerpt = (source.text ?? "").replace(/\s+/g, " ").trim();

  return (
    <a
      ref={registerRef as (el: HTMLAnchorElement | null) => void}
      href={source.source_url}
      target="_blank"
      rel="noreferrer noopener"
      data-company={company}
      className={cn(
        "group block rounded border bg-background p-3 transition-all outline-none",
        "hover:border-primary/40 hover:bg-accent/30",
        highlighted
          ? "border-primary ring-2 ring-primary/40 bg-primary/5"
          : hovered
            ? "border-primary/60"
            : lastCited
              ? "border-primary/40 ring-1 ring-primary/15"
              : "border-border",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "flex-shrink-0 h-5 w-5 rounded grid place-items-center text-[10px] font-mono font-semibold transition-colors",
            highlighted || hovered
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground border border-border group-hover:bg-primary/10",
          )}
        >
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div
              className={cn(
                "text-[12.5px] font-semibold tracking-tight leading-tight break-words",
                hovered && "underline underline-offset-2",
              )}
            >
              {company}
            </div>
            <ExternalLink className="h-3 w-3 text-muted-foreground/50 flex-shrink-0 group-hover:text-foreground" />
          </div>
          <div className="text-[10.5px] font-mono text-muted-foreground break-all">
            {host}
          </div>
          {source.section_heading && (
            <div className="mt-0.5 text-[11.5px] text-foreground/80 break-words leading-snug">
              {source.section_heading}
            </div>
          )}
        </div>
      </div>

      {excerpt && (
        <>
          <div className="my-2.5 h-px bg-border/60" />
          <p className="text-[11.5px] leading-[1.55] text-muted-foreground break-all">
            <span className="text-foreground/60">“</span>
            {excerpt}
            <span className="text-foreground/60">”</span>
          </p>
        </>
      )}

      <div className="flex items-center gap-1.5 mt-2.5">
        {policyType && (
          <span className="inline-flex items-center h-4 px-1.5 rounded border border-border bg-muted/40 text-[9.5px] font-mono uppercase tracking-wide text-muted-foreground">
            {policyType}
          </span>
        )}
        {typeof source.relevance_score === "number" && (
          <span className="inline-flex items-center h-4 px-1.5 rounded border border-border bg-muted/40 text-[9.5px] font-mono text-muted-foreground">
            r {source.relevance_score.toFixed(2)}
          </span>
        )}
      </div>
    </a>
  );
}

/* ─────────────────────────────────────────────────────────────
 * Empty state
 * ───────────────────────────────────────────────────────────── */

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex flex-col items-center text-center py-14">
      <div className="relative mb-6">
        <div className="absolute inset-0 rounded-full bg-primary/20 blur-2xl" />
        <div className="relative h-14 w-14 rounded-full bg-gradient-to-br from-primary/30 via-primary/10 to-transparent border border-primary/25 grid place-items-center">
          <Sparkles className="h-6 w-6 text-primary" />
        </div>
      </div>
      <h2 className="text-[22px] font-semibold tracking-tight">
        What would you like to know?
      </h2>
      <p className="text-[13px] text-muted-foreground mt-1.5 max-w-md leading-relaxed">
        Cited answers from real policy documents. Each
        <span className="mx-1 inline-block h-4 px-1 rounded border border-border bg-muted font-mono text-[10px] align-middle">
          [N]
        </span>
        in the answer maps to a source on the right rail.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-8 w-full max-w-xl">
        {SUGGESTIONS.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPick(s)}
            className="text-left rounded border border-border bg-background p-3 hover:border-primary/40 hover:bg-accent/30 transition-colors group"
          >
            <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground mb-1">
              Prompt 0{i + 1}
            </div>
            <div className="text-[12.5px] leading-[1.5] text-foreground/90 group-hover:text-foreground">
              {s}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * Stream dots
 * ───────────────────────────────────────────────────────────── */

function StreamDots() {
  return (
    <span className="inline-flex items-center gap-0.5 ml-0.5">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="h-1 w-1 rounded-full bg-primary"
          style={{
            animation: `plaindrPulse 1.2s ${i * 0.2}s infinite ease-in-out`,
          }}
        />
      ))}
      <style>{`
        @keyframes plaindrPulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.1); }
        }
      `}</style>
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────
 * Helpers
 * ───────────────────────────────────────────────────────────── */

function inferPolicyType(s: QuerySource): string | null {
  const hay = `${s.source_url} ${s.section_heading ?? ""} ${s.policy_summary ?? ""}`.toLowerCase();
  if (hay.includes("privacy")) return "privacy";
  if (hay.includes("terms")) return "tos";
  if (hay.includes("security")) return "security";
  if (hay.includes("cookie")) return "cookies";
  if (hay.includes("acceptable use")) return "aup";
  return null;
}

function cssEscape(value: string): string {
  // Best-effort escape for use inside attribute selectors.
  if (typeof window !== "undefined" && (window as { CSS?: { escape?: (s: string) => string } }).CSS?.escape) {
    return (window as unknown as { CSS: { escape: (s: string) => string } }).CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

const SOURCES_STORAGE_KEY = "plaindr:message-sources:v1";

function loadSourcesFromStorage(): Map<string, QuerySource[]> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(SOURCES_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, QuerySource[]>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

function saveSourcesToStorage(map: Map<string, QuerySource[]>): void {
  if (typeof window === "undefined") return;
  try {
    const obj = Object.fromEntries(map.entries());
    window.localStorage.setItem(SOURCES_STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // Quota or serialization error — non-fatal, citations just won't
    // survive refresh for this message.
  }
}
