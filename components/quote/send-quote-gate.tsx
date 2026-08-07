"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function SendQuoteGate({
  action,
  requestorName,
  requestorEmail,
  routeLines,
  total,
  validUntil,
}: {
  action: () => void | Promise<void>;
  requestorName: string;
  requestorEmail: string;
  routeLines: string[];
  total: string;
  validUntil: string;
}) {
  const [reviewing, setReviewing] = useState(false);

  if (!reviewing) {
    return (
      <Button type="button" onClick={() => setReviewing(true)}>
        Send Quote
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-4">
      <p className="text-sm font-medium">Review before sending</p>
      <div className="flex flex-col gap-1 text-sm">
        <p>
          To: {requestorName}
          {requestorEmail && <span className="text-muted-foreground"> ({requestorEmail})</span>}
        </p>
        {routeLines.map((line, i) => (
          <p key={i} className="text-muted-foreground">
            {line}
          </p>
        ))}
        <p className="mt-1">
          Total: <span className="font-medium">{total}</span>
        </p>
        <p className="text-muted-foreground">Valid until {validUntil}</p>
      </div>
      <div className="flex gap-2">
        <form action={action}>
          <Button type="submit" size="sm">
            Confirm &amp; Send
          </Button>
        </form>
        <Button type="button" variant="outline" size="sm" onClick={() => setReviewing(false)}>
          Back
        </Button>
      </div>
    </div>
  );
}
