"use client";

import { Button } from "@/components/ui/button";

// Native window.confirm() rather than a custom modal — this is a small,
// one-off gate ("are you sure you want to do the thing this button
// says"), not a rich dialog flow, and confirm() needs no new dependency
// and behaves identically everywhere it's used. Established pattern for
// any button whose action is hard to undo or client-facing (an email
// that's already been sent can't be unsent).
export function ConfirmSubmitButton({
  confirmMessage,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { confirmMessage: string }) {
  return (
    <Button
      {...props}
      type="submit"
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) {
          e.preventDefault();
        }
      }}
    >
      {children}
    </Button>
  );
}
