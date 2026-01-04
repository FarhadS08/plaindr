import { useState } from "react";
import { Plus, Tag as TagIcon, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { trpc } from "@/lib/trpc";
import { TagBadge, TagColorPicker, TAG_COLORS, type Tag } from "./TagBadge";
import { cn } from "@/lib/utils";

interface TagSelectorProps {
  conversationId: string;
  className?: string;
}

export function TagSelector({ conversationId, className }: TagSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("blue");
  const [isCreating, setIsCreating] = useState(false);

  const utils = trpc.useUtils();

  // Get all user tags
  const { data: allTags = [], isLoading: isLoadingTags } = trpc.tags.list.useQuery();

  // Get tags for this conversation
  const { data: conversationTags = [], isLoading: isLoadingConvTags } = 
    trpc.tags.getForConversation.useQuery({ conversationId });

  // Create tag mutation
  const createTagMutation = trpc.tags.create.useMutation({
    onSuccess: () => {
      utils.tags.list.invalidate();
      setNewTagName("");
      setIsCreating(false);
    },
    onError: (error) => {
      console.error("Failed to create tag:", error);
    },
  });

  // Add tag to conversation mutation
  const addTagMutation = trpc.tags.addToConversation.useMutation({
    onSuccess: () => {
      utils.tags.getForConversation.invalidate({ conversationId });
    },
  });

  // Remove tag from conversation mutation
  const removeTagMutation = trpc.tags.removeFromConversation.useMutation({
    onSuccess: () => {
      utils.tags.getForConversation.invalidate({ conversationId });
    },
  });

  const handleCreateTag = () => {
    if (!newTagName.trim()) return;
    createTagMutation.mutate({ name: newTagName.trim(), color: newTagColor });
  };

  const handleToggleTag = (tag: Tag) => {
    const isSelected = conversationTags.some((t: Tag) => t.id === tag.id);
    if (isSelected) {
      removeTagMutation.mutate({ conversationId, tagId: tag.id });
    } else {
      addTagMutation.mutate({ conversationId, tagId: tag.id });
    }
  };

  const isLoading = isLoadingTags || isLoadingConvTags;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {/* Display current tags */}
      {conversationTags.map((tag: Tag) => (
        <TagBadge
          key={tag.id}
          tag={tag}
          size="sm"
          onRemove={() => removeTagMutation.mutate({ conversationId, tagId: tag.id })}
        />
      ))}

      {/* Add tag button */}
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
          >
            <TagIcon className="w-3 h-3" />
            <span className="hidden sm:inline">Add tag</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="start">
          <div className="space-y-3">
            <div className="font-medium text-sm">Tags</div>

            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {/* Existing tags */}
                {allTags.length > 0 && (
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {allTags.map((tag: Tag) => {
                      const isSelected = conversationTags.some((t: Tag) => t.id === tag.id);
                      const colors = TAG_COLORS[tag.color] || TAG_COLORS.blue;
                      return (
                        <button
                          key={tag.id}
                          onClick={() => handleToggleTag(tag)}
                          className={cn(
                            "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left",
                            isSelected 
                              ? "bg-primary/10 text-primary" 
                              : "hover:bg-muted"
                          )}
                        >
                          <span className={cn("w-3 h-3 rounded-full", colors.bg, colors.border, "border")} />
                          <span className="flex-1 truncate">{tag.name}</span>
                          {isSelected && <Check className="w-4 h-4" />}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Create new tag */}
                {isCreating ? (
                  <div className="space-y-2 pt-2 border-t">
                    <Input
                      placeholder="Tag name"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCreateTag();
                        if (e.key === "Escape") setIsCreating(false);
                      }}
                      className="h-8 text-sm"
                      autoFocus
                    />
                    <TagColorPicker value={newTagColor} onChange={setNewTagColor} />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1 h-7 text-xs"
                        onClick={handleCreateTag}
                        disabled={!newTagName.trim() || createTagMutation.isPending}
                      >
                        {createTagMutation.isPending ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          "Create"
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => {
                          setIsCreating(false);
                          setNewTagName("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start gap-2 h-8 text-muted-foreground"
                    onClick={() => setIsCreating(true)}
                  >
                    <Plus className="w-4 h-4" />
                    Create new tag
                  </Button>
                )}
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
