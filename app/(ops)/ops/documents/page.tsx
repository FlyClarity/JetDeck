import Link from "next/link";
import { getTenantContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";

async function getScopedOperatorId() {
  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return null;
  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  return operator?.id ?? null;
}

export default async function DocumentsPage() {
  const operatorId = await getScopedOperatorId();
  if (!operatorId) return null;

  const documents = await prisma.document.findMany({
    where: { operatorId },
    include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { title: "asc" },
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <Link href="/ops/documents/new">
          <Button size="sm">Add Document</Button>
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Manuals and procedures, with version history and crew acknowledgment tracking.
      </p>

      {documents.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">No documents yet.</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {documents.map((doc) => {
            const latest = doc.versions[0];
            return (
              <li key={doc.id}>
                <Link
                  href={`/ops/documents/${doc.id}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-border p-4 text-sm hover:bg-muted/50"
                >
                  <div>
                    <p className="font-medium">{doc.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {doc.category ? `${doc.category} · ` : ""}
                      {latest ? `${latest.versionLabel}` : "No version uploaded"}
                      {doc.requiresAcknowledgment ? " · Requires acknowledgment" : ""}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
