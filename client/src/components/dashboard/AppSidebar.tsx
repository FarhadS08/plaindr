import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity,
  BookMarked,
  FileText,
  GitPullRequestArrow,
  LayoutDashboard,
  LogOut,
  Mail,
  Moon,
  PanelLeft,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
  Building2,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api, encodeSourceUrlForRoute } from "@/lib/api";
import { useAuth } from "@/contexts/ClerkContext";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";
import { formatRelativeTime, riskTone } from "./diff-helpers";
import { trpc } from "@/lib/trpc";

const navItems = [
  { icon: LayoutDashboard, label: "Overview", path: "/dashboard" },
  { icon: Sparkles, label: "Ask Plaindr", path: "/dashboard/chat" },
  { icon: FileText, label: "Policies", path: "/dashboard/policies" },
  { icon: BookMarked, label: "Library", path: "/dashboard/library" },
];

// Org-only nav. Rendered when an org is the active context. Settings
// is last because people only touch it rarely. Profile gates to the
// owner since it drives org-wide tool fit.
const orgNavItems = [
  { icon: LayoutDashboard, label: "Overview", path: "/org" },
  { icon: Users, label: "Members", path: "/org/members" },
  { icon: Mail, label: "Invites", path: "/org/invites", adminOnly: true },
  { icon: ShieldCheck, label: "Profile", path: "/org/profile", ownerOnly: true },
  { icon: Settings, label: "Settings", path: "/org/settings" },
];

