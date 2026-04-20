import { type CSSProperties, type ReactNode } from "react";
import { Link } from "wouter";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { SignedIn, SignedOut, SignInButton } from "@/contexts/ClerkContext";
import { Moon, Search, Sun } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { AppSidebar } from "./AppSidebar";
import {
  CommandPalette,
  useCommandPalette,
} from "./CommandPalette";
import { OrgSwitcher } from "./OrgSwitcher";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; href?: string };

type DashboardShellProps = {
  children: ReactNode;
  crumbs?: Crumb[];
  /** When true, the main pane renders at the full viewport width with no padding. */
  flush?: boolean;
  /** Right-aligned slot in the top bar, usually action buttons. */
  actions?: ReactNode;
};

const DEFAULT_STYLE = {
  "--sidebar-width": "17rem",
  "--sidebar-width-icon": "3rem",
} as CSSProperties;

export function DashboardShell({
  children,
  crumbs,
  flush = false,
  actions,
}: DashboardShellProps) {
  const { theme, toggleTheme } = useTheme();
  const palette = useCommandPalette();

  return (
    <>
      <SignedOut>
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="w-full max-w-md px-8 py-12 text-center">
            <div className="mx-auto mb-6 h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-primary/60" />
            <h1 className="text-2xl font-semibold tracking-tight">
              Plaindr dashboard
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in to see policy changes across the AI ecosystem in one feed.
            </p>
            <div className="mt-8">
              <SignInButton mode="modal">
                <Button size="lg" className="w-full">Sign in</Button>
              </SignInButton>
            </div>
          </div>
        </div>
      </SignedOut>

      <SignedIn>
        <SidebarProvider style={DEFAULT_STYLE}>
          <AppSidebar />
          <SidebarInset className="flex flex-col min-h-screen">
            <header className="sticky top-0 z-30 h-14 border-b border-border bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
              <div className="h-full flex items-center gap-3 px-4">
                <SidebarTrigger className="h-8 w-8 md:hidden" />
                {crumbs && crumbs.length > 0 && (
                  <Breadcrumb>
                    <BreadcrumbList className="gap-1.5 text-[13px]">
                      {crumbs.map((c, i) => {
                        const isLast = i === crumbs.length - 1;
                        return (
                          <span key={`${c.label}-${i}`} className="flex items-center gap-1.5">
                            <BreadcrumbItem>
                              {isLast || !c.href ? (
                                <BreadcrumbPage className="font-medium text-foreground">
                                  {c.label}
                                </BreadcrumbPage>
                              ) : (
                                <BreadcrumbLink asChild>
                                  <Link
                                    href={c.href}
                                    className="text-muted-foreground hover:text-foreground"
                                  >
                                    {c.label}
                                  </Link>
                                </BreadcrumbLink>
                              )}
                            </BreadcrumbItem>
                            {!isLast && (
                              <BreadcrumbSeparator className="text-muted-foreground/50" />
                            )}
                          </span>
                        );
                      })}
                    </BreadcrumbList>
                  </Breadcrumb>
                )}

                <OrgSwitcher />

                <div className="flex-1" />

                <button
                  type="button"
                  onClick={() => palette.setOpen(true)}
                  aria-label="Open command palette (⌘K)"
                  className="hidden md:flex items-center gap-2 h-8 w-72 pl-2.5 pr-2 rounded-md bg-muted/40 border border-border hover:bg-muted/60 hover:border-border text-[13px] text-muted-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Search className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 text-left truncate">
                    Search policies, companies, diffs…
                  </span>
                  <Kbd className="text-[10px] h-5 shrink-0">⌘K</Kbd>
                </button>

                {actions}

                {toggleTheme && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggleTheme}
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    aria-label="Toggle theme"
                  >
                    {theme === "dark" ? (
                      <Sun className="h-4 w-4" />
                    ) : (
                      <Moon className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>
            </header>

            <main
              className={cn(
                "flex-1 min-h-0",
                flush ? "" : "px-4 md:px-6 lg:px-8 py-6",
              )}
            >
              {children}
            </main>
          </SidebarInset>
        </SidebarProvider>
        <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
      </SignedIn>
    </>
  );
}
