"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export function CopyLinkButton({ link, className }: { link: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={cn(
        "text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground",
        className
      )}
    >
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}
