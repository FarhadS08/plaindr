import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRight,
  Building2,
  Check,
  Lock,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  COMPLIANCE,
  DATA_RESIDENCY,
  INDUSTRIES,
  ORG_SIZES,
  type ComplianceTag,
  type DataResidency,
  type Industry,
  type OrgSize,
} from "@/lib/org-profile-constants";
import { RequireOrg } from "./_RequireOrg";

/* ─────────────────────────────────────────────────────────────
 * /org/profile — Organization & compliance.
 *
 * Owner-only write surface. Members can view (drives Ask Plaindr's
 * fit filtering) but only the owner sees the save button. Below the
 * form we render a quick "tools that currently match" preview, so
 * the owner sees the effect of their choices immediately rather
 * than waiting to ask a question.
 * ───────────────────────────────────────────────────────────── */

export default function OrgProfile() {
  return (
    <RequireOrg crumbs={[{ label: "Profile" }]}>
      {org => (
        <div className="max-w-3xl mx-auto py-8 space-y-6">
          <ProfileCard orgId={org.id} role={org.role} />
          <FitPreviewCard orgId={org.id} />
        </div>
      )}
    </RequireOrg>
  );
}

function ProfileCard({
  orgId,
  role,
}: {
  orgId: string;
  role: "owner" | "admin" | "member";
}) {
  const utils = trpc.useUtils();
  const profile = trpc.organizations.getProfile.useQuery({
    organization_id: orgId,
  });

  const [industry, setIndustry] = useState<Industry | "">("");
  const [orgSize, setOrgSize] = useState<OrgSize | "">("");
  const [compliance, setCompliance] = useState<ComplianceTag[]>([]);
  const [residency, setResidency] = useState<DataResidency | "">("");
  const [notes, setNotes] = useState("");

  const canEdit = role === "owner";

  // Hydrate once the query lands. Deliberately only sync on the
  // initial load — after that, user edits should not get overwritten
  // by background refetches.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (hydrated || !profile.data) return;
    setIndustry((profile.data.industry as Industry) ?? "");
    setOrgSize((profile.data.organization_size as OrgSize) ?? "");
    setCompliance(
      (profile.data.compliance_requirements as ComplianceTag[]) ?? [],
    );
    setResidency((profile.data.data_residency as DataResidency) ?? "");
    setNotes((profile.data.notes as string) ?? "");
    setHydrated(true);
  }, [profile.data, hydrated]);

  const update = trpc.organizations.updateProfile.useMutation({
    onSuccess: async () => {
      toast.success("Profile saved");
      await utils.organizations.getProfile.invalidate({
        organization_id: orgId,
      });
    },
    onError: err => toast.error(err.message),
  });

  const dirty = useMemo(() => {
    if (!profile.data) return false;
    return (
      industry !== ((profile.data.industry as string) ?? "") ||
      orgSize !== ((profile.data.organization_size as string) ?? "") ||
      residency !== ((profile.data.data_residency as string) ?? "") ||
      notes !== ((profile.data.notes as string) ?? "") ||
      !sameArray(
        compliance,
        (profile.data.compliance_requirements as string[]) ?? [],
      )
    );
  }, [industry, orgSize, residency, notes, compliance, profile.data]);

  function toggleCompliance(tag: ComplianceTag) {
    if (!canEdit) return;
    setCompliance(c =>
      c.includes(tag) ? c.filter(t => t !== tag) : [...c, tag],
    );
  }

  function handleSave() {
    update.mutate({
      organization_id: orgId,
      industry: industry || null,
      organization_size: orgSize || null,
      compliance_requirements: compliance,
      data_residency: residency || null,
      notes: notes.trim() ? notes.trim() : null,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-primary" />
          Organization & compliance
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Tell Plaindr about your organization so we can flag which AI tools
          actually fit your constraints.
        </p>
        {!canEdit && (
          <p className="text-[11px] mt-2 inline-flex items-center gap-1.5 text-muted-foreground">
            <Lock className="h-3 w-3" />
            Read-only — only the owner can edit.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {profile.isLoading || !hydrated ? (
          <>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Industry</Label>
                <Select
                  value={industry}
                  onValueChange={v => setIndustry(v as Industry)}
                  disabled={!canEdit}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder="Pick an industry" />
                  </SelectTrigger>
                  <SelectContent>
                    {INDUSTRIES.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Organization size</Label>
                <Select
                  value={orgSize}
                  onValueChange={v => setOrgSize(v as OrgSize)}
                  disabled={!canEdit}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder="How many people?" />
                  </SelectTrigger>
                  <SelectContent>
                    {ORG_SIZES.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <Label className="text-sm font-medium">
                  Compliance requirements
                </Label>
                {compliance.length > 0 && (
                  <span className="text-[11px] font-mono text-muted-foreground">
                    · {compliance.length} selected
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {COMPLIANCE.map(tag => {
                  const active = compliance.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleCompliance(tag)}
                      disabled={!canEdit}
                      className={
                        "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors " +
                        (active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:border-primary/40 hover:text-foreground") +
                        (!canEdit ? " cursor-not-allowed opacity-80" : "")
                      }
                    >
                      {active && <Check className="w-3 h-3" />}
                      {tag}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Pick every framework your organization must satisfy. Plaindr
                uses this to flag tools missing coverage.
              </p>
            </div>

            <div>
              <Label className="text-sm font-medium">Data residency</Label>
              <Select
                value={residency}
                onValueChange={v => setResidency(v as DataResidency)}
                disabled={!canEdit}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Where should data live?" />
                </SelectTrigger>
                <SelectContent>
                  {DATA_RESIDENCY.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="org-notes" className="text-sm font-medium">
                Anything else we should factor in?
              </Label>
              <Textarea
                id="org-notes"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                disabled={!canEdit}
                placeholder="e.g. No US-based subprocessors. 30-day data retention ceiling. BAAs required before onboarding."
                className="mt-1.5 min-h-[96px]"
                maxLength={2000}
              />
              <div className="mt-1 text-right text-[10px] font-mono text-muted-foreground">
                {notes.length}/2000
              </div>
            </div>

            {canEdit && (
              <div className="flex justify-end">
                <Button
                  onClick={handleSave}
                  disabled={!dirty || update.isPending}
                >
                  {update.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function sameArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/* ── fit preview ──────────────────────────────────────────── */

function FitPreviewCard({ orgId }: { orgId: string }) {
  const profile = trpc.organizations.getProfile.useQuery({
    organization_id: orgId,
  });
  const { data: companies, isLoading: loadingCompanies } = useQuery({
    queryKey: ["org-fit-companies"],
    queryFn: api.listCompanies,
    staleTime: 5 * 60_000,
  });

  const reqs =
    (profile.data?.compliance_requirements as string[] | null) ?? [];
  const residency = (profile.data?.data_residency as string | null) ?? null;

  // No inputs → no preview. Ask the owner to fill something in first.
  if (!profile.isLoading && reqs.length === 0 && !residency) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-6 flex items-center gap-3">
          <Sparkles className="h-4 w-4 text-muted-foreground shrink-0" />
          <p className="text-sm text-muted-foreground flex-1">
            Add at least one compliance requirement or residency preference
            above and Plaindr will show the tools that match.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          Tools Plaindr will surface as a good fit
        </CardTitle>
        <p className="text-[11px] text-muted-foreground mt-1">
          Based on the compliance frameworks + residency you picked. This
          preview runs against every policy in Plaindr's library; open Ask
          Plaindr to ask sharper questions with this context applied.
        </p>
      </CardHeader>
      <CardContent>
        {loadingCompanies ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : !companies || companies.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No companies loaded yet — check back after the next sync.
          </p>
        ) : (
          <>
            <p className="text-[12px] text-muted-foreground mb-3">
              Scanning{" "}
              <span className="font-mono text-foreground">
                {companies.length}
              </span>{" "}
              companies in the library against{" "}
              <span className="font-mono text-foreground">
                {reqs.length > 0 ? reqs.join(", ") : "residency only"}
              </span>
              .
            </p>
            <div className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-[12px] text-muted-foreground">
              <p className="font-medium text-foreground mb-1">
                Deep fit scoring runs at query time.
              </p>
              <p>
                Open Ask Plaindr and ask something like{" "}
                <em>"Which tools fit our profile?"</em> — your compliance
                context is automatically included in the prompt.
              </p>
              <Button
                asChild
                size="sm"
                variant="outline"
                className="mt-3 gap-2"
              >
                <Link href="/dashboard/chat">
                  Open Ask Plaindr
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
