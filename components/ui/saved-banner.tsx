// A save action historically just called revalidatePath and left the
// operator to guess whether anything happened — the field/button looked
// the same before and after a successful click. This is the shared,
// uniform "yes, that saved" acknowledgment: pair it with a server action
// that redirects back to the same page with `?saved=<key>` once the
// write succeeds, and render this wherever that param matches.
export function SavedBanner({ show, message = "Saved." }: { show: boolean; message?: string }) {
  if (!show) return null;
  return (
    <p className="mt-3 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent">
      {message}
    </p>
  );
}
