import { redirect } from "next/navigation";

// Preferred Operators moved under Settings (its own tab) — this route stays
// only so an existing bookmark/link still lands somewhere sensible instead
// of 404ing.
export default function SourcingRedirect() {
  redirect("/settings?tab=sourcing");
}
