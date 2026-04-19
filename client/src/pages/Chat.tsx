import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { AskWidget } from "@/components/dashboard/AskWidget";

export default function ChatPage() {
  return (
    <DashboardShell
      crumbs={[
        { label: "Dashboard", href: "/dashboard" },
        { label: "Ask Plaindr" },
      ]}
      flush
    >
      <div className="h-[calc(100vh-56px)] grid grid-rows-[auto_1fr]">
        <div className="px-4 md:px-6 lg:px-8 pt-6 pb-4">
          <h1 className="text-[22px] font-semibold tracking-tight">
            Ask anything about policy
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Plaindr retrieves the most relevant passages across every tracked policy
            and streams a grounded answer. Citations appear on the right as sources are
            resolved.
          </p>
        </div>
        <div className="px-4 md:px-6 lg:px-8 pb-6 min-h-0">
          <AskWidget variant="full" className="h-full" />
        </div>
      </div>
    </DashboardShell>
  );
}
