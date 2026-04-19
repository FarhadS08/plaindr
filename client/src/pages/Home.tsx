import {
  SignedIn,
  SignedOut,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/clerk-react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { useState } from "react";
import {
  Moon,
  Sun,
  ArrowRight,
  MessageSquare,
  FileText,
  Mic,
  Scale,
  BellRing,
  Building2,
  Check,
  ChevronRight,
  Quote,
  CornerDownRight,
} from "lucide-react";

import { SEO, SEO_CONFIG } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { AnimatedOrb } from "@/components/AnimatedOrb";
import { useTheme } from "@/contexts/ThemeContext";

import { PolicyDiff } from "@/components/landing/PolicyDiff";
import { AnswerCard } from "@/components/landing/AnswerCard";
import { DashboardPreview } from "@/components/landing/DashboardPreview";
import { CompanyMarks } from "@/components/landing/CompanyMarks";

/* ------------------------------------------------------------------ */
/*  Home page                                                         */
/* ------------------------------------------------------------------ */

export default function Home() {
  const { theme, toggleTheme } = useTheme();

  return (
    <>
      <SEO
        title={SEO_CONFIG.pages.home.title}
        description={SEO_CONFIG.pages.home.description}
        robots={SEO_CONFIG.pages.home.robots}
        canonical="https://plaindr.com/"
      />

      <div className="relative min-h-screen bg-background text-foreground overflow-x-hidden">
        {/* Ambient background wash */}
        <BackdropWash />

        <TopNav theme={theme} toggleTheme={toggleTheme} />

        <main className="relative">
          <Hero />
          <SocialProof />
          <HowItWorks />
          <FeatureGrid />
          <DashboardSection />
          <FAQ />
          <CtaBand />
        </main>

        <Footer theme={theme} />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Background                                                         */
/* ------------------------------------------------------------------ */

function BackdropWash() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      {/* Dotted grid */}
      <div
        className="absolute inset-0 opacity-[0.35] dark:opacity-[0.25]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
          backgroundSize: "28px 28px",
          color: "var(--border)",
          maskImage:
            "radial-gradient(ellipse at 50% 0%, black 0%, transparent 70%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at 50% 0%, black 0%, transparent 70%)",
        }}
      />
      {/* Aurora blobs */}
      <div className="absolute top-[-10%] left-[-10%] w-[60vw] h-[60vw] rounded-full bg-violet-500/20 dark:bg-violet-500/15 blur-[120px]" />
      <div className="absolute top-[20%] right-[-15%] w-[50vw] h-[50vw] rounded-full bg-fuchsia-500/10 dark:bg-fuchsia-500/10 blur-[120px]" />
      <div className="absolute bottom-[-20%] left-[20%] w-[50vw] h-[50vw] rounded-full bg-indigo-500/10 dark:bg-indigo-500/10 blur-[120px]" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Top nav                                                            */
/* ------------------------------------------------------------------ */

function TopNav({
  theme,
  toggleTheme,
}: {
  theme: "light" | "dark";
  toggleTheme?: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/70 border-b border-border/60">
      <div className="container flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <img
            src={
              theme === "dark"
                ? "/plaindrlogotypebw/Plaindr_logo_WORD_white.svg"
                : "/plaindrlogotypebw/Plaindr_logo_WORD_black.svg"
            }
            alt="Plaindr"
            className="h-7 w-auto"
          />
        </Link>

        <nav className="hidden md:flex items-center gap-7 text-sm text-muted-foreground">
          <SignedIn>
            <Link
              href="/dashboard"
              className="hover:text-foreground transition-colors"
            >
              Dashboard
            </Link>
          </SignedIn>
          <a href="#how" className="hover:text-foreground transition-colors">
            How it works
          </a>
          <a
            href="#features"
            className="hover:text-foreground transition-colors"
          >
            Features
          </a>
          <a href="#faq" className="hover:text-foreground transition-colors">
            FAQ
          </a>
          <a
            href="https://docs.plaindr.com"
            className="hover:text-foreground transition-colors"
          >
            Docs
          </a>
        </nav>

        <div className="flex items-center gap-2">
          {toggleTheme && (
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="rounded-full h-9 w-9"
            >
              {theme === "dark" ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </Button>
          )}

          <SignedOut>
            <SignInButton mode="modal">
              <Button variant="ghost" size="sm" className="rounded-full">
                Sign in
              </Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button
                size="sm"
                className="rounded-full bg-foreground text-background hover:bg-foreground/90"
              >
                Start free
                <ChevronRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </SignUpButton>
          </SignedOut>

          <SignedIn>
            <Link href="/dashboard">
              <Button
                size="sm"
                className="rounded-full bg-foreground text-background hover:bg-foreground/90 hidden sm:inline-flex"
              >
                Dashboard
              </Button>
            </Link>
            <UserButton afterSignOutUrl="/" />
          </SignedIn>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/*  Hero                                                               */
/* ------------------------------------------------------------------ */

function Hero() {
  return (
    <section className="container pt-16 sm:pt-24 pb-12 sm:pb-20">
      <div className="mx-auto max-w-5xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border/70 bg-background/60 backdrop-blur text-xs text-muted-foreground"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-500 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet-500" />
          </span>
          Now tracking 130+ AI tools
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.05 }}
          className="mt-6 text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-[-0.03em] leading-[0.95]"
        >
          Read AI policy{" "}
          <span className="italic font-serif text-violet-600 dark:text-violet-300">
            the way
          </span>{" "}
          it was meant to be read.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed"
        >
          Plaindr understands AI privacy policies, terms of service, and data
          handling across 130+ tools — so you don't have to. Ask anything. Get
          straight, sourced answers. Track every change.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.25 }}
          className="mt-9 flex flex-wrap items-center justify-center gap-3"
        >
          <SignedIn>
            <Link href="/dashboard">
              <Button
                size="lg"
                className="rounded-full h-12 px-6 text-base bg-foreground text-background hover:bg-foreground/90"
              >
                Start asking
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </SignedIn>
          <SignedOut>
            <SignUpButton mode="modal">
              <Button
                size="lg"
                className="rounded-full h-12 px-6 text-base bg-foreground text-background hover:bg-foreground/90"
              >
                Start asking
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </SignUpButton>
          </SignedOut>
          <a href="#how">
            <Button
              size="lg"
              variant="outline"
              className="rounded-full h-12 px-6 text-base bg-background/60 backdrop-blur"
            >
              See how it works
            </Button>
          </a>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mt-4 text-xs text-muted-foreground"
        >
          No credit card. Free for the first 50 questions.
        </motion.p>
      </div>

      {/* Hero stage: orb + floating answer card + floating diff */}
      <div className="relative mt-14 sm:mt-20">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="relative mx-auto max-w-5xl"
        >
          <div className="relative aspect-[16/10] sm:aspect-[16/8]">
            {/* Centerpiece orb */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[280px] h-[280px] sm:w-[360px] sm:h-[360px]">
              <AnimatedOrb hue={280} isActive intensity={0.9} />
            </div>

            {/* Floating answer card — left */}
            <motion.div
              initial={{ opacity: 0, x: -20, y: 20 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              transition={{ duration: 0.8, delay: 0.6 }}
              className="hidden md:block absolute left-0 top-6 w-[340px]"
            >
              <div className="rotate-[-2deg]">
                <AnswerCard />
              </div>
            </motion.div>

            {/* Floating diff — right */}
            <motion.div
              initial={{ opacity: 0, x: 20, y: 20 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              transition={{ duration: 0.8, delay: 0.75 }}
              className="hidden md:block absolute right-0 bottom-2 w-[360px]"
            >
              <div className="rotate-[2deg]">
                <PolicyDiff />
              </div>
            </motion.div>

            {/* Mobile stack of cards */}
            <div className="md:hidden absolute inset-x-0 bottom-0 px-2 space-y-3">
              <AnswerCard />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Social proof                                                       */
/* ------------------------------------------------------------------ */

function SocialProof() {
  return (
    <section className="container py-14 sm:py-20 border-y border-border/50">
      <div className="grid lg:grid-cols-[auto_1fr] gap-10 lg:gap-16 items-center">
        {/* Stats */}
        <div className="flex gap-6 sm:gap-10 justify-center lg:justify-start">
          <Stat value="130+" label="tools tracked" />
          <div className="w-px bg-border" />
          <Stat value="465" label="policies indexed" />
          <div className="w-px bg-border" />
          <Stat value="24/7" label="change detection" />
        </div>

        {/* Company marks */}
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-5 text-center lg:text-left">
            Policies tracked from
          </p>
          <CompanyMarks />
        </div>
      </div>
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center lg:text-left">
      <div className="text-3xl sm:text-4xl font-semibold tracking-tight tabular-nums">
        {value}
      </div>
      <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground mt-1">
        {label}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  How it works                                                       */
/* ------------------------------------------------------------------ */

function HowItWorks() {
  return (
    <section id="how" className="container py-20 sm:py-28">
      <SectionHeader
        eyebrow="How it works"
        title="Three steps. Real answers."
        subtitle="From question to sourced answer to ongoing change detection — Plaindr handles the policy layer of every AI tool you touch."
      />

      <div className="mt-14 grid md:grid-cols-3 gap-6 lg:gap-8">
        <StepCard
          step="01"
          title="Ask a question"
          description="In plain English, or with your voice. No keyword gymnastics."
          visual={
            <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-background/60 border border-border/60 text-[13px] shadow-sm">
              <CornerDownRight className="w-3.5 h-3.5 text-violet-500 shrink-0" />
              <span className="text-foreground/85">
                What data does OpenAI collect?
              </span>
            </div>
          }
        />
        <StepCard
          step="02"
          title="Get a cited answer"
          description="Every claim is linked to the exact clause, page, and date."
          visual={
            <div className="rounded-lg border border-border/60 bg-background/60 p-3 text-[12.5px] leading-relaxed shadow-sm">
              <p className="text-foreground/85">
                API data is retained for 30 days
                <sup className="inline-flex items-center justify-center ml-0.5 px-1 h-3.5 rounded bg-violet-500/15 text-violet-700 dark:text-violet-300 text-[9px] font-semibold align-super tabular-nums">
                  1
                </sup>{" "}
                and not used to train models by default.
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground border-t border-border/50 pt-2">
                <span className="text-violet-600 dark:text-violet-300 font-medium">
                  Source 1
                </span>{" "}
                OpenAI Privacy Policy § 2.1
              </p>
            </div>
          }
        />
        <StepCard
          step="03"
          title="Track every change"
          description="Git-style diffs. AI summaries. Alerts when it matters to you."
          visual={
            <div className="rounded-lg border border-border/60 bg-background/60 font-mono text-[11.5px] leading-snug overflow-hidden shadow-sm">
              <div className="bg-rose-500/10 px-3 py-1 text-rose-700 dark:text-rose-300">
                − retained for 30 days
              </div>
              <div className="bg-emerald-500/10 px-3 py-1 text-emerald-700 dark:text-emerald-300">
                + retained for 90 days
              </div>
              <div className="px-3 py-1.5 text-[10.5px] text-muted-foreground border-t border-border/50">
                OpenAI · updated 4 days ago
              </div>
            </div>
          }
        />
      </div>
    </section>
  );
}

function StepCard({
  step,
  title,
  description,
  visual,
}: {
  step: string;
  title: string;
  description: string;
  visual: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5 }}
      className="relative p-6 rounded-2xl border border-border/70 bg-card/50 backdrop-blur-xl"
    >
      <div className="flex items-start justify-between mb-5">
        <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          Step {step}
        </span>
        <span className="text-5xl font-semibold text-violet-500/20 dark:text-violet-400/20 leading-none font-serif italic">
          {step}
        </span>
      </div>
      <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
        {description}
      </p>
      <div className="mt-5">{visual}</div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Feature grid                                                       */
/* ------------------------------------------------------------------ */

type Feature = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  wide?: boolean;
  badge?: string;
};

const FEATURES: Feature[] = [
  {
    icon: FileText,
    title: "Zero-hallucination RAG",
    desc: "Every sentence in every answer links back to the exact clause it came from. If we can't cite it, we don't say it.",
    wide: true,
  },
  {
    icon: MessageSquare,
    title: "Git-style policy diffs",
    desc: "Red lines removed, green lines added — every change, AI-summarized in one sentence.",
  },
  {
    icon: Mic,
    title: "Voice mode",
    desc: "Hands busy? Talk to Plaindr. Ask, compare, drill in — all spoken.",
  },
  {
    icon: Scale,
    title: "Side-by-side comparison",
    desc: "Compare data retention, training usage, or security posture across any set of tools.",
  },
  {
    icon: BellRing,
    title: "Change alerts",
    desc: "Subscribe to a company or a clause type. Get notified before your team does.",
    badge: "Soon",
  },
  {
    icon: Building2,
    title: "Enterprise ready",
    desc: "SSO, audit logs, private workspaces. Deploy in your VPC on request.",
  },
];

function FeatureGrid() {
  return (
    <section id="features" className="container py-20 sm:py-28">
      <SectionHeader
        eyebrow="Features"
        title="Everything you need to stay policy-fluent."
        subtitle="Built for legal, security, compliance, and builders who care which data goes where."
      />

      <div className="mt-14 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {FEATURES.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.45, delay: (i % 3) * 0.06 }}
            className={[
              "group relative p-6 rounded-2xl border border-border/70 bg-card/50 backdrop-blur-xl",
              "hover:border-violet-500/40 hover:bg-card/70 transition-colors",
              f.wide ? "lg:col-span-2" : "",
            ].join(" ")}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-300 flex items-center justify-center">
                <f.icon className="w-4 h-4" />
              </div>
              <h3 className="text-base font-semibold tracking-tight">
                {f.title}
              </h3>
              {f.badge && (
                <span className="ml-auto text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-300">
                  {f.badge}
                </span>
              )}
            </div>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
              {f.desc}
            </p>

            {/* subtle hover underline */}
            <div className="absolute inset-x-6 bottom-0 h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Dashboard preview                                                  */
/* ------------------------------------------------------------------ */

function DashboardSection() {
  return (
    <section className="container py-20 sm:py-28">
      <SectionHeader
        eyebrow="The dashboard"
        title="Your policy radar."
        subtitle="Watch the companies you care about. Scan 130+ tools by clause. Catch changes before compliance does."
      />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.7 }}
        className="mt-14 max-w-5xl mx-auto"
      >
        <DashboardPreview />
      </motion.div>

      {/* pull quote */}
      <motion.figure
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="mt-14 max-w-2xl mx-auto text-center"
      >
        <Quote className="w-8 h-8 text-violet-500/40 mx-auto mb-4" />
        <blockquote className="text-xl sm:text-2xl font-medium leading-snug tracking-tight">
          "We used to read every updated privacy policy by hand. Now Plaindr
          tells us what changed, and whether we care."
        </blockquote>
        <figcaption className="mt-4 text-sm text-muted-foreground">
          — Legal Operations, mid-size B2B SaaS
        </figcaption>
      </motion.figure>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  FAQ                                                                */
/* ------------------------------------------------------------------ */

const FAQS = [
  {
    q: "How accurate are the answers?",
    a: "Plaindr uses retrieval-augmented generation over the current text of each policy. Every claim is anchored to a cited clause — if the retrieval doesn't find a supporting passage, the model is instructed to decline rather than guess. In head-to-head evals against handwritten legal summaries, we ship when our agreement rate is above 95%.",
  },
  {
    q: "What companies and documents do you track?",
    a: "130+ AI tools across foundation models (OpenAI, Anthropic, Google, Mistral, Cohere, Meta), developer platforms (Vercel, Replicate, Together), productivity (Notion AI, HubSpot, ClickUp), and infra (AWS Bedrock, Azure AI). For each, we index the current privacy policy, terms of service, acceptable use, security addendum, and DPA where public.",
  },
  {
    q: "How do you detect policy changes?",
    a: "We re-crawl every tracked document on a daily cadence, hash the normalized text, and diff against the previous version. When a change lands, we run an AI summary pass that classifies the change (retention, training, scope, liability, etc.) and rates material impact, then push an alert to subscribers.",
  },
  {
    q: "Is my data private?",
    a: "Your questions and conversation history are encrypted at rest and are never used to train third-party models. Enterprise plans include a private workspace with SSO and an option to deploy the retrieval layer in your own VPC.",
  },
  {
    q: "What's the pricing?",
    a: "Free for your first 50 questions with access to the full tracker. Pro is $19/mo for unlimited questions, voice mode, and change alerts. Team and Enterprise plans add SSO, audit logs, and custom policy ingestion — talk to us.",
  },
  {
    q: "How do I get started?",
    a: "Sign up with email or Google, ask your first question, see a cited answer in under a second. No setup, no configuration. If you hit something we don't know, we'll ingest it and let you know.",
  },
];

function FAQ() {
  return (
    <section id="faq" className="container py-20 sm:py-28">
      <SectionHeader
        eyebrow="FAQ"
        title="Answers, for the answerer."
        subtitle="The questions we get most often. More in the docs."
      />

      <div className="mt-12 max-w-3xl mx-auto">
        <Accordion
          type="single"
          collapsible
          className="rounded-2xl border border-border/70 bg-card/50 backdrop-blur-xl overflow-hidden divide-y divide-border/60"
        >
          {FAQS.map((f, i) => (
            <AccordionItem
              key={f.q}
              value={`item-${i}`}
              className="border-b-0 px-5"
            >
              <AccordionTrigger className="text-base font-medium tracking-tight hover:no-underline">
                {f.q}
              </AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground leading-relaxed pb-5 pr-6">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  CTA band                                                           */
/* ------------------------------------------------------------------ */

function CtaBand() {
  const [company, setCompany] = useState("OpenAI");
  const samples = ["OpenAI", "Anthropic", "Google", "Vercel", "HubSpot"];

  return (
    <section className="container py-20 sm:py-28">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.6 }}
        className="relative overflow-hidden rounded-[28px] border border-border/70 bg-card/60 backdrop-blur-xl p-10 sm:p-16 text-center"
      >
        {/* glow */}
        <div
          aria-hidden
          className="absolute -inset-20 -z-10 bg-gradient-to-tr from-violet-500/20 via-transparent to-fuchsia-500/20 blur-3xl"
        />

        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Try it now
        </p>

        <h2 className="mt-4 text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-[-0.03em] leading-[1]">
          See what{" "}
          <span className="inline-flex items-baseline">
            <span className="italic font-serif text-violet-600 dark:text-violet-300">
              {company}
            </span>
          </span>
          <br className="hidden sm:block" /> collects — ask for free.
        </h2>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {samples.map((s) => (
            <button
              key={s}
              onClick={() => setCompany(s)}
              className={[
                "text-xs px-3 py-1.5 rounded-full border transition-colors",
                s === company
                  ? "bg-foreground text-background border-foreground"
                  : "bg-background/60 border-border/70 text-muted-foreground hover:text-foreground hover:border-border",
              ].join(" ")}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <SignedOut>
            <SignUpButton mode="modal">
              <Button
                size="lg"
                className="rounded-full h-12 px-6 text-base bg-foreground text-background hover:bg-foreground/90"
              >
                Ask about {company}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </SignUpButton>
          </SignedOut>
          <SignedIn>
            <Link href="/dashboard">
              <Button
                size="lg"
                className="rounded-full h-12 px-6 text-base bg-foreground text-background hover:bg-foreground/90"
              >
                Ask about {company}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </SignedIn>
        </div>

        <div className="mt-5 inline-flex items-center gap-4 text-xs text-muted-foreground justify-center">
          <span className="inline-flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-emerald-500" />
            50 free questions
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-emerald-500" />
            No credit card
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-emerald-500" />
            30-second setup
          </span>
        </div>
      </motion.div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Footer                                                             */
/* ------------------------------------------------------------------ */

function Footer({ theme }: { theme: "light" | "dark" }) {
  return (
    <footer className="container mt-8 pb-10 pt-14 border-t border-border/60">
      <div className="grid gap-10 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <div>
          <img
            src={
              theme === "dark"
                ? "/plaindrlogotypebw/Plaindr_logo_WORD_white.svg"
                : "/plaindrlogotypebw/Plaindr_logo_WORD_black.svg"
            }
            alt="Plaindr"
            className="h-7 w-auto"
          />
          <p className="mt-4 text-sm text-muted-foreground max-w-xs leading-relaxed">
            The policy layer for AI tools. Ask anything. Track everything.
          </p>
        </div>

        <FooterCol
          heading="Product"
          links={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Pricing", href: "/pricing" },
            { label: "Changelog", href: "/changelog" },
            { label: "Status", href: "https://status.plaindr.com" },
          ]}
        />
        <FooterCol
          heading="Resources"
          links={[
            { label: "Docs", href: "https://docs.plaindr.com" },
            { label: "API", href: "https://docs.plaindr.com/api" },
            { label: "Contact", href: "mailto:hello@plaindr.com" },
          ]}
        />
        <FooterCol
          heading="Legal"
          links={[
            { label: "Privacy", href: "/privacy" },
            { label: "Terms", href: "/terms" },
            { label: "Security", href: "/security" },
          ]}
        />
      </div>

      <div className="mt-12 pt-6 border-t border-border/50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>© {new Date().getFullYear()} Plaindr. All rights reserved.</span>
        <span>Made for anyone who has ever read a privacy policy.</span>
      </div>
    </footer>
  );
}

function FooterCol({
  heading,
  links,
}: {
  heading: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <h4 className="text-xs uppercase tracking-[0.14em] text-muted-foreground mb-3">
        {heading}
      </h4>
      <ul className="space-y-2 text-sm">
        {links.map((l) => (
          <li key={l.label}>
            <a
              href={l.href}
              className="text-foreground/80 hover:text-foreground transition-colors"
            >
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared                                                             */
/* ------------------------------------------------------------------ */

function SectionHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5 }}
      className="max-w-2xl mx-auto text-center"
    >
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-[-0.025em] leading-[1.05]">
        {title}
      </h2>
      <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
        {subtitle}
      </p>
    </motion.div>
  );
}
