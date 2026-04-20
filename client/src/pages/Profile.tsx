import {
  useAuth,
  SignedIn,
  SignedOut,
  SignInButton,
  useUser,
} from "@/contexts/ClerkContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Moon,
  Sun,
  ChevronRight,
  Loader2,
  User,
  Mail,
  Calendar,
  Target,
  Globe,
  Bell,
  Building2,
  ShieldCheck,
  Check,
  History
} from "lucide-react";
import { Link } from "wouter";
import { useState, useEffect } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { SEO, SEO_CONFIG } from "@/components/SEO";
import { toast } from "sonner";

const USAGE_INTENTS = [
  { value: 'personal_awareness', label: 'Personal Awareness', description: 'Understanding AI policies for personal use' },
  { value: 'professional_research', label: 'Professional Research', description: 'Researching policies for work or clients' },
  { value: 'compliance_checks', label: 'Compliance Checks', description: 'Ensuring regulatory compliance' },
  { value: 'curiosity', label: 'Curiosity', description: 'Just exploring and learning' },
  { value: 'other', label: 'Other', description: 'Something else entirely' },
] as const;

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
] as const;

// Organization-profile option lists. Mirror the Zod enum on the
// server — keep them identical so validation never trips on a stale
// client. If you add to one, add to the other.
const INDUSTRIES = [
  { value: 'technology', label: 'Technology / SaaS' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'finance', label: 'Finance / Banking' },
  { value: 'legal', label: 'Legal' },
  { value: 'education', label: 'Education' },
  { value: 'pharmaceutical', label: 'Pharmaceutical' },
  { value: 'retail', label: 'Retail / eCommerce' },
  { value: 'media', label: 'Media / Publishing' },
  { value: 'government', label: 'Government / Public sector' },
  { value: 'nonprofit', label: 'Non-profit' },
  { value: 'consulting', label: 'Consulting' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'other', label: 'Other' },
] as const;

const ORG_SIZES = [
  { value: '1', label: 'Just me' },
  { value: '2-10', label: '2–10' },
  { value: '11-50', label: '11–50' },
  { value: '51-200', label: '51–200' },
  { value: '201-1000', label: '201–1,000' },
  { value: '1001+', label: '1,001+' },
] as const;

const COMPLIANCE = [
  'GDPR', 'CCPA', 'HIPAA', 'SOC 2', 'ISO 27001', 'PCI DSS',
  'FERPA', 'FedRAMP', 'SOX', 'NIS2', 'DORA',
] as const;

const DATA_RESIDENCY = [
  { value: 'any', label: 'No preference' },
  { value: 'EU', label: 'EU only' },
  { value: 'US', label: 'US only' },
  { value: 'UK', label: 'UK only' },
  { value: 'other', label: 'Other / custom' },
] as const;

type UsageIntent = typeof USAGE_INTENTS[number]['value'];
type Industry = typeof INDUSTRIES[number]['value'];
type OrgSize = typeof ORG_SIZES[number]['value'];
type ComplianceTag = typeof COMPLIANCE[number];
type DataResidency = typeof DATA_RESIDENCY[number]['value'];

