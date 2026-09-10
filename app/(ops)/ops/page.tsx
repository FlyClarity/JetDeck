import { redirect } from "next/navigation";

// The Sales/Ops switcher's "Ops" side points here — bounce straight to the
// board, the actual ops home now that it exists.
export default function OpsIndexPage() {
  redirect("/ops/board");
}
