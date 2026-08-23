"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The server has no idea what timezone the viewer is actually in — Vercel's
// own clock runs on UTC, which silently drifts a calendar day ahead of
// anyone west of Greenwich for several hours a day (e.g. still the 22nd
// locally at 9pm Eastern, but already the 23rd in UTC). Bounces through one
// client-side redirect to pick up the browser's real local date instead of
// guessing from the server clock — preserves an explicit `start` if the
// page was already asked to jump to a specific window.
export function CalendarTodayRedirect({ start }: { start?: string }) {
  const router = useRouter();

  useEffect(() => {
    const now = new Date();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    params.set("today", todayIso);
    router.replace(`/ops/calendar?${params.toString()}`);
  }, [router, start]);

  return (
    <div className="w-full px-6 py-10">
      <p className="text-muted-foreground">Loading…</p>
    </div>
  );
}
