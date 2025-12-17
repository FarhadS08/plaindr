import { useAuth, SignedIn, SignedOut } from "@/contexts/ClerkContext";
import { SignInButton, SignUpButton, UserButton } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { VoiceButton } from "@/components/VoiceButton";
import { useVoiceAgent, TranscriptEntry } from "@/hooks/useVoiceAgent";
import { motion, AnimatePresence } from "framer-motion";
import { 
  MessageSquare, 
  Shield, 
  Zap, 
  History, 
  Moon, 
  Sun,
  ChevronRight,
  Sparkles,
  User,
  Bot
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { Link } from "wouter";
import { useState, useCallback, useEffect } from "react";
import * as supabaseService from "@/services/supabaseService";

export default function Home() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [conversationMessages, setConversationMessages] = useState<supabaseService.Message[]>([]);

  const handleTranscriptUpdate = useCallback(async (transcript: TranscriptEntry[]) => {
    if (!isAuthenticated || !user || transcript.length === 0) return;
    
    const latestEntry = transcript[transcript.length - 1];
    
    // Create conversation if needed
    if (!currentConversationId && transcript.length === 1) {
      try {
        const conv = await supabaseService.createConversation(
          user.id,
          latestEntry.content.slice(0, 50) + (latestEntry.content.length > 50 ? '...' : '')
        );
        if (conv) {
          setCurrentConversationId(conv.id);
          
          // Add the first message
          const msg = await supabaseService.addMessage(conv.id, latestEntry.role, latestEntry.content);
          if (msg) {
            setConversationMessages([msg]);
          }
        }
      } catch (error) {
        console.error('Failed to create conversation:', error);
      }
    } else if (currentConversationId) {
      // Add message to existing conversation
      try {
        const msg = await supabaseService.addMessage(currentConversationId, latestEntry.role, latestEntry.content);
        if (msg) {
          setConversationMessages(prev => [...prev, msg]);
        }
      } catch (error) {
        console.error('Failed to add message:', error);
      }
    }
  }, [isAuthenticated, user, currentConversationId]);

  const { status, isSessionActive, transcript, error, toggleSession, clearTranscript } = useVoiceAgent(handleTranscriptUpdate);

  const handleNewConversation = () => {
    clearTranscript();
    setCurrentConversationId(null);
    setConversationMessages([]);
  };

  // Sync transcript with conversation messages for display
  useEffect(() => {
    if (transcript.length > 0 && conversationMessages.length === 0) {
      // Show transcript entries while messages are being saved
    }
  }, [transcript, conversationMessages]);

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

  // Combine saved messages and current transcript for display
  const displayMessages = conversationMessages.length > 0 
    ? conversationMessages.map(m => ({ role: m.role, content: m.content, timestamp: new Date(m.created_at) }))
    : transcript;

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
            
            <SignedIn>
              <Link href="/history">
                <Button variant="ghost" className="gap-2">
                  <History className="w-4 h-4" />
                  History
                </Button>
              </Link>
              <UserButton afterSignOutUrl="/" />
            </SignedIn>
            
            <SignedOut>
              <SignInButton mode="modal">
                <Button variant="ghost">Sign In</Button>
              </SignInButton>
              <SignUpButton mode="modal">
                <Button className="gap-2 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700">
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

              <SignedOut>
                <div className="flex flex-col sm:flex-row gap-4">
                  <SignUpButton mode="modal">
                    <Button size="lg" className="w-full sm:w-auto gap-2 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700">
                      Get Started Free
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </SignUpButton>
                  <Button size="lg" variant="outline" className="w-full sm:w-auto">
                    Learn More
                  </Button>
                </div>
              </SignedOut>
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
                      onClick={isAuthenticated ? toggleSession : undefined}
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
                    
                    <SignedOut>
                      <p className="mt-4 text-sm text-muted-foreground text-center">
                        <SignInButton mode="modal">
                          <button className="text-primary hover:underline">Sign in</button>
                        </SignInButton>
                        {" "}to start a voice conversation
                      </p>
                    </SignedOut>
                  </div>

                  {/* Conversation Area - Shows messages under the button */}
                  <SignedIn>
                    <div className="border-t border-border pt-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-muted-foreground">Conversation</h3>
                        {displayMessages.length > 0 && (
                          <Button variant="ghost" size="sm" onClick={handleNewConversation}>
                            New Chat
                          </Button>
                        )}
                      </div>
                      <ScrollArea className="h-64 rounded-lg bg-background/50 p-3">
                        {displayMessages.length === 0 ? (
                          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                            <div className="text-center">
                              <p>Your conversation will appear here.</p>
                              <p className="text-xs mt-1">Press the microphone to start.</p>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <AnimatePresence>
                              {displayMessages.map((msg, index) => (
                                <motion.div
                                  key={index}
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                >
                                  {msg.role === 'assistant' && (
                                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                                      <Bot className="w-3 h-3 text-white" />
                                    </div>
                                  )}
                                  
                                  <div
                                    className={`
                                      max-w-[80%] rounded-xl px-3 py-2 text-sm
                                      ${msg.role === 'user'
                                        ? 'bg-gradient-to-br from-violet-500 to-purple-600 text-white'
                                        : 'bg-muted text-foreground'
                                      }
                                    `}
                                  >
                                    <p className="leading-relaxed">{msg.content}</p>
                                  </div>

                                  {msg.role === 'user' && (
                                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center">
                                      <User className="w-3 h-3 text-white" />
                                    </div>
                                  )}
                                </motion.div>
                              ))}
                            </AnimatePresence>
                          </div>
                        )}
                      </ScrollArea>
                    </div>
                  </SignedIn>
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