export function AppSidebar() {
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();

  // Active org gates the whole Organization section — in personal
  // mode those nav items are meaningless, so they just don't exist.
  const activeOrgQuery = trpc.organizations.getActive.useQuery(undefined, {
    staleTime: 60_000,
  });
  const activeOrg = activeOrgQuery.data;

  const { data: recent, isLoading: loadingDiffs } = useQuery({
    queryKey: ["sidebar-recent"],
    queryFn: () => api.recentDiffs(5),
    staleTime: 60_000,
  });

  const { data: companies } = useQuery({
    queryKey: ["sidebar-companies"],
    queryFn: api.listCompanies,
    staleTime: 5 * 60_000,
  });

  return (
    <Sidebar collapsible="icon" className="border-r bg-sidebar">
      <SidebarHeader className="h-16 justify-center border-b border-sidebar-border">
        <div className="flex items-center gap-2.5 px-2 w-full">
          <button
            onClick={toggleSidebar}
            className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-sidebar-accent/80 transition-colors shrink-0"
            aria-label="Toggle sidebar"
          >
            <PanelLeft className="h-4 w-4 text-sidebar-foreground/70" />
          </button>
          {!isCollapsed && (
            <Link href="/dashboard" className="flex items-center gap-2 min-w-0">
              <img
                src="/plaindrlogotypebw/Plaindr_logo_ICON_black.svg"
                alt=""
                aria-hidden
                className="h-6 w-6 shrink-0 dark:hidden"
              />
              <img
                src="/plaindrlogotypebw/Plaindr_logo_ICON_white.svg"
                alt=""
                aria-hidden
                className="h-6 w-6 shrink-0 hidden dark:block"
              />
              <span className="font-semibold tracking-tight text-[15px]">Plaindr</span>
              <Badge
                variant="outline"
                className="ml-auto text-[10px] font-mono uppercase tracking-widest h-5 px-1.5 border-sidebar-border"
              >
                beta
              </Badge>
            </Link>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0">
        <SidebarGroup>
          {!isCollapsed && (
            <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.12em] text-sidebar-foreground/50">
              Personal
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {navItems.map(item => {
                const isActive =
                  location === item.path ||
                  (item.path !== "/dashboard" && location.startsWith(item.path));
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className={cn(
                        "h-9 transition-colors font-normal",
                        isActive &&
                          "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {activeOrg && (
          <SidebarGroup>
            {!isCollapsed && (
              <SidebarGroupLabel className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-sidebar-foreground/50">
                <Building2 className="h-3 w-3" />
                <span className="truncate">{activeOrg.name}</span>
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {orgNavItems
                  .filter(item => {
                    if (item.ownerOnly && activeOrg.role !== "owner")
                      return false;
                    if (
                      item.adminOnly &&
                      activeOrg.role !== "owner" &&
                      activeOrg.role !== "admin"
                    )
                      return false;
                    return true;
                  })
                  .map(item => {
                    // `/org` must only match exactly, otherwise it'd also
                    // highlight for every nested org page.
                    const isActive =
                      item.path === "/org"
                        ? location === "/org"
                        : location === item.path ||
                          location.startsWith(item.path + "/");
                    return (
                      <SidebarMenuItem key={item.path}>
                        <SidebarMenuButton
                          isActive={isActive}
                          onClick={() => setLocation(item.path)}
                          tooltip={item.label}
                          className={cn(
                            "h-9 transition-colors font-normal",
                            isActive &&
                              "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
                          )}
                        >
                          <item.icon className="h-4 w-4" />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {!isCollapsed && (
          <>
            <SidebarGroup>
              <SidebarGroupLabel className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-sidebar-foreground/50">
                <Activity className="h-3 w-3" />
                Recent changes
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <ScrollArea className="h-[260px]">
                  <div className="px-2 py-1 space-y-0.5">
                    {loadingDiffs && (
                      <>
                        {[0, 1, 2, 3].map(i => (
                          <div key={i} className="py-2">
                            <Skeleton className="h-3 w-full mb-1.5" />
                            <Skeleton className="h-2 w-2/3" />
                          </div>
                        ))}
                      </>
                    )}
                    {!loadingDiffs && recent?.length === 0 && (
                      <p className="text-xs text-sidebar-foreground/50 py-2 px-1">
                        No recent diffs yet.
                      </p>
                    )}
                    {recent?.map(diff => {
                      const company = companies?.find(c => c.id === diff.author_id);
                      const risk = diff.analysis?.risk_level ?? "low";
                      return (
                        <Link
                          key={diff.id}
                          href={`/dashboard/diffs/${diff.id}`}
                          className="group block rounded-md px-2 py-1.5 hover:bg-sidebar-accent/60 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full shrink-0",
                                riskTone(risk).dot,
                              )}
                            />
                            <span className="text-[12px] truncate text-sidebar-foreground/90 group-hover:text-sidebar-foreground">
                              {company?.name ?? "Unknown"}
                            </span>
                            <span className="ml-auto text-[10px] font-mono text-sidebar-foreground/50 shrink-0">
                              {formatRelativeTime(diff.computed_at, { short: true })}
                            </span>
                          </div>
                          <div className="text-[11px] text-sidebar-foreground/60 font-mono truncate mt-0.5">
                            <span className="text-emerald-600 dark:text-emerald-400">
                              +{diff.stats.lines_added}
                            </span>
                            <span className="mx-1 opacity-40">·</span>
                            <span className="text-rose-600 dark:text-rose-400">
                              -{diff.stats.lines_removed}
                            </span>
                            <span className="mx-1 opacity-40">·</span>
                            <span className="truncate">v{diff.new_version}</span>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </ScrollArea>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-sidebar-foreground/50">
                <Building2 className="h-3 w-3" />
                Companies
                <span className="ml-auto font-mono normal-case tracking-normal text-sidebar-foreground/40">
                  {companies?.length ?? 0}
                </span>
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <ScrollArea className="h-[180px]">
                  <div className="px-2 space-y-0.5">
                    {companies?.slice(0, 40).map(c => (
                      <Link
                        key={c.id}
                        href={`/dashboard/policies?company=${encodeSourceUrlForRoute(c.slug)}`}
                        className="flex items-center justify-between rounded-md px-2 py-1 text-[12px] text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground transition-colors"
                      >
                        <span className="truncate">{c.name}</span>
                        {c.category && (
                          <span className="text-[10px] font-mono uppercase tracking-wider text-sidebar-foreground/40 ml-2 shrink-0">
                            {c.category.slice(0, 6)}
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                </ScrollArea>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="p-2 border-t border-sidebar-border">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2 py-1.5 w-full text-left hover:bg-sidebar-accent/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                isCollapsed && "justify-center",
              )}
            >
              <Avatar className="h-7 w-7 border border-sidebar-border shrink-0">
                {user?.imageUrl && <AvatarImage src={user.imageUrl} />}
                <AvatarFallback className="text-[11px] font-medium bg-gradient-to-br from-primary/30 to-primary/10 text-primary">
                  {user?.name?.charAt(0).toUpperCase() ?? "?"}
                </AvatarFallback>
              </Avatar>
              {!isCollapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium truncate leading-tight">
                    {user?.name ?? "Signed in"}
                  </p>
                  <p className="text-[11px] text-sidebar-foreground/50 truncate mt-0.5">
                    {user?.email ?? ""}
                  </p>
                </div>
              )}
              {!isCollapsed && (
                <GitPullRequestArrow className="h-3.5 w-3.5 text-sidebar-foreground/40" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-52">
            {toggleTheme && (
              <DropdownMenuItem onClick={toggleTheme}>
                {theme === "dark" ? (
                  <>
                    <Sun className="mr-2 h-4 w-4" /> Light mode
                  </>
                ) : (
                  <>
                    <Moon className="mr-2 h-4 w-4" /> Dark mode
                  </>
                )}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => setLocation("/profile")}>
              Profile
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut()}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
