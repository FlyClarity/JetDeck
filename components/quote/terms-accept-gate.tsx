"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SCROLL_THRESHOLD_PX = 16;

export function TermsAcceptGate({
  termsText,
  depositPercent,
  action,
}: {
  termsText: string | null;
  depositPercent: number;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [scrolledToEnd, setScrolledToEnd] = useState(!termsText);
  const checkedInitialOverflow = useRef(false);

  function checkScrolled(el: HTMLDivElement) {
    if (el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD_PX) {
      setScrolledToEnd(true);
    }
  }

  const canAccept = scrolledToEnd && name.trim().length > 1;

  return (
    <div className="flex flex-col gap-4">
      {termsText && (
        <section>
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Charter Terms
          </h2>
          <div
            ref={(el) => {
              // If the terms are short enough to already fit without
              // scrolling, there's nothing to scroll to — don't block on it.
              if (el && !checkedInitialOverflow.current) {
                checkedInitialOverflow.current = true;
                checkScrolled(el);
              }
            }}
            onScroll={(e) => checkScrolled(e.currentTarget)}
            className="mt-2 max-h-64 overflow-y-auto rounded-md border border-border p-3 text-sm whitespace-pre-wrap text-muted-foreground"
          >
            {termsText}
          </div>
          {!scrolledToEnd && (
            <p className="mt-1 text-xs text-muted-foreground">
              Scroll to the bottom of the terms to continue.
            </p>
          )}
        </section>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="acceptedByNameInput">
          Type your full name to confirm you&apos;ve read the terms above
        </Label>
        <Input
          id="acceptedByNameInput"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
        />
      </div>

      <p className="text-sm text-muted-foreground">
        By clicking the button below, you confirm that you have read and agree to the Charter
        Terms above and authorize a credit card hold of {Math.round(depositPercent * 100)}% of
        the total as a booking deposit.
      </p>

      <form action={action}>
        <input type="hidden" name="acceptedByName" value={name} />
        <Button type="submit" size="lg" className="w-full" disabled={!canAccept}>
          I Accept — Book This Charter
        </Button>
      </form>
    </div>
  );
}
