import { useAuth, SignedIn, SignedOut } from "@/contexts/ClerkContext";
import { SignInButton, UserButton } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ArrowLeft, 
  MessageSquare, 
  Trash2, 
  Clock, 
  User, 
  Bot,
  Sparkles,
  Moon,
  Sun,
  ChevronRight,
  Loader2
} from "lucide-react";
import { Link } from "wouter";
import { useState, useEffect } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import * as supabaseService from "@/services/supabaseService";

export default function History() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [selectedConversation, setSelectedConversation] = useState<supabaseService.Conversation | null>(null);
  const [conversations, setConversations] = useState<supabaseService.Conversation[]>([]);
  const [messages, setMessages] = useState<supabaseService.Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Fetch conversations when authenticated
  useEffect(() => {
    async function fetchConversations() {
      if (!isAuthenticated || !user) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const convs = await supabaseService.getConversations(user.id);
        setConversations(convs);
      } catch (error) {
        console.error('Failed to fetch conversations:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchConversations();
  }, [isAuthenticated, user]);

  // Fetch messages when a conversation is selected
  const handleSelectConversation = async (conversation: supabaseService.Conversation) => {
    setSelectedConversation(conversation);
    setIsLoadingMessages(true);
    
    try {
      const result = await supabaseService.getConversationWithMessages(conversation.id);
      if (result) {
        setMessages(result.messages);
      }
    } catch (error) {
      console.error('Failed to fetch messages:', error);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const handleDeleteConversation = async () => {
    if (!deleteId) return;
    
    try {
      const success = await supabaseService.deleteConversation(deleteId);
      if (success) {
        setConversations(prev => prev.filter(c => c.id !== deleteId));
        if (selectedConversation?.id === deleteId) {
          setSelectedConversation(null);
          setMessages([]);
        }
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    } finally {
      setDeleteId(null);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-mesh-gradient flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const formatDate = (date: Date | string) => {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return d.toLocaleDateString([], { weekday: 'long' });
    } else {
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  return (
    <div className="min-h-screen bg-mesh-gradient">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 glass-nav">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon" className="rounded-full">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <span className="font-semibold text-lg">Conversation History</span>
            </div>
          </div>
          
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
              <UserButton afterSignOutUrl="/" />
            </SignedIn>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="pt-24 pb-8 container">
        <SignedOut>
          <Card className="glass-strong border-0 max-w-md mx-auto rounded-2xl">
            <CardContent className="p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mx-auto mb-6 shadow-lg">
                <MessageSquare className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Sign in to view history</h2>
              <p className="text-muted-foreground mb-6">
                Access your conversation history by signing in to your account.
              </p>
              <SignInButton mode="modal">
                <Button className="w-full gap-2 btn-gradient rounded-full">
                  Sign In
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </SignInButton>
            </CardContent>
          </Card>
        </SignedOut>

        <SignedIn>
          <div className="grid lg:grid-cols-3 gap-6 h-[calc(100vh-8rem)]">
            {/* Conversations List */}
            <Card className="glass-strong border-0 lg:col-span-1 rounded-2xl overflow-hidden">
              <CardHeader className="pb-3 border-b border-border/30">
                <CardTitle className="text-lg flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-primary" />
                  Conversations
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[calc(100vh-14rem)]">
                  {isLoading ? (
                    <div className="p-4 space-y-3">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-20 rounded-xl bg-muted/30 animate-pulse" />
                      ))}
                    </div>
                  ) : conversations.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-violet-500/20 to-purple-600/20 flex items-center justify-center">
                        <MessageSquare className="w-8 h-8 text-primary/50" />
                      </div>
                      <p className="font-medium">No conversations yet</p>
                      <p className="text-sm mt-1 opacity-70">Start a voice session to create one</p>
                    </div>
                  ) : (
                    <div className="p-2">
                      <AnimatePresence>
                        {conversations.map((conv) => (
                          <motion.div
                            key={conv.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            className={`
                              group relative p-4 rounded-xl cursor-pointer transition-all duration-200 mb-2
                              ${selectedConversation?.id === conv.id 
                                ? 'glass border border-primary/30 shadow-lg' 
                                : 'hover:bg-muted/30'
                              }
                            `}
                            onClick={() => handleSelectConversation(conv)}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <h3 className="font-medium truncate">
                                  {conv.title || 'Untitled Conversation'}
                                </h3>
                                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                  <Clock className="w-3 h-3" />
                                  {formatDate(conv.updated_at)}
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 rounded-full"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteId(conv.id);
                                }}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Conversation Detail */}
            <Card className="glass-strong border-0 lg:col-span-2 rounded-2xl overflow-hidden">
              <CardContent className="p-0 h-full">
                {selectedConversation ? (
                  <div className="h-full flex flex-col">
                    <div className="p-4 border-b border-border/30">
                      <h2 className="font-semibold text-lg">
                        {selectedConversation.title || 'Untitled Conversation'}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {new Date(selectedConversation.created_at).toLocaleDateString([], {
                          weekday: 'long',
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </p>
                    </div>
                    <ScrollArea className="flex-1 h-[calc(100vh-16rem)]">
                      <div className="p-4">
                      {isLoadingMessages ? (
                        <div className="flex items-center justify-center py-12">
                          <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        </div>
                      ) : messages.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                          <p>No messages in this conversation</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {messages.map((message) => (
                            <motion.div
                              key={message.id}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                              {message.role === 'assistant' && (
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-md">
                                  <Bot className="w-4 h-4 text-white" />
                                </div>
                              )}
                              
                              <div
                                className={`
                                  max-w-[80%] rounded-2xl px-4 py-3
                                  ${message.role === 'user'
                                    ? 'bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg'
                                    : 'glass'
                                  }
                                `}
                              >
                                <p className="text-sm leading-relaxed">{message.content}</p>
                                <p className={`text-xs mt-1 ${message.role === 'user' ? 'text-white/60' : 'text-muted-foreground/60'}`}>
                                  {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </p>
                              </div>

                              {message.role === 'user' && (
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-md">
                                  <User className="w-4 h-4 text-white" />
                                </div>
                              )}
                            </motion.div>
                          ))}
                        </div>
                      )}
                      </div>
                    </ScrollArea>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-gradient-to-br from-violet-500/10 to-purple-600/10 flex items-center justify-center">
                        <MessageSquare className="w-12 h-12 text-primary/30" />
                      </div>
                      <p className="font-medium">Select a conversation to view details</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </SignedIn>
      </main>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent className="glass-strong border-0 rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Conversation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this conversation? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-full"
              onClick={handleDeleteConversation}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
