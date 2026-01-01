import { useAuth, SignedIn, SignedOut } from "@/contexts/ClerkContext";
import { SignInButton, UserButton } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
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
  Loader2,
  Menu,
  X,
  Plus,
  Search,
  Pencil,
  Check,
  RefreshCw,
  Settings,
  Tag,
  Filter
} from "lucide-react";
import { Link } from "wouter";
import { useState, useEffect, useRef, useMemo } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import * as supabaseService from "@/services/supabaseService";
import { toast } from "sonner";
import { TagBadge } from "@/components/TagBadge";
import { TagSelector } from "@/components/TagSelector";
import { TagManager } from "@/components/TagManager";
import { SuggestedTags } from "@/components/SuggestedTags";

interface TagType {
  id: string;
  name: string;
  color: string;
}

export default function History() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [selectedConversation, setSelectedConversation] = useState<supabaseService.Conversation | null>(null);
  const [conversations, setConversations] = useState<supabaseService.Conversation[]>([]);
  const [messages, setMessages] = useState<supabaseService.Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Search and filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFilterTags, setSelectedFilterTags] = useState<string[]>([]);
  const [conversationTags, setConversationTags] = useState<Record<string, TagType[]>>({});
  
  // Title editing state
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  
  // Title regeneration state
  const [regeneratingTitleId, setRegeneratingTitleId] = useState<string | null>(null);

  // Fetch all tags
  const { data: allTags = [], refetch: refetchTags } = trpc.tags.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // tRPC mutations
  const updateTitleMutation = trpc.conversations.updateTitle.useMutation({
    onSuccess: (_, variables) => {
      setConversations(prev => 
        prev.map(c => c.id === variables.id ? { ...c, title: variables.title } : c)
      );
      if (selectedConversation?.id === variables.id) {
        setSelectedConversation(prev => prev ? { ...prev, title: variables.title } : null);
      }
      setEditingTitleId(null);
      toast.success('Title updated!');
    },
    onError: (error) => {
      console.error('Failed to update title:', error);
      toast.error('Failed to update title');
    }
  });

  const regenerateTitleMutation = trpc.conversations.generateTitle.useMutation({
    onSuccess: (data, variables) => {
      if (data.success && data.title) {
        setConversations(prev => 
          prev.map(c => c.id === variables.id ? { ...c, title: data.title! } : c)
        );
        if (selectedConversation?.id === variables.id) {
          setSelectedConversation(prev => prev ? { ...prev, title: data.title! } : null);
        }
        toast.success('Title regenerated!', {
          description: `New title: "${data.title}"`
        });
      } else if (data.reason) {
        toast.info('Could not regenerate title', {
          description: data.reason
        });
      }
      setRegeneratingTitleId(null);
    },
    onError: (error) => {
      console.error('Failed to regenerate title:', error);
      toast.error('Failed to regenerate title', {
        description: 'Please try again later'
      });
      setRegeneratingTitleId(null);
    }
  });

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

  // Fetch tags for all conversations
  useEffect(() => {
    async function fetchAllConversationTags() {
      if (!conversations.length) return;
      
      const tagsMap: Record<string, TagType[]> = {};
      for (const conv of conversations) {
        try {
          const response = await fetch(`/api/trpc/tags.getForConversation?input=${encodeURIComponent(JSON.stringify({ conversationId: conv.id }))}`);
          const result = await response.json();
          if (result.result?.data) {
            tagsMap[conv.id] = result.result.data;
          }
        } catch (error) {
          console.error('Failed to fetch tags for conversation:', conv.id, error);
        }
      }
      setConversationTags(tagsMap);
    }

    fetchAllConversationTags();
  }, [conversations]);

  // Filter conversations based on search query and selected tags
  const filteredConversations = useMemo(() => {
    return conversations.filter(conv => {
      // Search filter
      const matchesSearch = !searchQuery || 
        (conv.title?.toLowerCase().includes(searchQuery.toLowerCase()));
      
      // Tag filter
      const convTags = conversationTags[conv.id] || [];
      const matchesTags = selectedFilterTags.length === 0 || 
        selectedFilterTags.some(tagId => convTags.some(t => t.id === tagId));
      
      return matchesSearch && matchesTags;
    });
  }, [conversations, searchQuery, selectedFilterTags, conversationTags]);

  // Focus input when editing starts
  useEffect(() => {
    if (editingTitleId && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitleId]);

  // Fetch messages when a conversation is selected
  const handleSelectConversation = async (conversation: supabaseService.Conversation) => {
    setSelectedConversation(conversation);
    setIsLoadingMessages(true);
    setSidebarOpen(false);
    
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
        toast.success('Conversation deleted');
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      toast.error('Failed to delete conversation');
    } finally {
      setDeleteId(null);
    }
  };

  const handleStartEditTitle = (conv: supabaseService.Conversation) => {
    setEditingTitleId(conv.id);
    setEditingTitleValue(conv.title || '');
  };

  const handleSaveTitle = () => {
    if (!editingTitleId || !editingTitleValue.trim()) {
      setEditingTitleId(null);
      return;
    }
    updateTitleMutation.mutate({ id: editingTitleId, title: editingTitleValue.trim() });
  };

  const handleRegenerateTitle = (convId: string) => {
    setRegeneratingTitleId(convId);
    regenerateTitleMutation.mutate({ id: convId });
  };

  const handleTagsChange = async (conversationId: string) => {
    try {
      const response = await fetch(`/api/trpc/tags.getForConversation?input=${encodeURIComponent(JSON.stringify({ conversationId }))}`);
      const result = await response.json();
      if (result.result?.data) {
        setConversationTags(prev => ({
          ...prev,
          [conversationId]: result.result.data,
        }));
      }
    } catch (error) {
      console.error('Failed to refresh tags:', error);
    }
  };

  const toggleFilterTag = (tagId: string) => {
    setSelectedFilterTags(prev => 
      prev.includes(tagId) 
        ? prev.filter(id => id !== tagId)
        : [...prev, tagId]
    );
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
    <TooltipProvider>
      <div className="min-h-screen bg-mesh-gradient flex flex-col">
        <SignedOut>
          {/* Header for signed out state */}
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
              </div>
            </div>
          </header>

          <main className="pt-24 pb-8 container flex-1">
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
          </main>
        </SignedOut>

        <SignedIn>
          <div className="flex h-screen overflow-hidden">
            {/* Mobile Overlay */}
            <AnimatePresence>
              {sidebarOpen && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-black/50 z-40 lg:hidden"
                  onClick={() => setSidebarOpen(false)}
                />
              )}
            </AnimatePresence>

            {/* Sidebar */}
            <aside
              className={`
                fixed lg:relative inset-y-0 left-0 z-50 w-72 lg:w-80
                bg-background/95 backdrop-blur-xl border-r border-border/50
                transform transition-transform duration-300 ease-in-out
                lg:transform-none
                ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
              `}
            >
              <div className="flex flex-col h-full">
                {/* Sidebar Header */}
                <div className="flex items-center justify-between p-4 border-b border-border/50">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
                      <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <span className="font-semibold">Conversations</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <TagManager
                      trigger={
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                          <Settings className="w-4 h-4" />
                        </Button>
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="lg:hidden rounded-full h-8 w-8"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <X className="w-5 h-5" />
                    </Button>
                  </div>
                </div>

                {/* New Conversation Button */}
                <div className="p-3">
                  <Link href="/">
                    <Button className="w-full gap-2 btn-gradient rounded-xl">
                      <Plus className="w-4 h-4" />
                      New Conversation
                    </Button>
                  </Link>
                </div>

                {/* Search and Filter */}
                <div className="px-3 pb-2 space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search conversations..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 h-9 rounded-xl bg-muted/50 border-0"
                    />
                  </div>
                  
                  {/* Tag Filter */}
                  {allTags.length > 0 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className={`w-full justify-start gap-2 h-8 rounded-lg ${selectedFilterTags.length > 0 ? 'border-primary' : ''}`}
                        >
                          <Filter className="w-3.5 h-3.5" />
                          <span className="text-xs">
                            {selectedFilterTags.length > 0 
                              ? `${selectedFilterTags.length} tag${selectedFilterTags.length > 1 ? 's' : ''} selected`
                              : 'Filter by tags'
                            }
                          </span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-2" align="start">
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground px-2 pb-1">Select tags to filter</p>
                          {allTags.map(tag => (
                            <button
                              key={tag.id}
                              onClick={() => toggleFilterTag(tag.id)}
                              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm transition-colors ${
                                selectedFilterTags.includes(tag.id) 
                                  ? 'bg-primary/10 text-primary' 
                                  : 'hover:bg-accent'
                              }`}
                            >
                              <span
                                className="w-3 h-3 rounded-full flex-shrink-0"
                                style={{ backgroundColor: tag.color }}
                              />
                              <span className="truncate flex-1">{tag.name}</span>
                              {selectedFilterTags.includes(tag.id) && (
                                <span className="text-xs">✓</span>
                              )}
                            </button>
                          ))}
                          {selectedFilterTags.length > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="w-full h-7 text-xs mt-1"
                              onClick={() => setSelectedFilterTags([])}
                            >
                              Clear filters
                            </Button>
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>

                {/* Conversations List */}
                <ScrollArea className="flex-1">
                  {isLoading ? (
                    <div className="p-3 space-y-2">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-16 rounded-xl bg-muted/30 animate-pulse" />
                      ))}
                    </div>
                  ) : filteredConversations.length === 0 ? (
                    <div className="p-6 text-center text-muted-foreground">
                      <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm font-medium">
                        {searchQuery || selectedFilterTags.length > 0 
                          ? 'No matching conversations' 
                          : 'No conversations yet'
                        }
                      </p>
                      <p className="text-xs mt-1 opacity-70">
                        {searchQuery || selectedFilterTags.length > 0 
                          ? 'Try adjusting your filters' 
                          : 'Start a voice session to create one'
                        }
                      </p>
                    </div>
                  ) : (
                    <div className="p-2 space-y-1">
                      {filteredConversations.map((conv) => {
                        const tags = conversationTags[conv.id] || [];
                        const isEditing = editingTitleId === conv.id;
                        const isRegenerating = regeneratingTitleId === conv.id;
                        
                        return (
                          <motion.div
                            key={conv.id}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            className={`
                              group relative flex flex-col gap-1 p-3 rounded-xl cursor-pointer
                              transition-all duration-200
                              ${selectedConversation?.id === conv.id 
                                ? 'bg-primary/10 border border-primary/20' 
                                : 'hover:bg-muted/50'
                              }
                            `}
                            onClick={() => !isEditing && handleSelectConversation(conv)}
                          >
                            <div className="flex items-center gap-3">
                              <MessageSquare className={`w-4 h-4 flex-shrink-0 ${selectedConversation?.id === conv.id ? 'text-primary' : 'text-muted-foreground'}`} />
                              <div className="flex-1 min-w-0">
                                {isEditing ? (
                                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                    <Input
                                      ref={titleInputRef}
                                      value={editingTitleValue}
                                      onChange={(e) => setEditingTitleValue(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleSaveTitle();
                                        if (e.key === 'Escape') setEditingTitleId(null);
                                      }}
                                      className="h-6 text-sm px-1 py-0"
                                    />
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6"
                                      onClick={handleSaveTitle}
                                    >
                                      <Check className="w-3 h-3" />
                                    </Button>
                                  </div>
                                ) : (
                                  <>
                                    <p className="text-sm font-medium truncate">
                                      {conv.title || 'Untitled Conversation'}
                                    </p>
                                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Clock className="w-3 h-3" />
                                      {formatDate(conv.updated_at)}
                                    </p>
                                  </>
                                )}
                              </div>
                              
                              {/* Action buttons */}
                              {!isEditing && (
                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 rounded-full"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleStartEditTitle(conv);
                                        }}
                                      >
                                        <Pencil className="w-3 h-3" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Edit title</TooltipContent>
                                  </Tooltip>
                                  
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 rounded-full"
                                        disabled={isRegenerating}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleRegenerateTitle(conv.id);
                                        }}
                                      >
                                        <RefreshCw className={`w-3 h-3 ${isRegenerating ? 'animate-spin' : ''}`} />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Regenerate title</TooltipContent>
                                  </Tooltip>
                                  
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 rounded-full"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setDeleteId(conv.id);
                                        }}
                                      >
                                        <Trash2 className="w-3 h-3 text-destructive" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Delete</TooltipContent>
                                  </Tooltip>
                                </div>
                              )}
                            </div>
                            
                            {/* Tags row */}
                            {tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 ml-7">
                                {tags.slice(0, 3).map(tag => (
                                  <TagBadge
                                    key={tag.id}
                                    name={tag.name}
                                    color={tag.color}
                                    size="sm"
                                  />
                                ))}
                                {tags.length > 3 && (
                                  <span className="text-xs text-muted-foreground px-1">
                                    +{tags.length - 3}
                                  </span>
                                )}
                              </div>
                            )}
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>

                {/* Sidebar Footer */}
                <div className="p-3 border-t border-border/50">
                  <div className="flex items-center justify-between">
                    <UserButton afterSignOutUrl="/" />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={toggleTheme}
                      className="rounded-full"
                    >
                      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            </aside>

            {/* Main Chat Area */}
            <main className="flex-1 flex flex-col min-w-0">
              {/* Chat Header */}
              <header className="flex items-center gap-3 p-4 border-b border-border/50 bg-background/80 backdrop-blur-sm">
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden rounded-full"
                  onClick={() => setSidebarOpen(true)}
                >
                  <Menu className="w-5 h-5" />
                </Button>
                
                <Link href="/" className="lg:hidden">
                  <Button variant="ghost" size="icon" className="rounded-full">
                    <ArrowLeft className="w-5 h-5" />
                  </Button>
                </Link>

                {selectedConversation ? (
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h1 className="font-semibold truncate">
                        {selectedConversation.title || 'Untitled Conversation'}
                      </h1>
                      <TagSelector
                        conversationId={selectedConversation.id}
                        selectedTags={conversationTags[selectedConversation.id] || []}
                        onTagsChange={() => handleTagsChange(selectedConversation.id)}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-muted-foreground">
                        {new Date(selectedConversation.created_at).toLocaleDateString([], {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                      {(conversationTags[selectedConversation.id] || []).length > 0 && (
                        <div className="flex gap-1">
                          {(conversationTags[selectedConversation.id] || []).map(tag => (
                            <TagBadge
                              key={tag.id}
                              name={tag.name}
                              color={tag.color}
                              size="sm"
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1">
                    <h1 className="font-semibold">Conversation History</h1>
                    <p className="text-xs text-muted-foreground">Select a conversation to view</p>
                  </div>
                )}

                <div className="hidden lg:flex items-center gap-2">
                  <Link href="/">
                    <Button variant="ghost" size="icon" className="rounded-full">
                      <ArrowLeft className="w-5 h-5" />
                    </Button>
                  </Link>
                </div>
              </header>

              {/* Chat Messages */}
              <div className="flex-1 overflow-hidden">
                {selectedConversation ? (
                  <ScrollArea className="h-full">
                    <div className="max-w-3xl mx-auto p-4 space-y-6">
                      {isLoadingMessages ? (
                        <div className="flex items-center justify-center py-12">
                          <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        </div>
                      ) : messages.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                          <p>No messages in this conversation</p>
                        </div>
                      ) : (
                        messages.map((message) => (
                          <motion.div
                            key={message.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`flex gap-4 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
                          >
                            <div className={`
                              flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center
                              ${message.role === 'user' 
                                ? 'bg-gradient-to-br from-violet-500 to-purple-600' 
                                : 'bg-gradient-to-br from-gray-600 to-gray-700 dark:from-gray-500 dark:to-gray-600'
                              }
                            `}>
                              {message.role === 'user' 
                                ? <User className="w-4 h-4 text-white" />
                                : <Bot className="w-4 h-4 text-white" />
                              }
                            </div>
                            
                            <div className={`flex-1 max-w-[85%] ${message.role === 'user' ? 'text-right' : ''}`}>
                              <div
                                className={`
                                  inline-block rounded-2xl px-4 py-3 text-left
                                  ${message.role === 'user'
                                    ? 'bg-gradient-to-br from-violet-500 to-purple-600 text-white'
                                    : 'bg-muted/50 dark:bg-muted/30'
                                  }
                                `}
                              >
                                <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                              </div>
                              <p className={`text-xs mt-1.5 text-muted-foreground`}>
                                {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                          </motion.div>
                        ))
                      )}
                      
                      {/* AI Tag Suggestions */}
                      {selectedConversation && messages.length > 0 && (
                        <div className="mt-6 pt-4 border-t border-border/30">
                          <SuggestedTags
                            conversationId={selectedConversation.id}
                            onTagAdded={() => handleTagsChange(selectedConversation.id)}
                          />
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    <div className="text-center p-8">
                      <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-violet-500/10 to-purple-600/10 flex items-center justify-center">
                        <MessageSquare className="w-10 h-10 text-primary/30" />
                      </div>
                      <p className="font-medium mb-1">Select a conversation</p>
                      <p className="text-sm opacity-70">Choose from the sidebar or start a new one</p>
                      <Link href="/">
                        <Button className="mt-4 gap-2 btn-gradient rounded-full">
                          <Plus className="w-4 h-4" />
                          New Conversation
                        </Button>
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </main>
          </div>
        </SignedIn>

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
    </TooltipProvider>
  );
}
