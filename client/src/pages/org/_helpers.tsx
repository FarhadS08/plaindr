import { Crown, Shield, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export type Role = "owner" | "admin" | "member";

export function RoleBadge({ role }: { role: Role }) {
  const Icon = role === "owner" ? Crown : role === "admin" ? Shield : Users;
  const tint =
    role === "owner"
      ? "text-amber-600 dark:text-amber-400"
      : role === "admin"
        ? "text-violet-600 dark:text-violet-400"
        : "text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 uppercase tracking-wider font-mono text-[10px]",
        tint,
      )}
    >
      <Icon className="h-3 w-3" />
      {role}
    </span>
  );
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
