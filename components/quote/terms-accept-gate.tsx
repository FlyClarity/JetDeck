"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const SCROLL_THRESHOLD_PX = 16;

function formatCurrency(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function TermsAcceptGate({
  termsText,
  depositAmount,
  ccProcessingFeePercent,
  waivesCardHold,
  action,
}: {
  termsText: string | null;
  // Dollar amount due for the flight before any card processing fee — null
  // or 0 when nothing is owed up front (no payment step at all in that
  // case). Named after the underlying Operator.depositPercent setting, but
  // shown to the client simply as payment for their flight, not a "deposit."
  depositAmount: number | null;
  ccProcessingFeePercent: number;
  // Cash-on-account clients (Contacts page) skip Stripe entirely — no card
  // hold, no payment method choice, billed outside JetDeck instead.
  waivesCardHold: boolean;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [scrolledToEnd, setScrolledToEnd] = useState(!termsText);
  const [paymentMethod, setPaymentMethod] = useState<"wire" | "credit_card" | "ach" | null>(null);
  const checkedInitialOverflow = useRef(false);

  function checkScrolled(el: HTMLDivElement) {
    if (el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD_PX) {
      setScrolledToEnd(true);
    }
  }

  const needsPaymentMethod = !waivesCardHold && !!depositAmount && depositAmount > 0;
  const canAccept = scrolledToEnd && name.trim().length > 1 && (!needsPaymentMethod || paymentMethod !== null);
  const ccFee = depositAmount ? (depositAmount * ccProcessingFeePercent) / 100 : 0;

  return (
    <div className="flex flex-col gap-4">
      {termsText && (
        <section>
          <h2 className="text-[13px] font-semibold tracking-wide text-foreground/55 uppercase">
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
            className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-border/70 p-4 text-sm whitespace-pre-wrap text-muted-foreground"
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

      {needsPaymentMethod && (
        <section className="flex flex-col gap-2">
          <Label>How would you like to pay for your flight?</Label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { value: "ach" as const, label: "Bank Transfer (ACH)" },
                { value: "wire" as const, label: "Wire Transfer" },
                { value: "credit_card" as const, label: "Credit Card" },
              ]
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPaymentMethod(opt.value)}
                className={cn(
                  "rounded-xl border p-3 text-left text-sm transition-colors",
                  paymentMethod === opt.value
                    ? "border-accent bg-accent/10"
                    : "border-border hover:border-accent/60"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {paymentMethod === "ach" &&
              `You'll pay ${formatCurrency(depositAmount ?? 0)} for your flight via ACH bank transfer — no wire fees, and you'll authorize it directly from your bank account after signing. A credit card hold of ${formatCurrency(depositAmount ?? 0)} is also authorized as backup security in case the ACH payment fails.`}
            {paymentMethod === "wire" &&
              `You'll pay ${formatCurrency(depositAmount ?? 0)} for your flight via wire (instructions will follow by email). A credit card hold of ${formatCurrency(depositAmount ?? 0)} is also authorized as backup security in case the wire isn't received.`}
            {paymentMethod === "credit_card" &&
              `Your card will be charged ${formatCurrency((depositAmount ?? 0) + ccFee)} for your flight — includes a ${ccProcessingFeePercent}% card processing fee (${formatCurrency(ccFee)}).`}
            {paymentMethod === null && "Choose an option above to continue."}
          </p>
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
        Terms above
        {waivesCardHold
          ? "."
          : needsPaymentMethod
            ? paymentMethod === "credit_card"
              ? ", and authorize the payment described above."
              : ", and authorize the card hold described above."
            : "."}
      </p>

      <form action={action}>
        <input type="hidden" name="acceptedByName" value={name} />
        {paymentMethod && <input type="hidden" name="paymentMethod" value={paymentMethod} />}
        <Button type="submit" size="lg" className="h-11 w-full rounded-xl" disabled={!canAccept}>
          I Accept — Book This Charter
        </Button>
      </form>
    </div>
  );
}
