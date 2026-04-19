import { useState } from "react";
import { useVoiceAgent } from "@/hooks/useVoiceAgent";
import { VoiceOrbButton } from "@/components/VoiceOrbButton";
import { AskWidget } from "@/components/dashboard/AskWidget";
import { Button } from "@/components/ui/button";
import { Keyboard, Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

type Mode = "voice" | "text";

/**
 * Voice-first ask hero for the dashboard.
 * Orb is the primary affordance; text input is a one-click fallback.
 */
export function VoiceAskHero() {
  const [mode, setMode] = useState<Mode>("voice");
  const voice = useVoiceAgent();
  const isSessionActive = voice.isSessionActive;

  return (
    <section className="relative overflow-hidden border border-border bg-card">
      {/* Ambient radial gradient */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.18] dark:opacity-25"
        style={{
          background:
            "radial-gradient(50% 50% at 50% 30%, hsl(var(--primary) / 0.5), transparent 70%)",
        }}
      />
      <div className="relative px-6 py-10 md:py-14 flex flex-col items-center">
        {/* Mode toggle */}
        <div className="mb-6 inline-flex items-center gap-1 rounded-full border border-border bg-background/60 backdrop-blur p-1">
          <ModeBtn
            active={mode === "voice"}
            onClick={() => setMode("voice")}
            icon={Mic}
            label="Voice"
          />
          <ModeBtn
            active={mode === "text"}
            onClick={() => setMode("text")}
            icon={Keyboard}
            label="Text"
          />
        </div>

        <AnimatePresence mode="wait">
          {mode === "voice" ? (
            <motion.div
              key="voice"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col items-center text-center w-full max-w-xl"
            >
              <h2 className="text-[28px] md:text-[34px] font-semibold tracking-tight leading-[1.15] mb-2">
                Ask Plaindr
              </h2>
              <p className="text-sm text-muted-foreground max-w-md mb-8">
                {isSessionActive
                  ? "Listening — ask about any AI tool's privacy, terms, or security."
                  : "Tap the orb to speak. Plaindr answers from 465 real policies, with citations."}
              </p>

              <VoiceOrbButton
                status={voice.status}
                isSessionActive={isSessionActive}
                onClick={voice.toggleSession}
                disabled={voice.status === "connecting"}
                size="lg"
              />

              {voice.status === "error" && (
                <p className="mt-4 text-sm text-destructive">
                  Couldn't connect to voice. Try text instead.
                </p>
              )}

              <div className="mt-8 flex flex-wrap justify-center gap-2 text-xs">
                <ExamplePrompt onClick={() => setMode("text")}>
                  What data does OpenAI collect?
                </ExamplePrompt>
                <ExamplePrompt onClick={() => setMode("text")}>
                  Compare Claude and ChatGPT training policies
                </ExamplePrompt>
                <ExamplePrompt onClick={() => setMode("text")}>
                  What changed in Vercel's terms?
                </ExamplePrompt>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="text"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-2xl"
            >
              <h2 className="text-[24px] font-semibold tracking-tight text-center mb-6">
                Ask Plaindr
              </h2>
              <AskWidget />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function ModeBtn({
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
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn(
        "h-8 rounded-full gap-1.5 px-3 text-xs font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Button>
  );
}

function ExamplePrompt({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-border bg-background/50 hover:bg-background hover:border-foreground/20 px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
    >
      {children}
    </button>
  );
}
