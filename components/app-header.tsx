"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { CommandPalette } from "@/components/command-palette";

// Fleet, Calendar, Contacts, and Settings appear in both salesItems and
// opsItems below — genuinely shared pages, not owned by either side. The
// mode shouldn't flip just because their URL happens to fall on one side
// or the other (Fleet/Contacts/Settings aren't under /ops, Calendar is) —
// that used to yank someone from Ops into Sales (or vice versa) the moment
// they opened one, discarding the context they were just in. See NAV_MODE_KEY.
const SHARED_PATHS = ["/fleet", "/contacts", "/settings", "/ops/calendar"];
function isSharedPath(pathname: string) {
  return SHARED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// localStorage (a per-browser convenience, not data) holds whichever mode
// was last derived from a non-shared page, read back on a shared one.
// useSyncExternalStore rather than a plain useEffect+setState — it's the
// correct tool for mirroring an external store into React state without
// the extra render pass or SSR/hydration mismatch a naive read would cause
// (server has no localStorage, so getServerSnapshot fixes the value it
// renders with up front instead of guessing). subscribe also picks up
// another tab changing the mode, via the standard "storage" event, plus a
// same-tab custom event since "storage" deliberately never fires in the
// tab that made the write.
const NAV_MODE_KEY = "jetdeck:navMode";
const NAV_MODE_EVENT = "jetdeck:navmode-changed";

function readNavMode(): "sales" | "ops" | null {
  try {
    const stored = window.localStorage.getItem(NAV_MODE_KEY);
    return stored === "sales" || stored === "ops" ? stored : null;
  } catch {
    return null;
  }
}

function writeNavMode(mode: "sales" | "ops") {
  try {
    window.localStorage.setItem(NAV_MODE_KEY, mode);
    window.dispatchEvent(new Event(NAV_MODE_EVENT));
  } catch {
    // localStorage can throw (private browsing, blocked storage) — a
    // shared page just falls back to defaulting to Sales.
  }
}

function subscribeToNavMode(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(NAV_MODE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(NAV_MODE_EVENT, callback);
  };
}

function getNavModeServerSnapshot() {
  return null;
}

// Shared by both (app) and (ops) layouts — previously each had its own
// near-duplicate horizontal header. The Sales/Ops split ("mode") is derived
// from the current pathname on a page that's exclusively one side or the
// other — /ops(.*) (minus the shared Calendar route) means Ops, everything
// else means Sales — and that choice is remembered so a shared page can
// show whichever side the person was last actually working in, instead of
// guessing wrong from its own URL.
export function AppHeader({
  needsReviewCount = 0,
  showFleet = true,
}: {
  needsReviewCount?: number;
  showFleet?: boolean;
}) {
  const pathname = usePathname();
  const shared = isSharedPath(pathname);
  const derivedMode: "sales" | "ops" = pathname.startsWith("/ops") ? "ops" : "sales";
  const storedMode = useSyncExternalStore(subscribeToNavMode, readNavMode, getNavModeServerSnapshot);

  useEffect(() => {
    if (!shared) writeNavMode(derivedMode);
  }, [shared, derivedMode]);

  const mode: "sales" | "ops" = shared ? (storedMode ?? "sales") : derivedMode;

  const salesItems: { href: string; label: string; badge?: number }[] = [
    { href: "/dashboard", label: "Dashboard" },
    ...(showFleet ? [{ href: "/fleet", label: "Fleet" }] : []),
    ...(showFleet ? [{ href: "/ops/calendar", label: "Calendar" }] : []),
    { href: "/contacts", label: "Contacts" },
    { href: "/inbox/review", label: "Needs Review", badge: needsReviewCount },
    { href: "/settings", label: "Settings" },
  ];
  const opsItems: { href: string; label: string; badge?: number }[] = [
    { href: "/ops/board", label: "Board" },
    ...(showFleet ? [{ href: "/fleet", label: "Fleet" }] : []),
    ...(showFleet ? [{ href: "/ops/calendar", label: "Calendar" }] : []),
    { href: "/ops/trips", label: "Trips" },
    { href: "/ops/crew", label: "Crew" },
    { href: "/ops/documents", label: "Documents" },
    { href: "/contacts", label: "Contacts" },
    { href: "/settings", label: "Settings" },
  ];
  const items = mode === "sales" ? salesItems : opsItems;

  return (
    <header className="flex items-center justify-between border-b border-border px-6 py-3">
      <div className="flex items-center gap-4">
        <span className="text-sm font-semibold tracking-wide text-primary">
          {mode === "ops" ? "JETDECK OPS" : "JETDECK"}
        </span>
        <div className="relative grid grid-cols-2 rounded-lg bg-muted p-1 text-xs font-medium">
          <div
            // left-1 anchors the untransformed (Sales) position at a 4px
            // inset matching the pill's own p-1. The width has to leave room
            // for BOTH that left inset and a matching 4px inset on the right
            // once translateX slides it over for Ops — translateX(100%) is
            // relative to the element's own width, so sliding by "its own
            // width + 4px" lands its right edge at
            // left(4px) + width + width + 4px, which only ends up 4px from
            // the container's right edge if width is 50% MINUS both of
            // those 4px insets (0.375rem = 4px start inset + 4px middle gap,
            // halved) — not just one. Using only one 4px subtraction (as
            // this originally shipped) left the Ops position flush against
            // the right edge, the same bug the Sales fix was meant to solve.
            className="absolute inset-y-1 left-1 w-[calc(50%-0.375rem)] rounded-md bg-background shadow-sm transition-transform duration-200 ease-out"
            style={{ transform: mode === "ops" ? "translateX(calc(100% + 0.25rem))" : "translateX(0)" }}
          />
          <Link
            href="/dashboard"
            className={cn(
              "relative z-10 rounded-md px-3 py-1 text-center transition-colors",
              mode === "sales" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Sales
          </Link>
          <Link
            href="/ops"
            className={cn(
              "relative z-10 rounded-md px-3 py-1 text-center transition-colors",
              mode === "ops" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Ops
          </Link>
        </div>
      </div>
      <div className="flex items-center gap-4">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-1.5 text-sm transition-colors",
                active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {item.label}
              {!!item.badge && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-medium text-accent-foreground">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
        <CommandPalette />
        <OrganizationSwitcher hidePersonal />
        <UserButton />
      </div>
    </header>
  );
}
