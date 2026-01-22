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
  Filter,
  CheckSquare,
  Square,
  Tag as TagIcon,
  XCircle
} from "lucide-react";
import { Link } from "wouter";
import { useState, useEffect, useRef } from "react";
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
import * as supabaseService from "@/services/supabaseService";
import { TagSelector } from "@/components/TagSelector";
import { TagBadge, TAG_COLORS, type Tag } from "@/components/TagBadge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { SEO, SEO_CONFIG } from "@/components/SEO";

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
  
  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  
  // Title editing state
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  
  // Title regeneration state
  const [regeneratingTitleId, setRegeneratingTitleId] = useState<string | null>(null);

  // Tag filtering state
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null);
  const [isTagFilterOpen, setIsTagFilterOpen] = useState(false);

  // Bulk selection state
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(new Set());
  const [isBulkTagOpen, setIsBulkTagOpen] = useState(false);

  // tRPC queries for tags
  const { data: allTags = [] } = trpc.tags.list.useQuery();
  const utils = trpc.useUtils();

  // tRPC mutations for bulk operations
  const bulkAddTagMutation = trpc.tags.bulkAddToConversations.useMutation({
    onSuccess: () => {
      utils.tags.getForConversation.invalidate();
      setSelectedConversationIds(new Set());
      setIsBulkMode(false);
    },
  });

  const bulkRemoveTagMutation = trpc.tags.bulkRemoveFromConversations.useMutation({
    onSuccess: () => {
      utils.tags.getForConversation.invalidate();
      setSelectedConversationIds(new Set());
      setIsBulkMode(false);
    },
  });

  // Filter conversations by tag query
  const { data: filteredByTag } = trpc.conversations.filterByTag.useQuery(
    { tagId: selectedTagFilter || undefined },
    { enabled: !!selectedTagFilter }
  );

  // tRPC mutations
  const updateTitleMutation = trpc.conversations.updateTitle.useMutation({
    onSuccess: (_, variables) => {
      // Update local state
      setConversations(prev => 
        prev.map(c => c.id === variables.id ? { ...c, title: variables.title } : c)
      );
      if (selectedConversation?.id === variables.id) {
        setSelectedConversation(prev => prev ? { ...prev, title: variables.title } : null);
      }
      setEditingTitleId(null);
    },
    onError: (error) => {
      console.error('Failed to update title:', error);
    }
  });

  const regenerateTitleMutation = trpc.conversations.generateTitle.useMutation({
    onSuccess: (data, variables) => {
      if (data.success && data.title) {
        // Update local state with new title
        setConversations(prev => 
          prev.map(c => c.id === variables.id ? { ...c, title: data.title! } : c)
        );
        if (selectedConversation?.id === variables.id) {
          setSelectedConversation(prev => prev ? { ...prev, title: data.title! } : null);
        }
      }
      setRegeneratingTitleId(null);
    },
    onError: (error) => {
      console.error('Failed to regenerate title:', error);
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

  // Get the base list of conversations (filtered by tag or all)
  const baseConversations = selectedTagFilter && filteredByTag ? filteredByTag : conversations;

  // Filter conversations based on search query
  const filteredConversations = baseConversations.filter(conv => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return conv.title?.toLowerCase().includes(query);
  });

  // Toggle conversation selection for bulk mode
  const toggleConversationSelection = (convId: string) => {
    setSelectedConversationIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(convId)) {
        newSet.delete(convId);
      } else {
        newSet.add(convId);
      }
      return newSet;
    });
  };

  // Select/deselect all visible conversations
  const toggleSelectAll = () => {
    if (selectedConversationIds.size === filteredConversations.length) {
      setSelectedConversationIds(new Set());
    } else {
      setSelectedConversationIds(new Set(filteredConversations.map(c => c.id)));
    }
  };

  // Handle bulk tag apply
  const handleBulkAddTag = (tagId: string) => {
    if (selectedConversationIds.size === 0) return;
    bulkAddTagMutation.mutate({
      conversationIds: Array.from(selectedConversationIds),
      tagId,
    });
    setIsBulkTagOpen(false);
  };

  // Handle bulk tag remove
  const handleBulkRemoveTag = (tagId: string) => {
    if (selectedConversationIds.size === 0) return;
    bulkRemoveTagMutation.mutate({
      conversationIds: Array.from(selectedConversationIds),
      tagId,
    });
    setIsBulkTagOpen(false);
  };

  // Exit bulk mode
  const exitBulkMode = () => {
    setIsBulkMode(false);
    setSelectedConversationIds(new Set());
  };

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
    setSidebarOpen(false); // Close sidebar on mobile when selecting
    
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

  const handleStartEditTitle = (conv: supabaseService.Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTitleId(conv.id);
    setEditingTitleValue(conv.title || '');
  };

  const handleSaveTitle = (convId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (editingTitleValue.trim()) {
      updateTitleMutation.mutate({ id: convId, title: editingTitleValue.trim() });
    } else {
      setEditingTitleId(null);
    }
  };

  const handleCancelEdit = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingTitleId(null);
    setEditingTitleValue("");
  };

  const handleRegenerateTitle = (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRegeneratingTitleId(convId);
    regenerateTitleMutation.mutate({ id: convId });
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent, convId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveTitle(convId);
    } else if (e.key === 'Escape') {
      handleCancelEdit();
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
    <>
      <SEO
        title={SEO_CONFIG.pages.history.title}
        description={SEO_CONFIG.pages.history.description}
        robots={SEO_CONFIG.pages.history.robots}
        canonical="https://plaindr.com/history"
      />
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
        <TooltipProvider>
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
                  <Button
                    variant="ghost"
                    size="icon"
                    className="lg:hidden rounded-full"
                    onClick={() => setSidebarOpen(false)}
                  >
                    <X className="w-5 h-5" />
                  </Button>
                </div>

                {/* Search Bar */}
                <div className="p-3 border-b border-border/30">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="Search conversations..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 pr-4 h-9 rounded-xl bg-muted/30 border-0 focus-visible:ring-1 focus-visible:ring-primary/50"
                    />
                    {searchQuery && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full"
                        onClick={() => setSearchQuery("")}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Tag Filter & Bulk Mode Controls */}
                <div className="px-3 pb-2 space-y-2">
                  <div className="flex items-center gap-2">
                    {/* Tag Filter */}
                    <Popover open={isTagFilterOpen} onOpenChange={setIsTagFilterOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant={selectedTagFilter ? "secondary" : "ghost"}
                          size="sm"
                          className="h-8 gap-1.5 text-xs flex-1"
                        >
                          <Filter className="w-3.5 h-3.5" />
                          {selectedTagFilter ? (
                            <span className="truncate">
                              {allTags.find((t: Tag) => t.id === selectedTagFilter)?.name || 'Filter'}
                            </span>
                          ) : (
                            'Filter by tag'
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-48 p-2" align="start">
                        <div className="space-y-1">
                          <button
                            onClick={() => {
                              setSelectedTagFilter(null);
                              setIsTagFilterOpen(false);
                            }}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left ${
                              !selectedTagFilter ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
                            }`}
                          >
                            <span className="flex-1">All conversations</span>
                            {!selectedTagFilter && <Check className="w-4 h-4" />}
                          </button>
                          {allTags.map((tag: Tag) => {
                            const colors = TAG_COLORS[tag.color] || TAG_COLORS.blue;
                            return (
                              <button
                                key={tag.id}
                                onClick={() => {
                                  setSelectedTagFilter(tag.id);
                                  setIsTagFilterOpen(false);
                                }}
                                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left ${
                                  selectedTagFilter === tag.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
                                }`}
                              >
                                <span className={`w-3 h-3 rounded-full ${colors.bg} ${colors.border} border`} />
                                <span className="flex-1 truncate">{tag.name}</span>
                                {selectedTagFilter === tag.id && <Check className="w-4 h-4" />}
                              </button>
                            );
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>

                    {/* Bulk Mode Toggle */}
                    <Button
                      variant={isBulkMode ? "secondary" : "ghost"}
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => isBulkMode ? exitBulkMode() : setIsBulkMode(true)}
                    >
                      {isBulkMode ? (
                        <><XCircle className="w-3.5 h-3.5" /> Exit</>
                      ) : (
                        <><CheckSquare className="w-3.5 h-3.5" /> Select</>
                      )}
                    </Button>
                  </div>

                  {/* Active Tag Filter Badge */}
                  {selectedTagFilter && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">Filtered:</span>
                      {allTags.filter((t: Tag) => t.id === selectedTagFilter).map((tag: Tag) => (
                        <TagBadge
                          key={tag.id}
                          tag={tag}
                          size="sm"
                          onRemove={() => setSelectedTagFilter(null)}
                        />
                      ))}
                    </div>
                  )}

                  {/* Bulk Mode Actions */}
                  {isBulkMode && (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={toggleSelectAll}
                      >
                        {selectedConversationIds.size === filteredConversations.length && filteredConversations.length > 0 ? (
                          <><CheckSquare className="w-3.5 h-3.5" /> Deselect all</>
                        ) : (
                          <><Square className="w-3.5 h-3.5" /> Select all</>
                        )}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {selectedConversationIds.size} selected
                      </span>
                      {selectedConversationIds.size > 0 && (
                        <Popover open={isBulkTagOpen} onOpenChange={setIsBulkTagOpen}>
                          <PopoverTrigger asChild>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="h-7 text-xs gap-1 ml-auto"
                            >
                              <TagIcon className="w-3.5 h-3.5" />
                              Tag
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-56 p-2" align="end">
                            <div className="space-y-2">
                              <div className="text-xs font-medium text-muted-foreground px-2">Add tag to selected</div>
                              <div className="space-y-1 max-h-32 overflow-y-auto">
                                {allTags.map((tag: Tag) => {
                                  const colors = TAG_COLORS[tag.color] || TAG_COLORS.blue;
                                  return (
                                    <button
                                      key={tag.id}
                                      onClick={() => handleBulkAddTag(tag.id)}
                                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-muted transition-colors text-left"
                                    >
                                      <span className={`w-3 h-3 rounded-full ${colors.bg} ${colors.border} border`} />
                                      <span className="flex-1 truncate">{tag.name}</span>
                                      <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                                    </button>
                                  );
                                })}
                              </div>
                              {allTags.length > 0 && (
                                <>
                                  <div className="border-t" />
                                  <div className="text-xs font-medium text-muted-foreground px-2">Remove tag from selected</div>
                                  <div className="space-y-1 max-h-32 overflow-y-auto">
                                    {allTags.map((tag: Tag) => {
                                      const colors = TAG_COLORS[tag.color] || TAG_COLORS.blue;
                                      return (
                                        <button
                                          key={tag.id}
                                          onClick={() => handleBulkRemoveTag(tag.id)}
                                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-destructive/10 hover:text-destructive transition-colors text-left"
                                        >
                                          <span className={`w-3 h-3 rounded-full ${colors.bg} ${colors.border} border`} />
                                          <span className="flex-1 truncate">{tag.name}</span>
                                          <X className="w-3.5 h-3.5" />
                                        </button>
                                      );
                                    })}
                                  </div>
                                </>
                              )}
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  )}
                </div>

                {/* New Conversation Button */}
                <div className="px-3 pb-3">
                  <Link href="/">
                    <Button className="w-full gap-2 btn-gradient rounded-xl">
                      <Plus className="w-4 h-4" />
                      New Conversation
                    </Button>
                  </Link>
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
                      {searchQuery ? (
                        <>
                          <p className="text-sm font-medium">No matches found</p>
                          <p className="text-xs mt-1 opacity-70">Try a different search term</p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-medium">No conversations yet</p>
                          <p className="text-xs mt-1 opacity-70">Start a voice session to create one</p>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="p-2 space-y-1">
                      {filteredConversations.map((conv) => (
                        <motion.div
                          key={conv.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          className={`
                            group relative flex items-center gap-2 sm:gap-3 p-3 rounded-xl cursor-pointer
                            transition-all duration-200
                            ${selectedConversation?.id === conv.id 
                              ? 'bg-primary/10 border border-primary/20' 
                              : 'hover:bg-muted/50'
                            }
                            ${isBulkMode && selectedConversationIds.has(conv.id) ? 'bg-primary/5' : ''}
                          `}
                          onClick={() => isBulkMode ? toggleConversationSelection(conv.id) : handleSelectConversation(conv)}
                        >
                          {isBulkMode ? (
                            <div 
                              className="flex-shrink-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleConversationSelection(conv.id);
                              }}
                            >
                              {selectedConversationIds.has(conv.id) ? (
                                <CheckSquare className="w-4 h-4 text-primary" />
                              ) : (
                                <Square className="w-4 h-4 text-muted-foreground" />
                              )}
                            </div>
                          ) : (
                            <MessageSquare className={`w-4 h-4 flex-shrink-0 ${selectedConversation?.id === conv.id ? 'text-primary' : 'text-muted-foreground'}`} />
                          )}
                          <div className="flex-1 min-w-0">
                            {editingTitleId === conv.id ? (
                              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <Input
                                  ref={titleInputRef}
                                  type="text"
                                  value={editingTitleValue}
                                  onChange={(e) => setEditingTitleValue(e.target.value)}
                                  onKeyDown={(e) => handleTitleKeyDown(e, conv.id)}
                                  onBlur={() => handleSaveTitle(conv.id)}
                                  className="h-6 text-sm px-1 py-0 border-0 bg-background/50 focus-visible:ring-1"
                                  disabled={updateTitleMutation.isPending}
                                />
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 rounded-full"
                                  onClick={(e) => handleSaveTitle(conv.id, e)}
                                  disabled={updateTitleMutation.isPending}
                                >
                                  {updateTitleMutation.isPending ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Check className="w-3 h-3 text-green-500" />
                                  )}
                                </Button>
                              </div>
                            ) : (
                              <p className="text-sm font-medium truncate">
                                {conv.title || 'Untitled Conversation'}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              <Clock className="w-3 h-3" />
                              {formatDate(conv.updated_at)}
                            </p>
                          </div>
                          
                          {/* Action buttons - only show when not editing */}
                          {editingTitleId !== conv.id && (
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 rounded-full flex-shrink-0"
                                    onClick={(e) => handleStartEditTitle(conv, e)}
                                  >
                                    <Pencil className="w-3 h-3 text-muted-foreground" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <p>Edit title</p>
                                </TooltipContent>
                              </Tooltip>
                              
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 rounded-full flex-shrink-0"
                                    onClick={(e) => handleRegenerateTitle(conv.id, e)}
                                    disabled={regeneratingTitleId === conv.id}
                                  >
                                    {regeneratingTitleId === conv.id ? (
                                      <Loader2 className="w-3 h-3 animate-spin text-primary" />
                                    ) : (
                                      <RefreshCw className="w-3 h-3 text-muted-foreground" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <p>Regenerate AI title</p>
                                </TooltipContent>
                              </Tooltip>
                              
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 rounded-full flex-shrink-0"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDeleteId(conv.id);
                                    }}
                                  >
                                    <Trash2 className="w-3 h-3 text-destructive" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <p>Delete conversation</p>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          )}
                        </motion.div>
                      ))}
                    </div>
                  )}
                </ScrollArea>

                {/* Sidebar Footer */}
                <div className="p-3 border-t border-border/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <UserButton afterSignOutUrl="/" />
                      <Link href="/profile">
                        <Button variant="ghost" size="icon" className="rounded-full h-8 w-8">
                          <User className="w-4 h-4" />
                        </Button>
                      </Link>
                    </div>
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
              <header className="flex items-center gap-2 sm:gap-3 p-3 sm:p-4 border-b border-border/50 bg-background/80 backdrop-blur-sm">
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden rounded-full h-8 w-8 sm:h-9 sm:w-9 flex-shrink-0"
                  onClick={() => setSidebarOpen(true)}
                >
                  <Menu className="w-4 h-4 sm:w-5 sm:h-5" />
                </Button>
                
                <Link href="/" className="lg:hidden flex-shrink-0">
                  <Button variant="ghost" size="icon" className="rounded-full h-8 w-8 sm:h-9 sm:w-9">
                    <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
                  </Button>
                </Link>

                {selectedConversation ? (
                  <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <h1 className="font-semibold truncate text-sm sm:text-base">
                          {selectedConversation.title || 'Untitled Conversation'}
                        </h1>
                        <p className="text-xs text-muted-foreground">
                          {new Date(selectedConversation.created_at).toLocaleDateString([], {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </p>
                      </div>
                      <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 sm:h-8 sm:w-8 rounded-full"
                              onClick={(e) => handleStartEditTitle(selectedConversation, e)}
                            >
                              <Pencil className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Edit title</p>
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 sm:h-8 sm:w-8 rounded-full"
                              onClick={(e) => handleRegenerateTitle(selectedConversation.id, e)}
                              disabled={regeneratingTitleId === selectedConversation.id}
                            >
                              {regeneratingTitleId === selectedConversation.id ? (
                                <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" />
                              ) : (
                                <RefreshCw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Regenerate AI title</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                    {/* Tags section */}
                    <div className="flex-shrink-0">
                      <TagSelector conversationId={selectedConversation.id} />
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
                            className={`flex gap-2 sm:gap-4 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
                          >
                            <div className={`
                              flex-shrink-0 w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center
                              ${message.role === 'user' 
                                ? 'bg-gradient-to-br from-violet-500 to-purple-600' 
                                : 'bg-gradient-to-br from-gray-600 to-gray-700 dark:from-gray-500 dark:to-gray-600'
                              }
                            `}>
                              {message.role === 'user' 
                                ? <User className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
                                : <Bot className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
                              }
                            </div>
                            
                            <div className={`flex-1 max-w-[90%] sm:max-w-[85%] ${message.role === 'user' ? 'text-right' : ''}`}>
                              <div
                                className={`
                                  inline-block rounded-2xl px-3 py-2 sm:px-4 sm:py-3 text-left
                                  ${message.role === 'user'
                                    ? 'bg-gradient-to-br from-violet-500 to-purple-600 text-white'
                                    : 'bg-muted/50 dark:bg-muted/30'
                                  }
                                `}
                              >
                                <p className="text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words">{message.content}</p>
                              </div>
                              <p className={`text-[10px] sm:text-xs mt-1 sm:mt-1.5 text-muted-foreground`}>
                                {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                          </motion.div>
                        ))
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
        </TooltipProvider>
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
              onClick={handleDeleteConversation}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-full"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </>
  );
}
