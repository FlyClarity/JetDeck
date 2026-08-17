import { redirect } from "next/navigation";

// Trips is the only Ops module today — this is the landing spot the sales
// nav's "Ops" link points to, so it has somewhere sensible to grow into as
// Crew/Checklist/etc. get built without another nav-link migration.
export default function OpsIndexPage() {
  redirect("/ops/trips");
}
