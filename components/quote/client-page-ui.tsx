// Small presentational primitives shared by every client-facing page that
// uses the "rounded card on a muted background" look (the quote page, the
// passenger manifest page) — pulled out once two pages needed the exact
// same building blocks, rather than each page keeping its own near-copy.

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[13px] font-semibold tracking-wide text-foreground/55 uppercase">
      {children}
    </h2>
  );
}

export function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: "muted" | "destructive";
}) {
  return (
    <div className="flex justify-between">
      <span className={emphasis === "muted" ? "text-muted-foreground" : ""}>{label}</span>
      <span className={emphasis === "destructive" ? "font-medium text-destructive" : ""}>{value}</span>
    </div>
  );
}
