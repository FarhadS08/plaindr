import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { VoiceButton } from "@/components/VoiceButton";
import { TranscriptDisplay } from "@/components/TranscriptDisplay";
import { useVoiceAgent, TranscriptEntry } from "@/hooks/useVoiceAgent";
import { motion } from "framer-motion";
import { 
  MessageSquare, 
  Shield, 
  Zap, 
  History, 
  Moon, 
  Sun,
  LogOut,
  ChevronRight,
  Sparkles
} from "lucide-react";
import { getLoginUrl } from "@/const";
import { useTheme } from "@/contexts/ThemeContext";
import { Link } from "wouter";
import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { nanoid } from "nanoid";

export default function Home() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);
  
  const createConversation = trpc.conversations.create.useMutation();
  const addMessage = trpc.messages.add.useMutation();

  const handleTranscriptUpdate = useCallback(async (transcript: TranscriptEntry[]) => {
    if (!isAuthenticated || transcript.length === 0) return;
    
    const latestEntry = transcript[transcript.length - 1];
    
    // Create conversation if needed
    if (!currentConversationId && transcript.length === 1) {
      try {
        const conv = await createConversation.mutateAsync({
          supabaseId: nanoid(),
          title: latestEntry.content.slice(0, 50) + (latestEntry.content.length > 50 ? '...' : ''),
        });
        setCurrentConversationId(conv.id);
        
        // Add the first message
        await addMessage.mutateAsync({
          conversationId: conv.id,
          role: latestEntry.role,
          content: latestEntry.content,
        });
      } catch (error) {
        console.error('Failed to create conversation:', error);
      }
    } else if (currentConversationId) {
      // Add message to existing conversation
      try {
        await addMessage.mutateAsync({
          conversationId: currentConversationId,
          role: latestEntry.role,
          content: latestEntry.content,
        });
      } catch (error) {
        console.error('Failed to add message:', error);
      }
    }
  }, [isAuthenticated, currentConversationId, createConversation, addMessage]);

  const { status, isSessionActive, transcript, error, toggleSession, clearTranscript } = useVoiceAgent(handleTranscriptUpdate);

  const handleNewConversation = () => {
    clearTranscript();
    setCurrentConversationId(null);
  };

  const features = [
    {
      icon: <MessageSquare className="w-6 h-6" />,
      title: "Natural Conversations",
      description: "Ask questions about AI policies in plain language and get clear, contextual explanations.",
    },
    {
      icon: <Shield className="w-6 h-6" />,
      title: "Policy Expertise",
      description: "Access comprehensive knowledge about AI platform policies and regulatory rules.",
    },
    {
      icon: <Zap className="w-6 h-6" />,
      title: "Real-time Research",
      description: "When information isn't available, our system automatically researches and retrieves it.",
    },
    {
      icon: <History className="w-6 h-6" />,
      title: "Conversation History",
      description: "All your conversations are saved and easily accessible for future reference.",
    },
  ];

  return (
    <div className="min-h-screen animated-gradient">
      {/* Navigation */}
      <header className="fixed top-0 left-0 right-0 z-50 glass">
        <div className="container flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="font-semibold text-lg">AI Policy Whisperer</span>
          </Link>
          
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="rounded-full"
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </Button>
            
            {isAuthenticated && (
              <Link href="/history">
                <Button variant="ghost" className="gap-2">
                  <History className="w-4 h-4" />
                  History
                </Button>
              </Link>
            )}
            
            {loading ? (
              <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
            ) : isAuthenticated ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground hidden sm:block">
                  {user?.name || user?.email}
                </span>
                <Button variant="ghost" size="icon" onClick={() => logout()} className="rounded-full">
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <a href={getLoginUrl()}>
                <Button className="gap-2 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700">
                  Sign In
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </a>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="pt-24 pb-16">
        <div className="container">
          {/* Hero Content */}
          <div className="grid lg:grid-cols-2 gap-12 items-center min-h-[calc(100vh-12rem)]">
            {/* Left Column - Text */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }}
              className="space-y-6"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium">
                <Sparkles className="w-4 h-4" />
                Voice-Powered AI Assistant
              </div>
              
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight">
                Navigate AI Policies with{" "}
                <span className="gradient-text">Confidence</span>
              </h1>
              
              <p className="text-lg text-muted-foreground max-w-lg">
                Ask questions about AI platform policies, regulatory rules, and constraints. 
                Get clear, contextual explanations through natural voice conversations.
              </p>

              {!isAuthenticated && (
                <div className="flex flex-col sm:flex-row gap-4">
                  <a href={getLoginUrl()}>
                    <Button size="lg" className="w-full sm:w-auto gap-2 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700">
                      Get Started Free
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </a>
                  <Button size="lg" variant="outline" className="w-full sm:w-auto">
                    Learn More
                  </Button>
                </div>
              )}
            </motion.div>

            {/* Right Column - Voice Interface */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="flex flex-col items-center"
            >
              <Card className="w-full max-w-md glass border-0 overflow-hidden">
                <CardContent className="p-6">
                  {/* Voice Button */}
                  <div className="flex flex-col items-center py-8">
                    <VoiceButton
                      status={status}
                      isSessionActive={isSessionActive}
                      onClick={isAuthenticated ? toggleSession : () => window.location.href = getLoginUrl()}
                      disabled={!isAuthenticated}
                    />
                    
                    {error && (
                      <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="mt-4 text-sm text-destructive text-center"
                      >
                        {error}
                      </motion.p>
                    )}
                    
                    {!isAuthenticated && (
                      <p className="mt-4 text-sm text-muted-foreground text-center">
                        Sign in to start a voice conversation
                      </p>
                    )}
                  </div>

                  {/* Transcript Area */}
                  {isAuthenticated && (
                    <div className="border-t border-border pt-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-muted-foreground">Conversation</h3>
                        {transcript.length > 0 && (
                          <Button variant="ghost" size="sm" onClick={handleNewConversation}>
                            New Chat
                          </Button>
                        )}
                      </div>
                      <div className="h-64 rounded-lg bg-background/50">
                        <TranscriptDisplay transcript={transcript} />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* Features Section */}
          <motion.section
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mt-24"
          >
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold mb-4">
                Everything you need to understand AI policies
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Our AI-powered assistant combines voice interaction with comprehensive policy knowledge 
                to help you navigate complex regulations effortlessly.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {features.map((feature, index) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.5 + index * 0.1 }}
                >
                  <Card className="h-full glass border-0 hover:bg-card/80 transition-colors">
                    <CardContent className="p-6">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-600/20 flex items-center justify-center mb-4 text-primary">
                        {feature.icon}
                      </div>
                      <h3 className="font-semibold mb-2">{feature.title}</h3>
                      <p className="text-sm text-muted-foreground">{feature.description}</p>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          </motion.section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="container flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="w-4 h-4" />
            AI Policy Whisperer
          </div>
          <p className="text-sm text-muted-foreground">
            Powered by ElevenLabs Conversational AI
          </p>
        </div>
      </footer>
    </div>
  );
}
