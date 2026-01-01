import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface TagBadgeProps {
  name: string;
  color: string;
  onRemove?: () => void;
  onClick?: () => void;
  size?: "sm" | "md";
  className?: string;
}

export function TagBadge({ 
  name, 
  color, 
  onRemove, 
  onClick,
  size = "sm",
  className 
}: TagBadgeProps) {
  // Calculate contrasting text color based on background
  const getContrastColor = (hexColor: string) => {
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? "#000000" : "#ffffff";
  };

  const textColor = getContrastColor(color);
  
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium transition-all",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm",
        onClick && "cursor-pointer hover:opacity-80",
        className
      )}
      style={{ 
        backgroundColor: color,
        color: textColor,
      }}
      onClick={onClick}
    >
      {name}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 rounded-full p-0.5 hover:bg-black/20 transition-colors"
          aria-label={`Remove ${name} tag`}
        >
          <X className={size === "sm" ? "h-3 w-3" : "h-4 w-4"} />
        </button>
      )}
    </span>
  );
}

// Predefined color palette for tags
export const TAG_COLORS = [
  "#8B5CF6", // Purple (default)
  "#EF4444", // Red
  "#F97316", // Orange
  "#EAB308", // Yellow
  "#22C55E", // Green
  "#14B8A6", // Teal
  "#3B82F6", // Blue
  "#EC4899", // Pink
  "#6366F1", // Indigo
  "#64748B", // Slate
];
