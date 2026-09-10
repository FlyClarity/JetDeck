import { Inter } from "next/font/google";

// The client-facing quote page gets its own typeface — a clean, modern
// sans-serif rather than the JetBrains Mono used everywhere in the operator
// dashboard. Scoped to this route only via a wrapping div (rather than
// touching the root layout or globals.css) so the operator-facing side of
// the app is completely unaffected.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export default function ClientQuoteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${inter.variable} font-[family-name:var(--font-inter)]`}>
      {children}
    </div>
  );
}
