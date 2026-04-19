import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ChatHistory } from "@/components/dashboard/ChatHistory";

export default function ChatPage() {
  return (
    <DashboardShell
      crumbs={[
        { label: "Dashboard", href: "/dashboard" },
        { label: "Chat" },
      ]}
      flush
    >
      <div className="h-[calc(100vh-56px)] p-4 md:p-6 lg:p-8">
        <ChatHistory />
      </div>
    </DashboardShell>
  );
}
