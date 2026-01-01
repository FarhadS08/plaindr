import { useState } from "react";
import { Check, Plus, Tag } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { TagBadge, TAG_COLORS } from "./TagBadge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface TagSelectorProps {
  conversationId: string;
  selectedTags: Tag[];
  onTagsChange: () => void;
}

export function TagSelector({ conversationId, selectedTags, onTagsChange }: TagSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [selectedColor, setSelectedColor] = useState(TAG_COLORS[0]);
  const [isCreating, setIsCreating] = useState(false);

  const { data: allTags = [], refetch: refetchTags } = trpc.tags.list.useQuery();
  
  const createTagMutation = trpc.tags.create.useMutation({
    onSuccess: () => {
      refetchTags();
      setNewTagName("");
      setIsCreating(false);
      toast.success("Tag created");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const addTagMutation = trpc.tags.addToConversation.useMutation({
    onSuccess: (result) => {
      onTagsChange();
      if (!result.alreadyExists) {
        toast.success("Tag added");
      }
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const removeTagMutation = trpc.tags.removeFromConversation.useMutation({
    onSuccess: () => {
      onTagsChange();
      toast.success("Tag removed");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleCreateTag = () => {
    if (!newTagName.trim()) return;
    createTagMutation.mutate({
      name: newTagName.trim(),
      color: selectedColor,
    });
  };

  const handleToggleTag = (tag: Tag) => {
    const isSelected = selectedTags.some(t => t.id === tag.id);
    if (isSelected) {
      removeTagMutation.mutate({
        conversationId,
        tagId: tag.id,
      });
    } else {
      addTagMutation.mutate({
        conversationId,
        tagId: tag.id,
      });
    }
  };

  const availableTags = allTags.filter(
    tag => !selectedTags.some(st => st.id === tag.id)
  );

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-muted-foreground hover:text-foreground"
        >
          <Tag className="h-3.5 w-3.5 mr-1" />
          <span className="text-xs">Tags</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <div className="space-y-2">
          {/* Selected tags */}
          {selectedTags.length > 0 && (
            <div className="flex flex-wrap gap-1 pb-2 border-b">
              {selectedTags.map(tag => (
                <TagBadge
                  key={tag.id}
                  name={tag.name}
                  color={tag.color}
                  onRemove={() => handleToggleTag(tag)}
                />
              ))}
            </div>
          )}

          {/* Available tags */}
          {availableTags.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground px-1">Add tags</p>
              <div className="max-h-32 overflow-y-auto space-y-0.5">
                {availableTags.map(tag => (
                  <button
                    key={tag.id}
                    onClick={() => handleToggleTag(tag)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent text-left text-sm"
                  >
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="truncate">{tag.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Create new tag */}
          <div className="pt-2 border-t">
            {isCreating ? (
              <div className="space-y-2">
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
                <div className="flex flex-wrap gap-1">
                  {TAG_COLORS.map(color => (
                    <button
                      key={color}
                      onClick={() => setSelectedColor(color)}
                      className={cn(
                        "w-5 h-5 rounded-full transition-all",
                        selectedColor === color && "ring-2 ring-offset-2 ring-primary"
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    className="flex-1 h-7 text-xs"
                    onClick={handleCreateTag}
                    disabled={!newTagName.trim() || createTagMutation.isPending}
                  >
                    <Check className="h-3 w-3 mr-1" />
                    Create
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
                className="w-full h-8 text-xs justify-start"
                onClick={() => setIsCreating(true)}
              >
                <Plus className="h-3 w-3 mr-1" />
                Create new tag
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
