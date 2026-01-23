import { useAuth } from "@clerk/clerk-react";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/clerk-react";
import { SEO, SEO_CONFIG } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { VoiceOrbButton } from "@/components/VoiceOrbButton";
import { useVoiceAgent, TranscriptEntry } from "@/hooks/useVoiceAgent";
import { AudioWaveform } from "@/components/AudioWaveform";
import { VoiceActivityIndicator } from "@/components/VoiceActivityIndicator";
import { SessionTimer } from "@/components/SessionTimer";
import { Icon3D, FloatingOrb, GlassOrb } from "@/components/Icon3D";
import { HeroIllustration } from "@/components/HeroIllustration";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { 
  Moon, 
  Sun,
  ChevronRight,
  Sparkles,
  User,
  Bot,
  History,
  ArrowRight,
  Check,
  Quote,
  MessageSquare,
  Shield,
  Zap,
  Clock,
  LucideIcon
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { Link } from "wouter";
import { useState, useCallback, useRef, useMemo } from "react";
import * as supabaseService from "@/services/supabaseService";

export default function Home() {
  const { userId, isSignedIn } = useAuth();
  const user = userId ? { id: userId } : null;
  const isAuthenticated = isSignedIn;
  const { theme, toggleTheme } = useTheme();
  const [displayMessages, setDisplayMessages] = useState<TranscriptEntry[]>([]);
  
  // Use refs to track conversation state to avoid async state issues
  const conversationIdRef = useRef<string | null>(null);
  const savedMessagesCountRef = useRef<number>(0);
  const isCreatingConversationRef = useRef<boolean>(false);
  const titleGeneratedRef = useRef<boolean>(false);

  // tRPC mutation for generating AI title
  const generateTitleMutation = trpc.conversations.generateTitle.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        console.log('[Home] AI title generated:', data.title);
      } else {
        console.log('[Home] Title generation skipped:', data.reason);
      }
    },
    onError: (error) => {
      console.error('[Home] Error generating AI title:', error);
    }
  });

  const handleTranscriptUpdate = useCallback(async (transcript: TranscriptEntry[]) => {
    console.log('[Home] handleTranscriptUpdate called, transcript length:', transcript.length);
    console.log('[Home] User:', user?.id, 'isAuthenticated:', isAuthenticated);
    console.log('[Home] Current conversationId:', conversationIdRef.current);
    console.log('[Home] Saved messages count:', savedMessagesCountRef.current);
    
    if (!isAuthenticated || !user) {
      console.log('[Home] Not authenticated, skipping save');
      return;
    }
    
    if (transcript.length === 0) {
      console.log('[Home] Empty transcript, skipping');
      return;
    }

    // Update display messages
    setDisplayMessages([...transcript]);

    // Get the new messages that haven't been saved yet
    const newMessagesStartIndex = savedMessagesCountRef.current;
    const newMessages = transcript.slice(newMessagesStartIndex);
    
    console.log('[Home] New messages to save:', newMessages.length);

    if (newMessages.length === 0) {
      console.log('[Home] No new messages to save');
      return;
    }

    // Create conversation if needed (only once)
    if (!conversationIdRef.current && !isCreatingConversationRef.current) {
      isCreatingConversationRef.current = true;
      console.log('[Home] Creating new conversation...');
      
      try {
        // Use a temporary title - will be replaced by AI-generated title on session end
        const tempTitle = "New Conversation";
        
        const conv = await supabaseService.createConversation(user.id, tempTitle);
        
        if (conv) {
          console.log('[Home] Conversation created:', conv.id);
          conversationIdRef.current = conv.id;
        } else {
          console.error('[Home] Failed to create conversation - returned null');
          isCreatingConversationRef.current = false;
          return;
        }
      } catch (error) {
        console.error('[Home] Error creating conversation:', error);
        isCreatingConversationRef.current = false;
        return;
      }
    }

    // Wait for conversation to be created if it's in progress
    if (isCreatingConversationRef.current && !conversationIdRef.current) {
      console.log('[Home] Waiting for conversation to be created...');
      await new Promise(resolve => setTimeout(resolve, 500));
      if (!conversationIdRef.current) {
        console.log('[Home] Still no conversation ID, skipping save');
        return;
      }
    }

    // Save new messages
    if (conversationIdRef.current) {
      console.log('[Home] Saving', newMessages.length, 'messages to conversation:', conversationIdRef.current);
      
      for (const msg of newMessages) {
        try {
          await supabaseService.addMessage(
            conversationIdRef.current,
            msg.role,
            msg.content
          );
          savedMessagesCountRef.current++;
          console.log('[Home] Saved message, total saved:', savedMessagesCountRef.current);
        } catch (error) {
          console.error('[Home] Error saving message:', error);
        }
      }
    }
  }, [user, isAuthenticated]);

  // Handle session end - generate AI title
  const handleSessionEnd = useCallback(async (transcript: TranscriptEntry[]) => {
    console.log('[Home] handleSessionEnd called, transcript length:', transcript.length);
    console.log('[Home] Conversation ID:', conversationIdRef.current);
    console.log('[Home] Title already generated:', titleGeneratedRef.current);

    // Only generate title once per conversation and if we have a conversation ID
    if (!conversationIdRef.current || titleGeneratedRef.current) {
      console.log('[Home] Skipping title generation - no conversation or already generated');
      return;
    }

    // Need at least 2 messages (user + assistant) for meaningful title
    if (transcript.length < 2) {
      console.log('[Home] Not enough messages for AI title generation');
      return;
    }

    // Mark as generated to prevent duplicate calls
    titleGeneratedRef.current = true;

    console.log('[Home] Generating AI title for conversation:', conversationIdRef.current);
    
    try {
      generateTitleMutation.mutate({ id: conversationIdRef.current });
    } catch (error) {
      console.error('[Home] Error triggering title generation:', error);
    }
  }, [generateTitleMutation]);

  // Memoize voice agent options to prevent recreation on every render
  const voiceAgentOptions = useMemo(() => ({
    onTranscriptUpdate: handleTranscriptUpdate,
    onSessionEnd: handleSessionEnd
  }), [handleTranscriptUpdate, handleSessionEnd]);

  const { 
    status, 
    isSessionActive, 
    error, 
    toggleSession,
    clearTranscript 
  } = useVoiceAgent(voiceAgentOptions);

  const startNewSession = useCallback(() => {
    // Reset conversation tracking for new session
    conversationIdRef.current = null;
    savedMessagesCountRef.current = 0;
    isCreatingConversationRef.current = false;
    titleGeneratedRef.current = false;
    setDisplayMessages([]);
  }, [clearTranscript]);

  // Feature data with Lucide icons
  const features: { icon: LucideIcon; variant: 'purple' | 'blue' | 'pink' | 'green'; title: string; description: string }[] = [
    {
      icon: MessageSquare,
      variant: 'purple',
      title: "Natural Conversations",
      description: "Ask questions about AI policies in plain language and get clear, contextual explanations.",
    },
    {
      icon: Shield,
      variant: 'blue',
      title: "Policy Expertise",
      description: "Access comprehensive knowledge about AI platform policies and regulatory rules.",
    },
    {
      icon: Zap,
      variant: 'pink',
      title: "Real-time Research",
      description: "When information isn't available, our system automatically researches and retrieves it.",
    },
    {
      icon: Clock,
      variant: 'green',
      title: "Conversation History",
      description: "All your conversations are saved and easily accessible for future reference.",
    },
  ];

  const howItWorks = [
    {
      step: "01",
      title: "Sign Up & Connect",
      description: "Create your account in seconds and get instant access to our AI policy assistant."
    },
    {
      step: "02",
      title: "Ask Your Question",
      description: "Use your voice or text to ask about any AI platform policy, regulation, or guideline."
    },
    {
      step: "03",
      title: "Get Expert Answers",
      description: "Receive clear, contextual explanations backed by real-time research when needed."
    }
  ];

  const testimonials = [
    {
      quote: "Plaindr has transformed how our team navigates complex AI regulations. It's like having a policy expert on call 24/7.",
      author: "Sarah Chen",
      role: "Head of Compliance, TechCorp",
      avatar: "SC"
    },
    {
      quote: "The voice interface makes it so easy to get quick answers while I'm working on other tasks. Highly recommend for any AI developer.",
      author: "Marcus Johnson",
      role: "Senior AI Engineer, DataFlow",
      avatar: "MJ"
    },
    {
      quote: "Finally, a tool that explains AI policies in plain language. Our legal team uses it daily for quick policy checks.",
      author: "Elena Rodriguez",
      role: "Legal Counsel, InnovateTech",
      avatar: "ER"
    }
  ];

  const policyAreas = [
    { title: "AI Ethics", description: "Fairness, transparency, and accountability guidelines" },
    { title: "Data Privacy", description: "GDPR, CCPA, and data protection regulations" },
    { title: "Platform Terms", description: "OpenAI, Google, Meta, and more" },
    { title: "Content Policies", description: "Acceptable use and content moderation" },
    { title: "Safety Standards", description: "AI safety and risk management" },
    { title: "Industry Regulations", description: "Healthcare, finance, and sector-specific rules" },
  ];

  return (
    <>
      <SEO
        title={SEO_CONFIG.pages.home.title}
        description={SEO_CONFIG.pages.home.description}
        robots={SEO_CONFIG.pages.home.robots}
        canonical="https://plaindr.com/"
      />
    <div className="min-h-screen bg-mesh-gradient">
      {/* Navigation */}
      <header className="fixed top-0 left-0 right-0 z-50 glass-nav">
        <div className="container flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2">
            <img
              src={theme === 'dark' ? '/plaindrlogotypebw/Plaindr_logo_BW-02.svg' : '/plaindrlogotypebw/Plaindr_logo_BW-01.svg'}
              alt="Plaindr"
              className="h-8 w-auto"
            />
          </Link>
          
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="rounded-full"
            >
              {theme === 'dark' ? (
                <Sun className="w-5 h-5" />
              ) : (
                <Moon className="w-5 h-5" />
              )}
            </Button>
            
            <SignedIn>
              <Link href="/history">
                <Button variant="ghost" size="sm" className="gap-2">
                  <History className="w-4 h-4" />
                  <span className="hidden sm:inline">History</span>
                </Button>
              </Link>
              <Link href="/profile">
                <Button variant="ghost" size="sm" className="gap-2">
                  <User className="w-4 h-4" />
                  <span className="hidden sm:inline">Profile</span>
                </Button>
              </Link>
              <UserButton afterSignOutUrl="/" />
            </SignedIn>
            
            <SignedOut>
              <SignInButton mode="modal">
                <Button variant="ghost">Sign In</Button>
              </SignInButton>
              <SignUpButton mode="modal">
                <Button className="gap-2 btn-gradient rounded-full px-6">
                  Get Started
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </SignUpButton>
            </SignedOut>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="pt-24 pb-16">
        <section className="container min-h-[calc(100vh-6rem)] flex items-center">
          <div className="grid lg:grid-cols-2 gap-12 items-center w-full">
            {/* Left Column - Text */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }}
              className="space-y-6"
            >
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-sm font-medium">
                <Sparkles className="w-4 h-4" />
                AI-Powered Policy Assistant
              </div>
              
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight">
                Navigate AI Policies with{" "}
                <span className="text-gradient">Confidence</span>
              </h1>
              
              <p className="text-lg text-muted-foreground max-w-xl">
                Get instant, accurate answers about AI platform policies, regulations, and guidelines. 
                Just ask in plain language—we'll handle the complexity.
              </p>
              
              <div className="flex flex-wrap gap-4">
                <SignedOut>
                  <SignUpButton mode="modal">
                    <Button size="lg" className="gap-2 btn-gradient rounded-full px-8">
                      Start Free
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </SignUpButton>
                </SignedOut>
                <SignedIn>
                  <Button 
                    size="lg" 
                    className="gap-2 btn-gradient rounded-full px-8"
                    onClick={() => {
                      startNewSession();
                      toggleSession();
                    }}
                  >
                    Start Conversation
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </SignedIn>
                <Link href="#features">
                  <Button size="lg" variant="outline" className="rounded-full px-8">
                    Learn More
                  </Button>
                </Link>
              </div>
              
              {/* Trust indicators */}
              <div className="flex items-center gap-6 pt-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Check className="w-4 h-4 text-green-500" />
                  No credit card required
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Check className="w-4 h-4 text-green-500" />
                  Instant access
                </div>
              </div>
            </motion.div>

            {/* Right Column - Voice Interface */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="relative"
            >
              <Card className="glass-card overflow-hidden">
                <CardContent className="p-6">
                  {/* Voice Interface */}
                  <div className="flex flex-col items-center py-4">
                    {/* Session Timer - Top */}
                    <AnimatePresence>
                      {isSessionActive && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="mb-4"
                        >
                          <SessionTimer 
                            isActive={isSessionActive} 
                            variant="badge"
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Voice Activity Indicator */}
                    <AnimatePresence>
                      {isSessionActive && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="mb-3"
                        >
                          <VoiceActivityIndicator 
                            status={status} 
                            size="sm"
                            showLabel={true}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <VoiceOrbButton
                      status={status}
                      isSessionActive={isSessionActive}
                      onClick={isAuthenticated ? toggleSession : undefined}
                      disabled={!isAuthenticated}
                    />

                    {/* Audio Waveform Visualization */}
                    <AnimatePresence>
                      {isSessionActive && status === 'listening' && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          className="mt-4 h-10 w-full max-w-[200px]"
                        >
                          <AudioWaveform 
                            isActive={status === 'listening'}
                            barCount={24}
                            color="rgb(139, 92, 246)"
                            minHeight={4}
                            maxHeight={32}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                    
                    {error && (
                      <p className="text-sm text-red-500 mt-4 text-center">
                        {error}
                      </p>
                    )}
                    
                    <p className="text-sm text-muted-foreground mt-4 text-center">
                      {!isAuthenticated 
                        ? "Sign in to start a voice session" 
                        : isSessionActive 
                          ? "Tap to end session" 
                          : "Tap to start voice session"}
                    </p>
                  </div>
                  
                  {/* Transcript Display */}
                  <AnimatePresence>
                    {displayMessages.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-4"
                      >
                        <ScrollArea className="h-64 rounded-lg bg-background/50 p-4">
                          <div className="space-y-4">
                            {displayMessages.map((msg, index) => (
                              <motion.div
                                key={index}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className={`flex gap-3 ${
                                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                                }`}
                              >
                                {msg.role === 'assistant' && (
                                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                                    <Bot className="w-4 h-4 text-white" />
                                  </div>
                                )}
                                <div
                                  className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                                    msg.role === 'user'
                                      ? 'bg-violet-500 text-white'
                                      : 'bg-muted'
                                  }`}
                                >
                                  <p className="text-sm">{msg.content}</p>
                                </div>
                                {msg.role === 'user' && (
                                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                                    <User className="w-4 h-4" />
                                  </div>
                                )}
                              </motion.div>
                            ))}
                          </div>
                        </ScrollArea>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </CardContent>
              </Card>
              
              {/* Decorative elements */}
              <div className="absolute -z-10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%]">
                <div className="absolute inset-0 bg-gradient-to-r from-violet-500/20 to-purple-500/20 blur-3xl rounded-full" />
              </div>
            </motion.div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="container py-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Everything You Need to{" "}
              <span className="text-gradient">Understand AI Policies</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Our AI-powered assistant helps you navigate the complex landscape of AI regulations and platform policies.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className="glass-card h-full hover:shadow-lg transition-shadow">
                  <CardContent className="p-6 flex flex-col items-center text-center">
                    <Icon3D icon={feature.icon} variant={feature.variant} size="lg" className="mb-4" />
                    <h3 className="font-semibold text-lg mb-2">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </section>

        {/* How It Works Section */}
        <section className="container py-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              How It <span className="text-gradient">Works</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Get started in minutes with our simple three-step process.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {howItWorks.map((item, index) => (
              <motion.div
                key={item.step}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="relative"
              >
                <Card className="glass-card h-full">
                  <CardContent className="p-6">
                    <div className="text-5xl font-bold text-violet-500/20 mb-4">{item.step}</div>
                    <h3 className="font-semibold text-xl mb-2">{item.title}</h3>
                    <p className="text-muted-foreground">{item.description}</p>
                  </CardContent>
                </Card>
                {index < howItWorks.length - 1 && (
                  <div className="hidden md:block absolute top-1/2 -right-4 transform -translate-y-1/2">
                    <ArrowRight className="w-8 h-8 text-violet-500/30" />
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </section>

        {/* Policy Areas Section */}
        <section className="container py-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Policy Areas We <span className="text-gradient">Cover</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              From ethics to regulations, we've got you covered across all major AI policy domains.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {policyAreas.map((area, index) => (
              <motion.div
                key={area.title}
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.05 }}
              >
                <Card className="glass-card hover:shadow-md transition-all hover:scale-[1.02]">
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500/20 to-purple-500/20 flex items-center justify-center">
                      <Check className="w-5 h-5 text-violet-500" />
                    </div>
                    <div>
                      <h3 className="font-medium">{area.title}</h3>
                      <p className="text-sm text-muted-foreground">{area.description}</p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Testimonials Section */}
        <section className="container py-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Trusted by <span className="text-gradient">Industry Leaders</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              See what professionals are saying about Plaindr.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map((testimonial, index) => (
              <motion.div
                key={testimonial.author}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className="glass-card h-full">
                  <CardContent className="p-6">
                    <Quote className="w-8 h-8 text-violet-500/30 mb-4" />
                    <p className="text-muted-foreground mb-6 italic">"{testimonial.quote}"</p>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-medium text-sm">
                        {testimonial.avatar}
                      </div>
                      <div>
                        <p className="font-medium">{testimonial.author}</p>
                        <p className="text-sm text-muted-foreground">{testimonial.role}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </section>

        {/* CTA Section */}
        <section className="container py-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <Card className="glass-card overflow-hidden">
              <CardContent className="p-12 text-center relative">
                <div className="absolute inset-0 bg-gradient-to-r from-violet-500/10 to-purple-500/10" />
                <div className="relative z-10">
                  <h2 className="text-3xl md:text-4xl font-bold mb-4">
                    Ready to Master AI Policies?
                  </h2>
                  <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
                    Join thousands of professionals who trust Plaindr for their policy questions.
                  </p>
                  <SignedOut>
                    <SignUpButton mode="modal">
                      <Button size="lg" className="gap-2 btn-gradient rounded-full px-8">
                        Get Started Free
                        <ArrowRight className="w-4 h-4" />
                      </Button>
                    </SignUpButton>
                  </SignedOut>
                  <SignedIn>
                    <Link href="/history">
                      <Button size="lg" className="gap-2 btn-gradient rounded-full px-8">
                        View Your Conversations
                        <ArrowRight className="w-4 h-4" />
                      </Button>
                    </Link>
                  </SignedIn>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8">
        <div className="container flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img
              src={theme === 'dark' ? '/plaindrlogotypebw/Plaindr_logo_BW-02.svg' : '/plaindrlogotypebw/Plaindr_logo_BW-01.svg'}
              alt="Plaindr"
              className="h-6 w-auto"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Plaindr. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
    </>
  );
}