export default function Profile() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { user: clerkUser } = useUser();
  const { theme, toggleTheme } = useTheme();

  // Form state
  const [displayName, setDisplayName] = useState('');
  const [usageIntent, setUsageIntent] = useState<UsageIntent | ''>('');
  const [usageIntentNote, setUsageIntentNote] = useState('');
  const [language, setLanguage] = useState('en');
  const [region, setRegion] = useState('');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  // Organization profile state.
  const [organizationName, setOrganizationName] = useState('');
  const [industry, setIndustry] = useState<Industry | ''>('');
  const [organizationSize, setOrganizationSize] = useState<OrgSize | ''>('');
  const [compliance, setCompliance] = useState<ComplianceTag[]>([]);
  const [dataResidency, setDataResidency] = useState<DataResidency | ''>('');
  const [organizationNotes, setOrganizationNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // tRPC queries and mutations
  const { data: profile, isLoading: profileLoading, refetch } = trpc.profiles.get.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );

  const upsertMutation = trpc.profiles.upsert.useMutation({
    onSuccess: () => {
      toast.success('Profile saved successfully');
      setHasChanges(false);
      refetch();
    },
    onError: (error) => {
      toast.error(`Failed to save profile: ${error.message}`);
    },
  });

  // Initialize form with profile data
  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name || '');
      setUsageIntent((profile.usage_intent as UsageIntent) || '');
      setUsageIntentNote(profile.usage_intent_note || '');
      setLanguage(profile.language || 'en');
      setRegion(profile.region || '');
      setNotificationsEnabled(profile.notifications_enabled ?? true);
      setOrganizationName(profile.organization_name || '');
      setIndustry((profile.industry as Industry) || '');
      setOrganizationSize((profile.organization_size as OrgSize) || '');
      setCompliance((profile.compliance_requirements as ComplianceTag[]) || []);
      setDataResidency((profile.data_residency as DataResidency) || '');
      setOrganizationNotes(profile.organization_notes || '');
    } else if (clerkUser && !profileLoading) {
      // Pre-fill with Clerk data for new profiles
      setDisplayName(clerkUser.fullName || clerkUser.firstName || '');
    }
  }, [profile, clerkUser, profileLoading]);

  // Track changes
  useEffect(() => {
    const orgComplianceSet = new Set(compliance);
    const profileComplianceSet = new Set(
      (profile?.compliance_requirements as ComplianceTag[] | undefined) || [],
    );
    const complianceChanged =
      orgComplianceSet.size !== profileComplianceSet.size ||
      compliance.some(c => !profileComplianceSet.has(c));

    if (!profile && !profileLoading) {
      // New profile — any non-default input is a change.
      setHasChanges(
        displayName !== '' ||
        usageIntent !== '' ||
        usageIntentNote !== '' ||
        language !== 'en' ||
        region !== '' ||
        !notificationsEnabled ||
        organizationName !== '' ||
        industry !== '' ||
        organizationSize !== '' ||
        compliance.length > 0 ||
        dataResidency !== '' ||
        organizationNotes !== ''
      );
    } else if (profile) {
      setHasChanges(
        displayName !== (profile.display_name || '') ||
        usageIntent !== (profile.usage_intent || '') ||
        usageIntentNote !== (profile.usage_intent_note || '') ||
        language !== (profile.language || 'en') ||
        region !== (profile.region || '') ||
        notificationsEnabled !== (profile.notifications_enabled ?? true) ||
        organizationName !== (profile.organization_name || '') ||
        industry !== (profile.industry || '') ||
        organizationSize !== (profile.organization_size || '') ||
        dataResidency !== (profile.data_residency || '') ||
        organizationNotes !== (profile.organization_notes || '') ||
        complianceChanged
      );
    }
  }, [
    displayName, usageIntent, usageIntentNote, language, region,
    notificationsEnabled, organizationName, industry, organizationSize,
    compliance, dataResidency, organizationNotes, profile, profileLoading,
  ]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await upsertMutation.mutateAsync({
        display_name: displayName || undefined,
        usage_intent: usageIntent || undefined,
        usage_intent_note: usageIntentNote || undefined,
        language: language || undefined,
        region: region || undefined,
        notifications_enabled: notificationsEnabled,
        organization_name: organizationName || undefined,
        industry: industry || undefined,
        organization_size: organizationSize || undefined,
        compliance_requirements: compliance,
        data_residency: dataResidency || undefined,
        organization_notes: organizationNotes || undefined,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleCompliance = (tag: ComplianceTag) => {
    setCompliance(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag],
    );
  };

  const formatDate = (date: Date | string | undefined) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-mesh-gradient flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <SEO
        title="Profile | Plaindr"
        description="Manage your Plaindr profile and preferences"
        robots="noindex, nofollow"
        canonical="https://plaindr.com/profile"
      />
      <div className="min-h-screen bg-mesh-gradient">
        {/* Navigation Header */}
        <header className="fixed top-0 left-0 right-0 z-50 glass-nav">
          <div className="container flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="icon" className="rounded-full">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div className="flex items-center gap-2">
                <img
                  src={theme === 'dark' ? '/plaindrlogotypebw/Plaindr_logo_ICON_white.svg' : '/plaindrlogotypebw/Plaindr_logo_ICON_black.svg'}
                  alt="Plaindr"
                  className="h-10 w-auto"
                />
                <span className="font-semibold text-lg">Profile</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                className="rounded-full"
              >
                {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </Button>
              <SignedIn>
                <Link href="/history">
                  <Button variant="ghost" size="sm" className="gap-2">
                    <History className="w-4 h-4" />
                    <span className="hidden sm:inline">History</span>
                  </Button>
                </Link>
              </SignedIn>
            </div>
          </div>
        </header>

        <main className="pt-24 pb-16 container max-w-3xl">
          <SignedOut>
            <Card className="glass-strong border-0 rounded-2xl">
              <CardContent className="p-8 text-center">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mx-auto mb-6 shadow-lg">
                  <User className="w-8 h-8 text-white" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Sign in to view your profile</h2>
                <p className="text-muted-foreground mb-6">
                  Access your profile settings by signing in to your account.
                </p>
                <SignInButton mode="modal">
                  <Button className="w-full max-w-xs gap-2 btn-gradient rounded-full">
                    Sign In
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </SignInButton>
              </CardContent>
            </Card>
          </SignedOut>

          <SignedIn>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="space-y-6"
            >
              {/* Identity Section */}
              <Card className="glass-card border-0 rounded-2xl overflow-hidden">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <User className="w-5 h-5 text-primary" />
                    Identity
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Avatar and Basic Info */}
                  <div className="flex items-start gap-6">
                    <div className="flex-shrink-0">
                      {profileLoading ? (
                        <Skeleton className="w-20 h-20 rounded-full" />
                      ) : (
                        <Avatar className="w-20 h-20 border-4 border-violet-500/20">
                          <AvatarImage src={clerkUser?.imageUrl} alt={clerkUser?.fullName || 'User'} />
                          <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white text-xl">
                            {(clerkUser?.fullName || clerkUser?.firstName || 'U').charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      )}
                    </div>
                    <div className="flex-1 space-y-4">
                      <div>
                        <Label htmlFor="displayName" className="text-sm text-muted-foreground">Display Name</Label>
                        {profileLoading ? (
                          <Skeleton className="h-10 w-full mt-1.5" />
                        ) : (
                          <Input
                            id="displayName"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            placeholder={clerkUser?.fullName || 'Enter your name'}
                            className="mt-1.5 bg-background/50"
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Read-only info */}
                  <div className="grid sm:grid-cols-2 gap-4 pt-2">
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
                      <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">Email</p>
                        {profileLoading ? (
                          <Skeleton className="h-4 w-32 mt-1" />
                        ) : (
                          <p className="text-sm font-medium truncate">{user?.email || 'No email'}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
                      <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">Member since</p>
                        {profileLoading ? (
                          <Skeleton className="h-4 w-28 mt-1" />
                        ) : (
                          <p className="text-sm font-medium">{formatDate(clerkUser?.createdAt ?? undefined)}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Usage Intent Section */}
              <Card className="glass-card border-0 rounded-2xl overflow-hidden">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Target className="w-5 h-5 text-primary" />
                    Why are you using Plaindr?
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {profileLoading ? (
                    <div className="space-y-3">
                      {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-14 w-full" />
                      ))}
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-2">
                        {USAGE_INTENTS.map((intent) => (
                          <button
                            key={intent.value}
                            onClick={() => setUsageIntent(intent.value)}
                            className={`
                              flex items-center gap-3 p-3 rounded-xl text-left transition-all
                              ${usageIntent === intent.value
                                ? 'bg-primary/10 border-2 border-primary/30'
                                : 'bg-muted/30 border-2 border-transparent hover:bg-muted/50'
                              }
                            `}
                          >
                            <div className={`
                              w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0
                              ${usageIntent === intent.value
                                ? 'border-primary bg-primary'
                                : 'border-muted-foreground/30'
                              }
                            `}>
                              {usageIntent === intent.value && (
                                <Check className="w-3 h-3 text-white" />
                              )}
                            </div>
                            <div>
                              <p className="font-medium text-sm">{intent.label}</p>
                              <p className="text-xs text-muted-foreground">{intent.description}</p>
                            </div>
                          </button>
                        ))}
                      </div>

                      <div className="pt-2">
                        <Label htmlFor="usageNote" className="text-sm text-muted-foreground">
                          Anything else you'd like to share? (optional)
                        </Label>
                        <Textarea
                          id="usageNote"
                          value={usageIntentNote}
                          onChange={(e) => setUsageIntentNote(e.target.value)}
                          placeholder="Tell us more about how you plan to use Plaindr..."
                          className="mt-1.5 bg-background/50 resize-none"
                          rows={3}
                          maxLength={500}
                        />
                        <p className="text-xs text-muted-foreground mt-1 text-right">
                          {usageIntentNote.length}/500
                        </p>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Preferences Section */}
              <Card className="glass-card border-0 rounded-2xl overflow-hidden">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Globe className="w-5 h-5 text-primary" />
                    Preferences
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {profileLoading ? (
                    <div className="space-y-4">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  ) : (
                    <>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="language" className="text-sm text-muted-foreground">Language</Label>
                          <Select value={language} onValueChange={setLanguage}>
                            <SelectTrigger id="language" className="mt-1.5 bg-background/50">
                              <SelectValue placeholder="Select language" />
                            </SelectTrigger>
                            <SelectContent>
                              {LANGUAGES.map((lang) => (
                                <SelectItem key={lang.value} value={lang.value}>
                                  {lang.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor="region" className="text-sm text-muted-foreground">Region (optional)</Label>
                          <Input
                            id="region"
                            value={region}
                            onChange={(e) => setRegion(e.target.value)}
                            placeholder="e.g., United States"
                            className="mt-1.5 bg-background/50"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between p-4 rounded-xl bg-muted/30">
                        <div className="flex items-center gap-3">
                          <Bell className="w-5 h-5 text-muted-foreground" />
                          <div>
                            <p className="font-medium text-sm">Notifications</p>
                            <p className="text-xs text-muted-foreground">Receive updates and announcements</p>
                          </div>
                        </div>
                        <Switch
                          checked={notificationsEnabled}
                          onCheckedChange={setNotificationsEnabled}
                        />
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Organization & compliance — the "tell us about your
                  org" card. Drives fit-scoring and profile-aware Ask
                  Plaindr prompts (e.g. "which AI tool fits my org"
                  implicitly filters for the user's compliance). */}
              <Card className="glass-strong border-0 rounded-2xl">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-primary" />
                    Organization & compliance
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Tell Plaindr about your organization so we can flag which
                    AI tools actually fit your constraints.
                  </p>
                </CardHeader>
                <CardContent className="space-y-6">
                  {profileLoading ? (
                    <>
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-24 w-full" />
                    </>
                  ) : (
                    <>
                      <div>
                        <Label htmlFor="org-name" className="text-sm font-medium">
                          Organization name
                        </Label>
                        <Input
                          id="org-name"
                          value={organizationName}
                          onChange={e => setOrganizationName(e.target.value)}
                          placeholder="Acme Inc."
                          className="mt-1.5 bg-background/50"
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label className="text-sm font-medium">Industry</Label>
                          <Select
                            value={industry}
                            onValueChange={v => setIndustry(v as Industry)}
                          >
                            <SelectTrigger className="mt-1.5 bg-background/50">
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
                          <Label className="text-sm font-medium">
                            Organization size
                          </Label>
                          <Select
                            value={organizationSize}
                            onValueChange={v =>
                              setOrganizationSize(v as OrgSize)
                            }
                          >
                            <SelectTrigger className="mt-1.5 bg-background/50">
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
                                className={
                                  "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors " +
                                  (active
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-background/50 text-muted-foreground border-border hover:border-primary/40 hover:text-foreground")
                                }
                              >
                                {active && <Check className="w-3 h-3" />}
                                {tag}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          Pick every framework your organization must satisfy.
                          Plaindr uses this to flag tools missing coverage.
                        </p>
                      </div>

                      <div>
                        <Label className="text-sm font-medium">
                          Data residency
                        </Label>
                        <Select
                          value={dataResidency}
                          onValueChange={v =>
                            setDataResidency(v as DataResidency)
                          }
                        >
                          <SelectTrigger className="mt-1.5 bg-background/50">
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
                        <Label
                          htmlFor="org-notes"
                          className="text-sm font-medium"
                        >
                          Anything else we should factor in?
                        </Label>
                        <Textarea
                          id="org-notes"
                          value={organizationNotes}
                          onChange={e => setOrganizationNotes(e.target.value)}
                          placeholder="e.g. No US-based subprocessors. 30-day data retention ceiling. BAAs required before onboarding."
                          className="mt-1.5 bg-background/50 min-h-[96px]"
                          maxLength={2000}
                        />
                        <div className="mt-1 text-right text-[10px] font-mono text-muted-foreground">
                          {organizationNotes.length}/2000
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Account Metadata (subtle) */}
              {profile && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center justify-between px-4 text-xs text-muted-foreground"
                >
                  <span>Account active</span>
                  <span>Last updated: {formatDate(profile.updated_at)}</span>
                </motion.div>
              )}

              {/* Save Button */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="flex justify-end pt-2"
              >
                <Button
                  onClick={handleSave}
                  disabled={!hasChanges || isSaving || profileLoading}
                  className="gap-2 btn-gradient rounded-full px-8"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Save Changes
                    </>
                  )}
                </Button>
              </motion.div>
            </motion.div>
          </SignedIn>
        </main>
      </div>
    </>
  );
}
