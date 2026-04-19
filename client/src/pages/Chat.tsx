import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ChatWorkspace } from "@/components/dashboard/ChatWorkspace";

/**
 * The Plaindr chat page — a full-bleed cockpit with history on the left,
 * the conversation in the center, and a live sources rail on the right.
 *
 * This replaces the old single-column `ChatHistory` layout. The original
 * component is kept around (unused) as a reference implementation.
 */
export default function ChatPage() {
  return (
    <DashboardShell
      crumbs={[
        { label: "Dashboard", href: "/dashboard" },
        { label: "Chat" },
      ]}
      flush
    >
      <div className="h-[calc(100vh-56px)] overflow-hidden">
        <ChatWorkspace />
      </div>
    </DashboardShell>
  );
}
