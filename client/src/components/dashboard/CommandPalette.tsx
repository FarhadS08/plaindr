import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  FileText,
  GitPullRequestArrow,
  Sparkles,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { api, encodeSourceUrlForRoute } from "@/lib/api";

/* ─────────────────────────────────────────────────────────────
 * Command palette — the one ⌘K for the whole app.
 *
 * Groups shown:
 *   1. Ask Plaindr — instant handoff to the chat with the current
 *      query prefilled. Always the top action so users who know
 *      what they want to ask never scroll.
 *   2. Companies — 130+ AI companies, navigate to their policies.
 *   3. Policies — 465 documents, navigate to the diff timeline.
 *   4. Recent diffs — most-recent changes across the corpus.
 *
 * cmdk does its own fuzzy search over the rendered items, so the
 * component doesn't filter — it just renders everything and lets
 * the library handle the matching as the user types.
 * ───────────────────────────────────────────────────────────── */

export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  // Global ⌘K / ctrl+K toggle. Ignores the event while the user is
  // typing in a text input / textarea / contenteditable, so we don't
  // hijack keystrokes inside normal form fields.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta || e.key.toLowerCase() !== "k") return;
      const t = e.target as HTMLElement | null;
      const typing =
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable);
      // ⌘K always wins — even when typing. Every app works this way;
      // users expect it more than they expect field-level focus.
      e.preventDefault();
      setOpen(v => !v);
      // Still blur the active field so focus moves into the dialog.
      if (typing) (document.activeElement as HTMLElement | null)?.blur();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { open, setOpen };
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");

  const { data: companies = [] } = useQuery({
    queryKey: ["palette-companies"],
    queryFn: api.listCompanies,
    staleTime: 5 * 60_000,
    enabled: open,
  });
  const { data: policies = [] } = useQuery({
    queryKey: ["palette-policies"],
    queryFn: api.listPolicies,
    staleTime: 5 * 60_000,
    enabled: open,
  });
  const { data: diffs = [] } = useQuery({
    queryKey: ["palette-diffs"],
    queryFn: () => api.recentDiffs(10),
    staleTime: 60_000,
    enabled: open,
  });

  // Map company ids → names once, so policy rows can show the owner
  // without another query.
  const companyNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of companies) m.set(c.id, c.name);
    return m;
  }, [companies]);

  // Clear the query when the palette closes so it opens fresh next time.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  function go(path: string) {
    setLocation(path);
    onOpenChange(false);
  }

  const askHref =
    query.trim().length > 0
      ? `/dashboard/chat?q=${encodeURIComponent(query.trim())}`
      : "/dashboard/chat";

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} className="max-w-xl">
      <CommandInput
        placeholder="Search policies, companies, diffs — or ask Plaindr…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No matches. Try a different term.</CommandEmpty>

        <CommandGroup heading="Ask Plaindr">
          <CommandItem
            value={`ask ${query}`}
            onSelect={() => go(askHref)}
            className="gap-3"
          >
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="flex-1">
              {query.trim()
                ? `Ask: "${truncate(query.trim(), 60)}"`
                : "Open Ask Plaindr"}
            </span>
            <CommandShortcut>↵</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        {companies.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={`Companies · ${companies.length}`}>
              {companies.slice(0, 60).map(c => (
                <CommandItem
                  key={c.id}
                  value={`${c.name} ${c.category ?? ""} ${c.slug}`}
                  onSelect={() =>
                    go(
                      `/dashboard/policies?company=${encodeSourceUrlForRoute(c.slug)}`,
                    )
                  }
                  className="gap-3"
                >
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{c.name}</span>
                  {c.category && (
                    <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      {c.category}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {policies.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={`Policies · ${policies.length}`}>
              {policies.slice(0, 80).map(p => {
                const company = companyNameById.get(p.author_id) ?? "Unknown";
                return (
                  <CommandItem
                    key={p.id}
                    value={`${p.title} ${company} ${p.policy_type}`}
                    onSelect={() =>
                      go(
                        `/dashboard/policies/${encodeSourceUrlForRoute(p.source_url)}`,
                      )
                    }
                    className="gap-3"
                  >
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{p.title || company}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {company} · {p.policy_type}
                      </div>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}

        {diffs.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent diffs">
              {diffs.map(d => {
                const company = companyNameById.get(d.author_id) ?? "Unknown";
                return (
                  <CommandItem
                    key={d.id}
                    value={`diff ${company} ${d.analysis?.summary ?? ""}`}
                    onSelect={() => go(`/dashboard/diffs/${d.id}`)}
                    className="gap-3"
                  >
                    <GitPullRequestArrow className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{company}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        v{d.old_version} → v{d.new_version} ·{" "}
                        {d.analysis?.summary
                          ? truncate(d.analysis.summary, 60)
                          : `${d.stats.lines_added}+/${d.stats.lines_removed}-`}
                      </div>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}
