"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { CommandPalette } from "@/components/command-palette";

// Shared by both (app) and (ops) layouts — previously each had its own
// near-duplicate horizontal header. The Sales/Ops split ("mode") is derived
// straight from the current pathname rather than tracked as separate state
// — /ops(.*) is the only thing that means "Ops" — which also drives the
// switcher's active side.
export function AppHeader({
  needsReviewCount = 0,
  showFleet = true,
}: {
  needsReviewCount?: number;
  showFleet?: boolean;
}) {
  const pathname = usePathname();
  const mode: "sales" | "ops" = pathname.startsWith("/ops") ? "ops" : "sales";

  const salesItems: { href: string; label: string; badge?: number }[] = [
    { href: "/dashboard", label: "Dashboard" },
    ...(showFleet ? [{ href: "/fleet", label: "Fleet" }] : []),
    ...(showFleet ? [{ href: "/ops/calendar", label: "Calendar" }] : []),
    { href: "/contacts", label: "Contacts" },
    { href: "/sourcing", label: "Sourcing" },
    { href: "/inbox/review", label: "Needs Review", badge: needsReviewCount },
    { href: "/settings", label: "Settings" },
  ];
  const opsItems: { href: string; label: string; badge?: number }[] = [
    { href: "/ops/board", label: "Board" },
    ...(showFleet ? [{ href: "/ops/calendar", label: "Calendar" }] : []),
    { href: "/ops/trips", label: "Trips" },
    { href: "/ops/crew", label: "Crew" },
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
