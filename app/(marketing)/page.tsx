import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <span className="text-sm font-medium tracking-wide text-accent">
        JETDECK
      </span>
      <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        Flight operations, without the double-entry.
      </h1>
      <p className="max-w-xl text-muted-foreground">
        Project scaffold is up — Next.js, Tailwind, shadcn/ui, Clerk, and
        Prisma are wired in. The quoting pipeline comes next.
      </p>
      <div className="flex gap-3">
        <Button size="lg" asChild>
          <Link href="/sign-up">Get Started</Link>
        </Button>
        <Button size="lg" variant="outline" asChild>
          <Link href="/sign-in">Sign In</Link>
        </Button>
      </div>
    </div>
  );
}
