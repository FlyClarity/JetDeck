"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Starts disabled — nothing to save yet, matches whatever's already
// persisted — and enables the moment any field in the enclosing form
// changes. Goes back to disabled once that change actually finishes
// submitting, so the button itself is the confirmation: grayed out means
// saved, active means there's a change waiting to go. Renders a native
// <button> (not the Button component) because Button isn't
// forwardRef-wrapped and this needs a real ref to find its enclosing
// <form>.
export function SaveButton({
  children = "Save",
  className,
  size,
  variant,
}: {
  children?: React.ReactNode;
  className?: string;
  size?: "default" | "sm" | "lg" | "icon";
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
}) {
  const [dirty, setDirty] = useState(false);
  const { pending } = useFormStatus();
  const wasPending = useRef(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const onChange = () => setDirty(true);
    form.addEventListener("input", onChange);
    form.addEventListener("change", onChange);
    return () => {
      form.removeEventListener("input", onChange);
      form.removeEventListener("change", onChange);
    };
  }, []);

  // Flip back to "saved" the moment a pending submission completes —
  // covers actions that revalidatePath in place rather than redirecting
  // to a fresh page load (which would reset this component anyway).
  useEffect(() => {
    if (wasPending.current && !pending) setDirty(false);
    wasPending.current = pending;
  }, [pending]);

  return (
    <button
      ref={ref}
      type="submit"
      disabled={!dirty || pending}
      className={cn(buttonVariants({ variant, size }), className)}
    >
      {pending ? "Saving…" : dirty ? children : "Saved"}
    </button>
  );
}
