"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SettingsTabKey = "payments" | "email" | "branding" | "website" | "quoting" | "sourcing";

const TABS: { key: SettingsTabKey; label: string }[] = [
  { key: "payments", label: "Payments" },
  { key: "email", label: "Email" },
  { key: "branding", label: "Branding" },
  { key: "website", label: "Website" },
  { key: "quoting", label: "Quoting Defaults" },
  { key: "sourcing", label: "Sourcing" },
];

const ActiveTabContext = createContext<SettingsTabKey>("payments");

function isTabKey(value: string | undefined): value is SettingsTabKey {
  return TABS.some((t) => t.key === value);
}

// One tab bar controlling two separate DOM subtrees: some settings sections
// have their own standalone forms (Stripe connect/dashboard) that can't
// nest inside the single big `updateSettings` form the rest of the fields
// submit through — nested <form> elements aren't valid HTML. Sharing this
// context lets a SettingsTabPanel for the same key show/hide in both places
// in sync, without the two ever needing to be siblings in the DOM.
export function SettingsTabProvider({
  initialTab,
  children,
}: {
  // e.g. a "/sourcing" link that now redirects to "/settings?tab=sourcing"
  // — lands on the right tab instead of always defaulting to Payments.
  initialTab?: string;
  children: ReactNode;
}) {
  const [active, setActive] = useState<SettingsTabKey>(isTabKey(initialTab) ? initialTab : "payments");

  return (
    <ActiveTabContext.Provider value={active}>
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActive(tab.key)}
            className={cn(
              "rounded-t-md px-3 py-1.5 text-sm font-medium transition-colors",
              active === tab.key
                ? "border-b-2 border-accent text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {children}
    </ActiveTabContext.Provider>
  );
}

export function SettingsTabPanel({ tabKey, children }: { tabKey: SettingsTabKey; children: ReactNode }) {
  const active = useContext(ActiveTabContext);
  return <div className={active === tabKey ? "mt-6 flex flex-col gap-6" : "hidden"}>{children}</div>;
}
