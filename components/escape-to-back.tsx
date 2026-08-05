"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

// Global Escape-to-go-back for the app shell. The dashboard handles its own
// Escape (closes the detail pane) instead of navigating, so it's excluded
// here. The quote builder pages (/quotes/new, /quotes/[id]) are excluded
// too — there's no autosave yet, so navigating away on an accidental Escape
// while editing a quote would silently discard unsaved pricing changes.
// See BACKLOG.md for the existing autosave note; revisit this exclusion
// once that's built.
const EXCLUDED_PREFIXES = ["/dashboard", "/quotes"];

export function EscapeToBack() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (EXCLUDED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      router.back();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pathname, router]);

  return null;
}
