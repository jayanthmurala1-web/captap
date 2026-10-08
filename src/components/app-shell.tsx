"use client";

import {
  Check,
  ChevronsUpDown,
  FolderKanban,
  LogOut,
  Menu,
  Moon,
  Plug,
  ScrollText,
  Sparkles,
  Store,
  Sun,
  Users,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { BetaPill } from "./auth-frame";

type ShellProps = {
  user: { name?: string | null; email: string };
  orgName: string | null;
  /** Every org the viewer belongs to, for the workspace switcher. */
  orgs: { id: string; name: string; role: string }[];
  activeOrgId: string;
  projects: { id: string; name: string }[];
  /** Whether the viewer's role has "Activity log". */
  canViewActivity: boolean;
  /** Whether the viewer's role has "Org settings" (gates Connections). */
  canManageOrg: boolean;
  children: React.ReactNode;
};

export function AppShell({
  user,
  orgName,
  orgs,
  activeOrgId,
  projects,
  canViewActivity,
  canManageOrg,
  children,
}: ShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const nav = (
    <SidebarContent
      user={user}
      orgName={orgName}
      orgs={orgs}
      activeOrgId={activeOrgId}
      projects={projects}
      canViewActivity={canViewActivity}
      canManageOrg={canManageOrg}
      onNavigate={() => setMobileOpen(false)}
    />
  );

  return (
    <div className="flex min-h-dvh w-full">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-sidebar-border bg-sidebar lg:block">
        {nav}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/85 px-4 backdrop-blur-md lg:hidden">
          <Wordmark />
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-72 border-sidebar-border bg-sidebar p-0"
            >
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              {nav}
            </SheetContent>
          </Sheet>
        </header>
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}

function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <Link
        href="/"
        className="font-wordmark text-2xl leading-none text-primary"
        aria-label="Captap home"
      >
        Captap
      </Link>
      <BetaPill />
    </span>
  );
}

function SidebarContent({
  user,
  orgName,
  orgs,
  activeOrgId,
  projects,
  canViewActivity,
  canManageOrg,
  onNavigate,
}: Omit<ShellProps, "children"> & { onNavigate: () => void }) {
  const pathname = usePathname();
  const activeProjectId = pathname.match(/^\/projects\/([^/]+)/)?.[1];

  return (
    <div className="flex h-full flex-col gap-6 p-4 text-sidebar-foreground">
      <div className="px-2 pt-1">
        <Wordmark />
        {orgName && (
          <OrgSwitcher
            orgs={orgs}
            activeOrgId={activeOrgId}
            orgName={orgName}
          />
        )}
      </div>

      <nav className="flex flex-col gap-0.5" aria-label="Main">
        <NavLink
          href="/agent"
          active={pathname.startsWith("/agent")}
          icon={Sparkles}
          onNavigate={onNavigate}
        >
          Agent
        </NavLink>
        <NavLink
          href="/"
          active={pathname === "/"}
          icon={FolderKanban}
          onNavigate={onNavigate}
        >
          Projects
        </NavLink>
        <NavLink
          href="/members"
          active={pathname.startsWith("/members")}
          icon={Users}
          onNavigate={onNavigate}
        >
          Team
        </NavLink>
        <NavLink
          href="/flow"
          active={pathname.startsWith("/flow")}
          icon={Workflow}
          onNavigate={onNavigate}
        >
          Org Flow
        </NavLink>
        <NavLink
          href="/marketplace"
          active={pathname.startsWith("/marketplace")}
          icon={Store}
          onNavigate={onNavigate}
        >
          Marketplace
        </NavLink>
        {canManageOrg && (
          <NavLink
            href="/connections"
            active={pathname.startsWith("/connections")}
            icon={Plug}
            onNavigate={onNavigate}
          >
            Connections
          </NavLink>
        )}
        {canViewActivity && (
          <NavLink
            href="/activity"
            active={pathname.startsWith("/activity")}
            icon={ScrollText}
            onNavigate={onNavigate}
          >
            Activity
          </NavLink>
        )}
      </nav>

      {projects.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col gap-1">
          <p className="px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Your projects
          </p>
          <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                onClick={onNavigate}
                aria-current={p.id === activeProjectId ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  p.id === activeProjectId &&
                    "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-semibold uppercase text-muted-foreground",
                    p.id === activeProjectId &&
                      "bg-primary text-primary-foreground",
                  )}
                >
                  {p.name.slice(0, 2)}
                </span>
                <span className="truncate">{p.name}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <UserMenu user={user} />
    </div>
  );
}

function NavLink({
  href,
  active,
  icon: Icon,
  onNavigate,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  onNavigate: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active &&
          "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
      )}
    >
      <Icon className="size-4 text-muted-foreground" />
      {children}
    </Link>
  );
}

function OrgSwitcher({
  orgs,
  activeOrgId,
  orgName,
}: {
  orgs: ShellProps["orgs"];
  activeOrgId: string;
  orgName: string;
}) {
  const [pending, setPending] = useState(false);

  const switchTo = (organizationId: string) => {
    if (organizationId === activeOrgId || pending) return;
    setPending(true);
    authClient.organization.setActive({
      organizationId,
      fetchOptions: {
        onSuccess: () => {
          window.location.href = "/";
        },
        onError: () => setPending(false),
      },
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="mt-1.5 flex w-full items-center gap-1 rounded-md px-0.5 py-0.5 text-left text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <span className="min-w-0 flex-1 truncate">{orgName}</span>
          {orgs.length > 1 && (
            <ChevronsUpDown className="size-3 shrink-0 opacity-60" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="w-56">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {orgs.map((o) => (
          <DropdownMenuItem key={o.id} onSelect={() => switchTo(o.id)}>
            <span className="flex-1 truncate">{o.name}</span>
            {o.id === activeOrgId && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ user }: { user: ShellProps["user"] }) {
  const label = user.name || user.email;
  const initials = label
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");

  const toggleTheme = () => {
    const dark = document.documentElement.classList.toggle("dark");
    // biome-ignore lint/suspicious/noDocumentCookie: a one-line preference cookie; Cookie Store API isn't in Safari
    document.cookie = `theme=${dark ? "dark" : "light"}; path=/; max-age=31536000; samesite=lax`;
  };

  const signOut = () =>
    authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.href = "/sign-in";
        },
      },
    });

  return (
    <div className="mt-auto">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-sidebar-accent"
          >
            <Avatar className="size-8">
              <AvatarFallback className="bg-primary/15 text-xs font-semibold uppercase text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {label}
              </span>
              {user.name && (
                <span className="block truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              )}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56">
          <DropdownMenuLabel className="truncate">
            {user.email}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={toggleTheme}>
            <Sun className="hidden dark:block" />
            <Moon className="dark:hidden" />
            <span className="dark:hidden">Dark theme</span>
            <span className="hidden dark:inline">Light theme</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={signOut}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
