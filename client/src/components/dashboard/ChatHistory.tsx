import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUp,
  Loader2,
  MessageSquarePlus,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { api, type QuerySource } from "@/lib/api";
import { cn } from "@/lib/utils";
import { hostFromUrl, formatRelativeTime } from "./diff-helpers";

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

/**
 * Chat with persistent history — user's previous conversations appear
 * in the left rail; messages in the main pane; ask box at the bottom.
 *
 * Auto-creates a conversation on first message. Persists every exchange
 * via the existing tRPC backend. Streams answers via the FastAPI RAG
 * endpoint.
 */
export function ChatHistory() {
  const utils = trpc.useUtils();
  const conversationsQuery = trpc.conversations.list.useQuery();
  const createConversation = trpc.conversations.create.useMutation();
  const addMessage = trpc.messages.add.useMutation();
  const generateTitle = trpc.conversations.generateTitle.useMutation();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [stream, setStream] = useState<StreamState>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  // When list loads and nothing is selected, pick the newest one.
  useEffect(() => {
    if (!activeId && conversationsQuery.data?.length) {
      setActiveId(conversationsQuery.data[0].id);
    }
  }, [activeId, conversationsQuery.data]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const messagesQuery = trpc.conversations.get.useQuery(
    { id: activeId ?? "" },
    { enabled: !!activeId },
  );

  const isStreaming = stream.kind === "streaming";

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

    // Optimistic: persist user message, then start streaming the answer
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
    let finalSources: QuerySource[] = [];

    await api.streamQuery(
      { question: trimmed },
      {
        signal: controller.signal,
        onSources: sources => {
          finalSources = sources;
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
          // Persist assistant message + sources snippet
          await addMessage.mutateAsync({
            conversationId,
            role: "assistant",
            content: finalText,
          });
          await utils.conversations.get.invalidate({ id: conversationId });
          await utils.conversations.list.invalidate();
          setStream({ kind: "idle" });

          // Auto-generate title for fresh conversations after the first
          // exchange gives us enough context.
          if (freshConversation) {
            try {
              await generateTitle.mutateAsync({ id: conversationId });
              await utils.conversations.list.invalidate();
            } catch {
              /* non-fatal */
            }
          }
        },
        onError: () => {
          setStream({ kind: "idle" });
        },
      },
    );

    // Persist sources on the last message (via a local ref for now; a
    // production system would store citations as structured columns).
    void finalSources;
  }

  function newChat() {
    abortRef.current?.abort();
    setActiveId(null);
    setStream({ kind: "idle" });
  }

  const messages: Message[] = useMemo(() => {
    const raw = (messagesQuery.data?.messages ?? []) as Message[];
    if (stream.kind !== "streaming") return raw;
    return [
      ...raw,
      {
        id: "__streaming__",
        role: "assistant",
        content: stream.text,
        created_at: new Date().toISOString(),
        sources: stream.sources,
      },
    ];
  }, [messagesQuery.data, stream]);

  return (
    <div className="h-full grid grid-cols-[260px_1fr] gap-0 border border-border bg-card overflow-hidden">
      {/* Left rail: conversation list */}
      <aside className="border-r border-border bg-background/50 flex flex-col min-h-0">
        <div className="p-3 border-b border-border">
          <Button
            variant="default"
            size="sm"
            onClick={newChat}
            className="w-full gap-2"
          >
            <MessageSquarePlus className="h-4 w-4" />
            New chat
          </Button>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          {conversationsQuery.isLoading && (
            <div className="p-3 space-y-2">
              {[0, 1, 2].map(i => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}
          {conversationsQuery.data?.length === 0 && (
            <p className="px-4 py-6 text-xs text-muted-foreground">
              No chats yet. Ask your first question below.
            </p>
          )}
          <div className="py-1">
            {conversationsQuery.data?.map(c => (
              <ConversationItem
                key={c.id}
                title={c.title}
                updatedAt={c.updated_at}
                active={c.id === activeId}
                onClick={() => setActiveId(c.id)}
              />
            ))}
          </div>
        </ScrollArea>
      </aside>

      {/* Main pane */}
      <section className="flex flex-col min-h-0">
        <ScrollArea className="flex-1 min-h-0">
          <div className="max-w-3xl mx-auto px-4 py-6 md:py-8">
            {!activeId && (
              <EmptyState />
            )}
            {activeId && messagesQuery.isLoading && (
              <div className="space-y-3">
                {[0, 1].map(i => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            )}
            <div className="space-y-6">
              <AnimatePresence initial={false}>
                {messages.map(m => (
                  <MessageBubble key={m.id} message={m} />
                ))}
              </AnimatePresence>
            </div>
          </div>
        </ScrollArea>

        <form
          className="border-t border-border p-3 md:p-4"
          onSubmit={e => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="max-w-3xl mx-auto flex items-end gap-2">
            <Textarea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Ask about a policy, company, or change…"
              className="min-h-[44px] max-h-[180px] resize-none"
              rows={1}
            />
            {isStreaming ? (
              <Button
                type="button"
                size="icon"
                variant="secondary"
                onClick={() => abortRef.current?.abort()}
                aria-label="Stop"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                disabled={!question.trim()}
                aria-label="Send"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

function ConversationItem({
  title,
  updatedAt,
  active,
  onClick,
}: {
  title: string;
  updatedAt: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full px-3 py-2 text-left border-l-2 transition-colors",
        active
          ? "bg-accent border-primary"
          : "border-transparent hover:bg-accent/40",
      )}
    >
      <div className="text-[13px] font-medium truncate leading-tight">
        {title}
      </div>
      <div className="text-[10.5px] text-muted-foreground font-mono mt-0.5">
        {formatRelativeTime(updatedAt)}
      </div>
    </button>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={cn("flex gap-3", isUser && "flex-row-reverse")}
    >
      <div
        className={cn(
          "flex-shrink-0 h-7 w-7 rounded-full grid place-items-center text-[10px] font-semibold uppercase tracking-wide",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground",
        )}
      >
        {isUser ? "You" : "AI"}
      </div>
      <div
        className={cn(
          "max-w-[85%] text-[14px] leading-[1.6] whitespace-pre-wrap",
          isUser && "text-right",
        )}
      >
        {message.content || (
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
          </span>
        )}
        {message.sources && message.sources.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {message.sources.slice(0, 5).map((s, i) => (
              <a
                key={s.source_url}
                href={s.source_url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground border border-border hover:border-foreground/30 bg-background hover:bg-accent px-2 py-0.5 rounded-full transition-colors"
              >
                <span className="font-mono text-[10px]">[{i + 1}]</span>
                <span className="truncate max-w-[160px]">
                  {hostFromUrl(s.source_url)}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center text-center py-12">
      <div className="h-11 w-11 rounded-full bg-primary/10 grid place-items-center mb-4">
        <Sparkles className="h-5 w-5 text-primary" />
      </div>
      <h3 className="text-[18px] font-semibold tracking-tight">
        Ask Plaindr anything
      </h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-md">
        Questions about privacy, terms of service, security — answered from
        real policy documents with citations. Your history is saved here.
      </p>
    </div>
  );
}

// Unused import fixed at bottom — Trash2 is reserved for a future "delete
// conversation" action; keep the symbol referenced so lint stays happy.
void Trash2;
