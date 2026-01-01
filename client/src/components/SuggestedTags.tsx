import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Plus, Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { TagBadge } from "./TagBadge";

interface TagSuggestion {
  name: string;
  confidence: number;
  reason: string;
  existingTagId: string | null;
  existingTagColor: string | null;
  isNew: boolean;
}

interface SuggestedTagsProps {
  conversationId: string;
  onTagAdded?: () => void;
}

export function SuggestedTags({ conversationId, onTagAdded }: SuggestedTagsProps) {
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [appliedTags, setAppliedTags] = useState<Set<string>>(new Set());

  const utils = trpc.useUtils();

  const suggestMutation = trpc.tags.suggestForConversation.useMutation({
    onSuccess: (data) => {
      if (data.success && data.suggestions.length > 0) {
        setSuggestions(data.suggestions);
      } else if (!data.success) {
        toast.error(data.error || "Could not generate suggestions");
      } else {
        toast.info("No tag suggestions for this conversation");
      }
      setHasLoaded(true);
      setIsLoading(false);
    },
    onError: (error) => {
      toast.error(`Failed to get suggestions: ${error.message}`);
      setIsLoading(false);
    }
  });

  const createTagMutation = trpc.tags.create.useMutation();
  const addTagMutation = trpc.tags.addToConversation.useMutation();

  const handleGetSuggestions = () => {
    setIsLoading(true);
    setSuggestions([]);
    setAppliedTags(new Set());
    suggestMutation.mutate({ conversationId });
  };

  const handleApplySuggestion = async (suggestion: TagSuggestion) => {
    try {
      let tagId = suggestion.existingTagId;

      // If it's a new tag, create it first
      if (suggestion.isNew) {
        const newTag = await createTagMutation.mutateAsync({
          name: suggestion.name,
          color: getRandomColor()
        });
        tagId = newTag.id;
      }

      if (tagId) {
        await addTagMutation.mutateAsync({
          conversationId,
          tagId
        });

        setAppliedTags(prev => new Set(Array.from(prev).concat(suggestion.name)));
        toast.success(`Tag "${suggestion.name}" added`);
        
        // Invalidate queries to refresh the UI
        utils.tags.list.invalidate();
        utils.tags.getForConversation.invalidate({ conversationId });
        onTagAdded?.();
      }
    } catch (error) {
      toast.error(`Failed to apply tag: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleDismissSuggestion = (name: string) => {
    setSuggestions(prev => prev.filter(s => s.name !== name));
  };

  // Generate a random color for new tags
  const getRandomColor = () => {
    const colors = [
      '#8B5CF6', '#EC4899', '#3B82F6', '#10B981', '#F59E0B',
      '#EF4444', '#6366F1', '#14B8A6', '#F97316', '#84CC16'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  };

  return (
    <div className="space-y-2">
      {/* Get Suggestions Button */}
      {!hasLoaded && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleGetSuggestions}
          disabled={isLoading}
          className="w-full gap-2 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-800 hover:bg-purple-50 dark:hover:bg-purple-950"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing conversation...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Suggest Tags with AI
            </>
          )}
        </Button>
      )}

      {/* Suggestions List */}
      <AnimatePresence mode="popLayout">
        {suggestions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-2"
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="h-3 w-3" />
              <span>AI Suggested Tags</span>
            </div>
            
            <div className="flex flex-wrap gap-2">
              {suggestions.map((suggestion) => {
                const isApplied = appliedTags.has(suggestion.name);
                
                return (
                  <motion.div
                    key={suggestion.name}
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="group relative"
                  >
                    <div className="flex items-center gap-1 bg-purple-50 dark:bg-purple-950/50 rounded-full pl-1 pr-1 py-0.5 border border-purple-200 dark:border-purple-800">
                      <TagBadge
                        name={suggestion.name}
                        color={suggestion.existingTagColor || '#8B5CF6'}
                        size="sm"
                      />
                      
                      {!isApplied ? (
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={() => handleApplySuggestion(suggestion)}
                            className="p-0.5 rounded-full hover:bg-green-100 dark:hover:bg-green-900 text-green-600 dark:text-green-400 transition-colors"
                            title={`Add "${suggestion.name}"`}
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => handleDismissSuggestion(suggestion.name)}
                            className="p-0.5 rounded-full hover:bg-red-100 dark:hover:bg-red-900 text-red-600 dark:text-red-400 transition-colors"
                            title="Dismiss"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="p-0.5 text-green-600 dark:text-green-400">
                          <Check className="h-3 w-3" />
                        </div>
                      )}
                    </div>
                    
                    {/* Tooltip with reason */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-popover text-popover-foreground text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10 max-w-[200px] truncate">
                      {suggestion.reason}
                      {suggestion.isNew && (
                        <span className="ml-1 text-purple-500">(new tag)</span>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* Refresh button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleGetSuggestions}
              disabled={isLoading}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {isLoading ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Sparkles className="h-3 w-3 mr-1" />
              )}
              Get new suggestions
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty state after loading */}
      {hasLoaded && suggestions.length === 0 && !isLoading && (
        <div className="text-center py-2">
          <p className="text-xs text-muted-foreground">No suggestions available</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleGetSuggestions}
            className="text-xs mt-1"
          >
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
