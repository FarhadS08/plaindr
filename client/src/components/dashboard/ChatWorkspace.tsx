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
  Keyboard,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Mic,
  Minimize2,
  Radio,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useVoiceAgent } from "@/hooks/useVoiceAgent";
import { VoiceOrbButton } from "@/components/VoiceOrbButton";
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
import { EmptyPromptsArea } from "./EmptyPromptsArea";

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
 *   - Keyboard-first: ⌘Enter submit, Esc exit overlay. (⌘K opens
 *     the global command palette — that's the one way to search.)
 * ───────────────────────────────────────────────────────────── */

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  sources?: QuerySource[];
};

// Streaming is an OVERLAY on a real DB row. We create the assistant
// message up front with empty content, then fill `text` + `sources` in
// state as tokens arrive. On done we write them back to the DB in a
// single `messages.update` and flip to idle — no synthetic messages, no
// localStorage, one source of truth.
type StreamState =
  | { kind: "idle" }
  | {
      kind: "active";
      assistantMessageId: string;
      text: string;
      sources: QuerySource[];
    };

export function ChatWorkspace() {
  const utils = trpc.useUtils();
  const conversationsQuery = trpc.conversations.list.useQuery();
  const createConversation = trpc.conversations.create.useMutation();
  const addMessage = trpc.messages.add.useMutation();
  const updateMessage = trpc.messages.update.useMutation();
  const deleteMessage = trpc.messages.delete.useMutation();
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

  // Voice transcripts route through submitQuestion so every spoken
  // question is persisted, answered with Sonnet (Fact Grid + citations),
  // and shown in the feed — identical to a typed question. The
  // ElevenLabs agent still speaks its shorter reply in parallel.
  // A ref keeps the callback stable across renders while letting us
  // reach the latest submitQuestion closure.
  const submitQuestionRef = useRef<(q: string) => Promise<void>>(async () => {});
  const voice = useVoiceAgent({
    onUserTranscript: text => {
      void submitQuestionRef.current(text);
    },
  });
  // Voice-first by default. Users flip to text; the mode persists for
  // the lifetime of the component (no localStorage — a session pref).
  const [mode, setMode] = useState<"voice" | "text">("voice");

  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const centerScrollRef = useRef<HTMLDivElement | null>(null);
  const sourceRefs = useRef<Map<number, HTMLElement>>(new Map());

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

  // Prefill from ?q= — the command palette hands off to this page with
  // the user's query in the URL. Consume it once, flip to text mode,
  // and strip it from the URL so a refresh doesn't re-apply.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (!q) return;
    setMode("text");
    setQuestion(q);
    params.delete("q");
    const next =
      window.location.pathname +
      (params.toString() ? `?${params.toString()}` : "");
    window.history.replaceState({}, "", next);
    requestAnimationFrame(() => textareaRef.current?.focus());
    // Intentionally empty deps — run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const messagesQuery = trpc.conversations.get.useQuery(
    { id: activeId ?? "" },
    { enabled: !!activeId },
  );

  const isStreaming = stream.kind === "active";

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

  /* ───── submit ─────
   * 1. Make sure we have a conversation.
   * 2. Persist the user message.
   * 3. Persist an empty assistant shell — this is the real DB row that
   *    the streamed answer "lives in" via an overlay in state.
   * 4. Start the stream. Tokens/sources accumulate in state keyed to the
   *    shell's id.
   * 5. On done: one `messages.update` with final content + sources.
   *    On empty/error: delete the shell so no ghost row remains.
   */
  // Keep the voice-transcript callback pointed at the latest closure.
  useEffect(() => {
    submitQuestionRef.current = submitQuestion;
  });

  async function submit() {
    const trimmed = question.trim();
    if (!trimmed) return;
    setQuestion("");
    await submitQuestion(trimmed);
  }

  /**
   * Run the full answer pipeline for an explicit question string.
   * Voice mode drives this via onUserTranscript, so every spoken
   * question gets persisted and rendered identically to a typed one —
   * same DB rows, same Fact Grid, same citations. The ElevenLabs
   * agent is the audio channel; this is the visual channel.
   */
  async function submitQuestion(rawQuestion: string) {
    const trimmed = rawQuestion.trim();
    if (!trimmed || isStreaming) return;

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
    const shell = await addMessage.mutateAsync({
      conversationId,
      role: "assistant",
      content: "",
    });
    await utils.conversations.get.invalidate({ id: conversationId });

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStream({
      kind: "active",
      assistantMessageId: shell.id,
      text: "",
      sources: [],
    });

    let finalText = "";
    let finalSources: QuerySource[] = [];

    await api.streamQuery(
      { question: trimmed },
      {
        signal: controller.signal,
        onSources: sources => {
          finalSources = sources;
          setStream(prev =>
            prev.kind === "active" ? { ...prev, sources } : prev,
          );
        },
        onToken: token => {
          finalText += token;
          setStream(prev =>
            prev.kind === "active"
              ? { ...prev, text: prev.text + token }
              : prev,
          );
        },
        onDone: async () => {
          await finishStream(shell.id, finalText, finalSources, {
            conversationId,
            freshConversation,
          });
        },
        onError: async err => {
          console.error("[chat] stream error", err);
          await finishStream(shell.id, finalText, finalSources, {
            conversationId,
            freshConversation,
          });
        },
      },
    );
  }

  /** Commit the streamed answer to the DB (or drop the empty shell). */
  async function finishStream(
    shellId: string,
    text: string,
    sources: QuerySource[],
    opts: { conversationId: string; freshConversation: boolean },
  ) {
    try {
      if (text.trim()) {
        await updateMessage.mutateAsync({
          id: shellId,
          content: text,
          sources,
        });
      } else {
        // Stream produced nothing — remove the empty shell so the
        // conversation doesn't have a ghost message.
        await deleteMessage.mutateAsync({ id: shellId });
      }
      await utils.conversations.get.invalidate({ id: opts.conversationId });
      await utils.conversations.list.invalidate();
      setStream({ kind: "idle" });
      if (opts.freshConversation) {
        try {
          await generateTitle.mutateAsync({ id: opts.conversationId });
          await utils.conversations.list.invalidate();
        } catch {
          /* non-fatal */
        }
      }
    } catch (err) {
      // DB write failed. Keep the overlay up so the user still sees
      // their answer — flipping to idle here would blank the screen.
      console.error("[chat] failed to finalize assistant message", err);
    }
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
      // ⌘K belongs to the global CommandPalette now — don't steal it
      // to focus the textarea. The palette's "Ask Plaindr" row is the
      // canonical path back here.
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
    if (stream.kind !== "active") return raw;
    // Overlay the in-flight answer onto the real assistant shell row.
    // One source of truth: the DB provides id/role/created_at, the
    // stream state provides live content + sources.
    return raw.map(m =>
      m.id === stream.assistantMessageId
        ? { ...m, content: stream.text, sources: stream.sources }
        : m,
    );
  }, [messagesQuery.data, stream]);

  // Current answer being "read" for the sources panel.
  const focusedAnswer = useMemo(() => {
    if (stream.kind === "active") {
      return { text: stream.text, sources: stream.sources };
    }
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
    if (stream.kind !== "active") return null;
    return lastCitationIndex(stream.text);
  }, [stream]);

  // Auto-scroll the center pane as new tokens arrive.
  useEffect(() => {
    if (stream.kind !== "active") return;
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
            <ModeToggle mode={mode} onChange={setMode} />
            <div className="hidden md:flex items-center gap-1 mx-2 text-[10px] font-mono text-muted-foreground">
              <Kbd className="h-4 text-[9px]">⌘</Kbd>
              <Kbd className="h-4 text-[9px]">↵</Kbd>
              <span className="ml-1">send</span>
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
              mode === "voice" ? (
                <VoiceHero
                  voice={voice}
                  onPickPrompt={prompt => {
                    // Prompt cards flip to text mode and prefill the question
                    // — faster than dictating it verbatim.
                    setMode("text");
                    setQuestion(prompt);
                    requestAnimationFrame(() => textareaRef.current?.focus());
                  }}
                />
              ) : (
                <EmptyState
                  onPick={prompt => {
                    setQuestion(prompt);
                    requestAnimationFrame(() => textareaRef.current?.focus());
                  }}
                />
              )
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
                {messages.map((m, idx) => (
                  <MessageRow
                    isStreaming={
                      stream.kind === "active" &&
                      m.id === stream.assistantMessageId
                    }
                    onJumpToPrompt={
                      m.role === "user"
                        ? () => {
                            // Scroll the matching Q/A pair to the top of the
                            // center pane so the reader can re-read it.
                            const root = centerScrollRef.current;
                            const target = root?.querySelector<HTMLElement>(
                              `[data-msg-id="${m.id}"]`,
                            );
                            if (target && root) {
                              const top =
                                target.getBoundingClientRect().top -
                                root.getBoundingClientRect().top +
                                root.scrollTop -
                                12;
                              root.scrollTo({ top, behavior: "smooth" });
                            }
                          }
                        : undefined
                    }
                    onFollowUpPick={prompt => {
                      // Clicked follow-up questions inside a refusal
                      // handoff get treated the same way as the empty-
                      // state prompt cards: flip to text mode, prefill
                      // the textarea, focus it. User confirms by hitting
                      // send — never auto-submits silently.
                      setMode("text");
                      setQuestion(prompt);
                      requestAnimationFrame(() =>
                        textareaRef.current?.focus(),
                      );
                    }}
                    index={idx}
                    key={m.id}
                    message={m}
                    citationCtx={citationCtx}
                  />
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* ask box — voice bar or text input depending on mode.
            In voice mode the hero orb IS the control on the empty
            screen, so the bottom bar only shows once a conversation
            has started (otherwise you get two orbs stacked). */}
        {mode === "voice" ? (
          (activeId || isStreaming) ? <VoiceBar voice={voice} /> : null
        ) : (
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
                <div className="flex items-center gap-1 self-center">
                  {isStreaming ? (
                    <button
                      type="button"
                      onClick={() => abortRef.current?.abort()}
                      aria-label="Stop"
                      className="inline-flex items-center justify-center h-8 w-8 rounded-md bg-muted text-foreground hover:bg-muted/80 transition-colors"
                    >
                      <Square className="h-3 w-3 fill-current" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={!question.trim()}
                      aria-label="Send"
                      className={cn(
                        "inline-flex items-center justify-center h-8 w-8 rounded-md transition-colors",
                        "bg-primary text-primary-foreground hover:bg-primary/90",
                        "disabled:opacity-40 disabled:pointer-events-none",
                      )}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </form>
        )}
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
  isStreaming,
  onJumpToPrompt,
  onFollowUpPick,
  index,
}: {
  message: Message;
  citationCtx: { onCitationClick: (n: number) => void; onCitationHover: (n: number | null) => void };
  isStreaming: boolean;
  onJumpToPrompt?: () => void;
  onFollowUpPick?: (prompt: string) => void;
  index: number;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    // Prompt header — clickable to scroll this Q/A pair to the top of
    // the pane, so the reader can jump back to a specific question.
    return (
      <motion.div
        initial={{ opacity: 0, y: 2 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.12 }}
        className="relative pl-4 pt-2"
        data-msg-id={message.id}
        data-msg-index={index}
      >
        <span
          aria-hidden
          className="absolute left-0 top-2 bottom-1 w-[2px] bg-primary/60 rounded-full"
        />
        <button
          type="button"
          onClick={onJumpToPrompt}
          className="w-full text-left group/prompt rounded -ml-1 pl-1 pr-2 py-0.5 hover:bg-primary/[0.04] transition-colors"
          title="Jump to this question"
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9.5px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
              Prompt
            </span>
            <span className="text-[9.5px] font-mono text-muted-foreground/60">
              {formatRelativeTime(message.created_at)}
            </span>
            <span className="text-[9.5px] font-mono text-muted-foreground/0 group-hover/prompt:text-muted-foreground/70 transition-colors ml-auto">
              ↑ jump
            </span>
          </div>
          <div className="text-[15px] font-medium leading-[1.4] text-foreground">
            {message.content}
          </div>
        </button>
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
      data-msg-id={message.id}
      data-msg-index={index}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9.5px] font-mono uppercase tracking-[0.14em] text-primary/70">
          Answer
        </span>
        {isStreaming && (
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
          isStreaming={isStreaming}
          citationCtx={citationCtx}
          onFollowUpPick={onFollowUpPick}
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
 * Mode toggle + voice UI
 * ───────────────────────────────────────────────────────────── */

type Voice = ReturnType<typeof useVoiceAgent>;

function ModeToggle({
  mode,
  onChange,
}: {
  mode: "voice" | "text";
  onChange: (m: "voice" | "text") => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Ask mode"
      className="inline-flex items-center rounded-full border border-border bg-muted/30 p-0.5"
    >
      <ModeTab
        active={mode === "voice"}
        onClick={() => onChange("voice")}
        icon={Mic}
        label="Voice"
      />
      <ModeTab
        active={mode === "text"}
        onClick={() => onChange("text")}
        icon={Keyboard}
        label="Text"
      />
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[11px] font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}

function VoiceHero({
  voice,
  onPickPrompt,
}: {
  voice: Voice;
  onPickPrompt: (prompt: string) => void;
}) {
  return (
    <div className="flex flex-col items-center text-center py-10">
      <VoiceOrbButton
        status={voice.status}
        isSessionActive={voice.isSessionActive}
        onClick={voice.toggleSession}
        disabled={voice.status === "connecting"}
        size="lg"
      />
      {voice.status === "error" && (
        <p className="mt-3 text-[12px] text-destructive max-w-sm">
          {voice.error ?? "Couldn't connect to voice. Try text instead."}
        </p>
      )}
      <p className="mt-6 text-[13px] text-muted-foreground max-w-md leading-relaxed mb-6">
        Cited answers from 465 real policies. Each
        <span className="mx-1 inline-block h-4 px-1 rounded border border-border bg-muted font-mono text-[10px] align-middle">
          [N]
        </span>
        in the answer maps to a source on the right rail.
      </p>
      <EmptyPromptsArea onPick={onPickPrompt} />
    </div>
  );
}

function VoiceBar({ voice }: { voice: Voice }) {
  // Compact voice control that sits where the text input would be
  // once a conversation has started. During an active session, shows
  // the last user utterance as a quoted line above the orb — kills
  // the "did it hear me right?" anxiety without resurrecting the
  // loud status banner we deleted earlier.
  const lastUser = [...voice.transcript]
    .reverse()
    .find(t => t.role === "user");
  const hint =
    voice.status === "connecting"
      ? "Connecting…"
      : voice.status === "listening"
        ? "Listening"
        : voice.status === "speaking"
          ? "Speaking"
          : voice.status === "connected"
            ? "Ready — speak now"
            : voice.status === "error"
              ? "Couldn't connect — try text mode or check mic permission"
              : null;
  return (
    <div className="border-t border-border bg-background">
      <div className="max-w-3xl mx-auto px-4 py-4 md:px-6 md:py-5 flex flex-col items-center gap-3">
        {voice.isSessionActive && lastUser && (
          <div className="w-full max-w-xl rounded-md border border-border bg-muted/30 px-3 py-2">
            <div className="text-[9.5px] font-mono uppercase tracking-[0.14em] text-muted-foreground mb-0.5">
              You said
            </div>
            <div className="text-[12.5px] leading-snug text-foreground/90 italic">
              "{lastUser.content}"
            </div>
          </div>
        )}
        {voice.isSessionActive && !lastUser && hint && (
          <div
            className={cn(
              "text-[11px] font-mono uppercase tracking-[0.14em]",
              voice.status === "error"
                ? "text-destructive"
                : "text-muted-foreground",
            )}
          >
            {hint}
          </div>
        )}
        <VoiceOrbButton
          status={voice.status}
          isSessionActive={voice.isSessionActive}
          onClick={voice.toggleSession}
          disabled={voice.status === "connecting"}
          size="sm"
        />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * Empty state (text mode)
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
      <p className="text-[13px] text-muted-foreground mt-1.5 max-w-md leading-relaxed mb-8">
        Cited answers from real policy documents. Each
        <span className="mx-1 inline-block h-4 px-1 rounded border border-border bg-muted font-mono text-[10px] align-middle">
          [N]
        </span>
        in the answer maps to a source on the right rail.
      </p>
      <EmptyPromptsArea onPick={onPick} />
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

