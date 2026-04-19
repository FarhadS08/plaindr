import { motion } from "framer-motion";
import { Search } from "lucide-react";

interface AnswerCardProps {
  question?: string;
  answer?: React.ReactNode;
  sources?: { n: number; label: string }[];
}

export function AnswerCard({
  question = "What data does OpenAI collect from API users?",
  answer,
  sources = [
    { n: 1, label: "OpenAI Privacy Policy — §2.1" },
    { n: 2, label: "OpenAI API Data Usage — updated Apr 11" },
  ],
}: AnswerCardProps) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/60 backdrop-blur-xl overflow-hidden shadow-[0_1px_0_0_rgba(255,255,255,0.6)_inset] dark:shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]">
      {/* Question row */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60 bg-muted/40">
        <Search className="w-4 h-4 text-muted-foreground shrink-0" />
        <p className="text-sm text-foreground/90 truncate">{question}</p>
      </div>

      {/* Answer body */}
      <div className="px-5 py-4">
        <p className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground mb-2">
          Answer
        </p>
        <div className="text-[14px] leading-relaxed text-foreground/90 space-y-2">
          {answer ?? (
            <>
              <p>
                For API traffic, OpenAI collects prompts and outputs and retains
                them for up to 30 days to detect abuse
                <Citation n={1} />. API data is{" "}
                <span className="font-medium text-foreground">
                  not used to train models
                </span>{" "}
                unless you explicitly opt in
                <Citation n={2} />.
              </p>
              <p>
                ChatGPT consumer traffic is handled separately and may be used
                for training by default.
              </p>
            </>
          )}
        </div>

        {/* Sources */}
        <div className="mt-4 pt-3 border-t border-border/50">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground mb-2">
            Sources
          </p>
          <div className="space-y-1.5">
            {sources.map((s, i) => (
              <motion.div
                key={s.n}
                initial={{ opacity: 0, y: 4 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 + i * 0.08 }}
                className="flex items-center gap-2 text-[12.5px]"
              >
                <span className="inline-flex w-5 h-5 items-center justify-center rounded-md bg-violet-500/15 text-violet-700 dark:text-violet-300 text-[10px] font-semibold tabular-nums">
                  {s.n}
                </span>
                <span className="text-muted-foreground truncate">{s.label}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Citation({ n }: { n: number }) {
  return (
    <sup className="inline-flex items-center justify-center ml-0.5 px-1.5 h-4 rounded bg-violet-500/15 text-violet-700 dark:text-violet-300 text-[10px] font-semibold align-super tabular-nums">
      {n}
    </sup>
  );
}
