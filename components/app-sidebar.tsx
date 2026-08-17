"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore, type ComponentType } from "react";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import {
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Plane,
  Users,
  Inbox,
  Settings,
  ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  badge?: number;
};

const STORAGE_KEY = "jetdeck-sidebar-collapsed";

// A tiny external store (rather than useState+useEffect) so the collapsed
// flag can be read from localStorage without a post-mount setState — that
// pattern causes an extra render and trips the set-state-in-effect lint
// rule. useSyncExternalStore also handles the server/client snapshot
// mismatch for us: it renders the server snapshot (false) until hydration
// completes, then swaps to the real localStorage value.
const collapseListeners = new Set<() => void>();
function getCollapsedSnapshot() {
  return localStorage.getItem(STORAGE_KEY) === "1";
}
function getServerSnapshot() {
  return false;
}
function subscribeToCollapsed(callback: () => void) {
  collapseListeners.add(callback);
  return () => collapseListeners.delete(callback);
}
function setCollapsed(value: boolean) {
  localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  collapseListeners.forEach((listener) => listener());
}

export function AppSidebar({
  needsReviewCount = 0,
  showFleet = true,
}: {
  needsReviewCount?: number;
  showFleet?: boolean;
}) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribeToCollapsed, getCollapsedSnapshot, getServerSnapshot);

  function toggle() {
    setCollapsed(!collapsed);
  }

  // Which side of the Sales/Ops switcher is active is derived straight from
  // the URL rather than tracked as separate state — /ops(.*) is the only
  // thing that means "Ops", so the pathname is already the source of truth.
  const mode: "sales" | "ops" = pathname.startsWith("/ops") ? "ops" : "sales";

  const salesItems: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ...(showFleet ? [{ href: "/fleet", label: "Fleet", icon: Plane }] : []),
    { href: "/contacts", label: "Contacts", icon: Users },
    { href: "/inbox/review", label: "Needs Review", icon: Inbox, badge: needsReviewCount },
    { href: "/settings", label: "Settings", icon: Settings },
  ];
  const opsItems: NavItem[] = [{ href: "/ops/trips", label: "Trips", icon: ClipboardList }];
  const items = mode === "sales" ? salesItems : opsItems;

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-border bg-card transition-[width] duration-200",
        collapsed ? "w-14" : "w-56"
      )}
    >
      <div className="flex items-center justify-between px-3 py-3">
        {!collapsed && (
          <span className="text-sm font-semibold tracking-wide text-primary">JETDECK</span>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <div className="px-3">
        <div className="relative grid grid-cols-2 rounded-lg bg-muted p-1 text-xs font-medium">
          <div
            className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-md bg-background shadow-sm transition-transform duration-200 ease-out"
            style={{ transform: mode === "ops" ? "translateX(calc(100% + 0.25rem))" : "translateX(0)" }}
          />
          <Link
            href="/dashboard"
            className={cn(
              "relative z-10 rounded-md px-1 py-1.5 text-center transition-colors",
              mode === "sales" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {collapsed ? "S" : "Sales"}
          </Link>
          <Link
            href="/ops"
            className={cn(
              "relative z-10 rounded-md px-1 py-1.5 text-center transition-colors",
              mode === "ops" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {collapsed ? "O" : "Ops"}
          </Link>
        </div>
      </div>

      <nav className="mt-4 flex flex-1 flex-col gap-0.5 px-2">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "relative flex items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors",
                active
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
              {!!item.badge && (
                <span
                  className={cn(
                    "flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-medium text-accent-foreground",
                    collapsed && "absolute right-1.5"
                  )}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className={cn("flex items-center gap-2 border-t border-border p-3", collapsed && "flex-col")}>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <OrganizationSwitcher hidePersonal />
          </div>
        )}
        <UserButton />
      </div>
    </aside>
  );
}
