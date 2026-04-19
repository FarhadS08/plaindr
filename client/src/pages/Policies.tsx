import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { PolicyCard } from "@/components/dashboard/PolicyCard";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Policy } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import { prettyPolicyType } from "@/components/dashboard/diff-helpers";
import { useLocation } from "wouter";

export default function PoliciesPage() {
  const [location] = useLocation();
  const urlParams =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : null;
  const companyFilterFromUrl = urlParams?.get("company") ?? null;

  const [query, setQuery] = useState("");
  const [activeType, setActiveType] = useState<string | null>(null);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);

  const { data: policies, isLoading: loadingPolicies } = useQuery({
    queryKey: ["policies"],
    queryFn: api.listPolicies,
  });

  const { data: companies } = useQuery({
    queryKey: ["companies"],
    queryFn: api.listCompanies,
    staleTime: 5 * 60_000,
  });

  const companiesById = useMemo(
    () => new Map((companies ?? []).map(c => [c.id, c])),
    [companies],
  );
  const companiesBySlug = useMemo(
    () => new Map((companies ?? []).map(c => [c.slug, c])),
    [companies],
  );

  // derive company filter from URL param (slug)
  const effectiveCompanyId =
    activeCompanyId ??
    (companyFilterFromUrl
      ? companiesBySlug.get(companyFilterFromUrl)?.id ?? null
      : null);

  const policyTypes = useMemo(() => {
    const set = new Set<string>();
    (policies ?? []).forEach(p => set.add(p.policy_type));
    return Array.from(set).sort();
  }, [policies]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (policies ?? []).filter(p => {
      if (activeType && p.policy_type !== activeType) return false;
      if (effectiveCompanyId && p.author_id !== effectiveCompanyId) return false;
      if (!q) return true;
      const company = companiesById.get(p.author_id);
      return (
        p.title.toLowerCase().includes(q) ||
        p.source_url.toLowerCase().includes(q) ||
        (company?.name.toLowerCase().includes(q) ?? false) ||
        p.policy_type.toLowerCase().includes(q)
      );
    });
  }, [policies, query, activeType, effectiveCompanyId, companiesById]);

  // group by company
  const grouped = useMemo(() => {
    const map = new Map<string, Policy[]>();
    for (const p of filtered) {
      const key = p.author_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    const entries = Array.from(map.entries()).map(([authorId, list]) => ({
      company: companiesById.get(authorId),
      authorId,
      policies: list.sort((a, b) => a.title.localeCompare(b.title)),
    }));
    entries.sort((a, b) =>
      (a.company?.name ?? "").localeCompare(b.company?.name ?? ""),
    );
    return entries;
  }, [filtered, companiesById]);

  return (
    <DashboardShell
      crumbs={[
        { label: "Dashboard", href: "/dashboard" },
        { label: "Policies" },
      ]}
    >
      <div className="max-w-[1280px] mx-auto space-y-6">
        <header>
          <h1 className="text-[22px] font-semibold tracking-tight">
            Policy library
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Every tracked policy, grouped by company. Click any tile to open the
            full document with version history.
          </p>
        </header>

        <div className="space-y-3">
          <div className="relative max-w-md">
            <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filter by title, company or URL…"
              className="pl-8 h-9"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <FilterPill
              active={!activeType}
              onClick={() => setActiveType(null)}
            >
              All types
            </FilterPill>
            {policyTypes.map(t => (
              <FilterPill
                key={t}
                active={activeType === t}
                onClick={() => setActiveType(activeType === t ? null : t)}
              >
                {prettyPolicyType(t)}
              </FilterPill>
            ))}
          </div>

          {effectiveCompanyId && (
            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-muted-foreground">Filtered by company:</span>
              <Badge
                variant="outline"
                className="gap-1 cursor-pointer hover:bg-accent"
                onClick={() => {
                  setActiveCompanyId(null);
                  if (companyFilterFromUrl) {
                    window.history.replaceState({}, "", location);
                  }
                }}
              >
                {companiesById.get(effectiveCompanyId)?.name ?? "Unknown"}
                <span className="opacity-60">×</span>
              </Badge>
            </div>
          )}
        </div>

        {loadingPolicies && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i} className="border border-border bg-card p-4">
                <Skeleton className="h-4 w-3/4 mb-3" />
                <Skeleton className="h-3 w-1/2" />
                <div className="mt-4 pt-3 border-t border-border/60">
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loadingPolicies && grouped.length === 0 && (
          <div className="border border-border bg-card p-10 text-center">
            <p className="text-sm font-medium">Nothing matches that filter.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Try broadening your search or clearing active filters.
            </p>
          </div>
        )}

        <div className="space-y-8">
          {grouped.map(group => (
            <section key={group.authorId}>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-[14px] font-semibold tracking-tight">
                  {group.company?.name ?? "Unknown company"}
                </h2>
                {group.company?.category && (
                  <Badge variant="outline" className="h-5 text-[10px] font-mono uppercase tracking-[0.12em]">
                    {group.company.category}
                  </Badge>
                )}
                <span className="text-[11px] font-mono text-muted-foreground ml-auto">
                  {group.policies.length} polic{group.policies.length === 1 ? "y" : "ies"}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {group.policies.map((p, i) => (
                  <PolicyCard
                    key={p.id}
                    policy={p}
                    company={group.company}
                    index={i}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-[11.5px] px-2.5 py-1 rounded-full border transition-colors",
        active
          ? "border-foreground/60 bg-foreground text-background"
          : "border-border bg-background text-muted-foreground hover:text-foreground hover:border-foreground/20",
      )}
    >
      {children}
    </button>
  );
}
