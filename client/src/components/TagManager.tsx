import { useState } from "react";
import { Edit2, Plus, Trash2, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { TagBadge, TAG_COLORS } from "./TagBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface TagManagerProps {
  trigger?: React.ReactNode;
}

export function TagManager({ trigger }: TagManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [newTagName, setNewTagName] = useState("");
  const [selectedColor, setSelectedColor] = useState(TAG_COLORS[0]);
  const [isCreating, setIsCreating] = useState(false);

  const { data: tags = [], refetch } = trpc.tags.list.useQuery();
  
  const createMutation = trpc.tags.create.useMutation({
    onSuccess: () => {
      refetch();
      setNewTagName("");
      setSelectedColor(TAG_COLORS[0]);
      setIsCreating(false);
      toast.success("Tag created");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const updateMutation = trpc.tags.update.useMutation({
    onSuccess: () => {
      refetch();
      setEditingTag(null);
      toast.success("Tag updated");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = trpc.tags.delete.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("Tag deleted");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleCreate = () => {
    if (!newTagName.trim()) return;
    createMutation.mutate({
      name: newTagName.trim(),
      color: selectedColor,
    });
  };

  const handleUpdate = () => {
    if (!editingTag) return;
    updateMutation.mutate({
      id: editingTag.id,
      name: editingTag.name,
      color: editingTag.color,
    });
  };

  const handleDelete = (tagId: string) => {
    if (confirm("Delete this tag? It will be removed from all conversations.")) {
      deleteMutation.mutate({ id: tagId });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            Manage Tags
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Tags</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {/* Existing tags */}
          {tags.length > 0 ? (
            <div className="space-y-2">
              {tags.map(tag => (
                <div
                  key={tag.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                >
                  {editingTag && editingTag.id === tag.id ? (
                    <div className="flex-1 space-y-2">
                      <Input
                        value={editingTag.name}
                        onChange={(e) => setEditingTag({ ...editingTag, name: e.target.value })}
                        className="h-8"
                        autoFocus
                      />
                      <div className="flex flex-wrap gap-1">
                        {TAG_COLORS.map(color => (
                          <button
                            key={color}
                            onClick={() => setEditingTag({ ...editingTag, color })}
                            className={cn(
                              "w-5 h-5 rounded-full transition-all",
                              editingTag.color === color && "ring-2 ring-offset-2 ring-primary"
                            )}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" className="h-7" onClick={handleUpdate}>
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7"
                          onClick={() => setEditingTag(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <TagBadge name={tag.name} color={tag.color} size="md" />
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setEditingTag(tag)}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(tag.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No tags yet. Create your first tag below.
            </p>
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
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") setIsCreating(false);
                  }}
                  autoFocus
                />
                <div className="flex flex-wrap gap-1">
                  {TAG_COLORS.map(color => (
                    <button
                      key={color}
                      onClick={() => setSelectedColor(color)}
                      className={cn(
                        "w-6 h-6 rounded-full transition-all",
                        selectedColor === color && "ring-2 ring-offset-2 ring-primary"
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={handleCreate}
                    disabled={!newTagName.trim() || createMutation.isPending}
                  >
                    Create Tag
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setIsCreating(false);
                      setNewTagName("");
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setIsCreating(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Create New Tag
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
