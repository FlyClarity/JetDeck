import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { put, del } from "@vercel/blob";
import { getTenantContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

async function getScopedOperatorId() {
  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return null;
  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  return operator?.id ?? null;
}

async function uploadDocumentVersion(documentId: string, formData: FormData) {
  "use server";

  const { clerkOrgId, userId } = await getTenantContext();
  if (!clerkOrgId) return;
  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  if (!operator) return;

  const doc = await prisma.document.findFirst({ where: { id: documentId, operatorId: operator.id } });
  if (!doc) return;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) redirect(`/ops/documents/${documentId}?error=file`);
  if (file.size > MAX_FILE_BYTES) redirect(`/ops/documents/${documentId}?error=size`);

  let fileUrl: string;
  try {
    const blob = await put(`documents/${operator.id}/${randomUUID()}-${file.name}`, file, {
      access: "public",
    });
    fileUrl = blob.url;
  } catch (err) {
    console.error("Failed to upload document version file", err);
    redirect(`/ops/documents/${documentId}?error=upload`);
  }

  const version = await prisma.documentVersion.create({
    data: {
      operatorId: operator.id,
      documentId,
      versionLabel: String(formData.get("versionLabel") ?? "").trim() || "Untitled",
      fileUrl,
      fileName: file.name,
      notes: String(formData.get("notes") ?? "").trim() || null,
      uploadedBy: userId,
    },
  });

  await logAction({
    operatorId: operator.id,
    action: "document.version.create",
    entityType: "DocumentVersion",
    entityId: version.id,
    detail: { documentId, versionLabel: version.versionLabel },
  });

  revalidatePath(`/ops/documents/${documentId}`);
}

// A manual ops-recorded override, per Document/ManualAcknowledgment's own
// schema comments — the only kind possible until Module A (crew
// self-service login) exists. Always against the current latest version:
// there's no "acknowledge an old version" case worth supporting.
async function recordAcknowledgment(documentId: string, formData: FormData) {
  "use server";

  const { clerkOrgId, userId } = await getTenantContext();
  if (!clerkOrgId) return;
  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  if (!operator) return;

  const doc = await prisma.document.findFirst({
    where: { id: documentId, operatorId: operator.id },
    include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!doc) return;

  const crewId = String(formData.get("crewId") ?? "");
  const crew = await prisma.crewMember.findFirst({ where: { id: crewId, operatorId: operator.id } });
  if (!crew) return;

  const ack = await prisma.manualAcknowledgment.create({
    data: {
      operatorId: operator.id,
      documentId,
      crewId,
      documentVersionId: doc.versions[0]?.id ?? null,
      recordedBy: userId,
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  });

  await logAction({
    operatorId: operator.id,
    action: "document.acknowledgment.record",
    entityType: "ManualAcknowledgment",
    entityId: ack.id,
    detail: { documentId, crewId },
  });

  revalidatePath(`/ops/documents/${documentId}`);
}

async function deleteDocument(documentId: string) {
  "use server";

  const operatorId = await getScopedOperatorId();
  if (!operatorId) return;
  const doc = await prisma.document.findFirst({
    where: { id: documentId, operatorId },
    include: { versions: true },
  });
  if (!doc) return;

  // Best-effort — an orphaned blob is a minor storage cost, not worth
  // failing the whole delete over (matches the fleet photo delete pattern).
  await Promise.all(
    doc.versions.map((v) =>
      del(v.fileUrl).catch((err) => console.error("Failed to delete document version blob", err))
    )
  );

  await prisma.document.delete({ where: { id: documentId } });

  await logAction({
    operatorId,
    action: "document.delete",
    entityType: "Document",
    entityId: documentId,
    detail: { title: doc.title },
  });

  redirect("/ops/documents");
}

const ERROR_MESSAGES: Record<string, string> = {
  file: "Choose a file to upload.",
  size: "File is too large (20MB max).",
  upload: "Upload failed — try again.",
};

export default async function DocumentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const operatorId = await getScopedOperatorId();
  if (!operatorId) notFound();

  const doc = await prisma.document.findFirst({
    where: { id, operatorId },
    include: {
      versions: { orderBy: { createdAt: "desc" } },
      acknowledgments: { orderBy: { acknowledgedAt: "desc" }, include: { crew: true } },
    },
  });
  if (!doc) notFound();

  const activeCrew = doc.requiresAcknowledgment
    ? await prisma.crewMember.findMany({ where: { operatorId, active: true }, orderBy: { name: "asc" } })
    : [];

  const latestVersion = doc.versions[0];
  const acknowledgedCrewIds = new Set(
    doc.acknowledgments
      .filter((a) => a.documentVersionId === latestVersion?.id)
      .map((a) => a.crewId)
  );

  const uploadVersionWithId = uploadDocumentVersion.bind(null, doc.id);
  const recordAckWithId = recordAcknowledgment.bind(null, doc.id);
  const deleteWithId = deleteDocument.bind(null, doc.id);

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{doc.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {doc.category ? `${doc.category}` : "No category"}
        {doc.requiresAcknowledgment ? " · Requires crew acknowledgment" : ""}
      </p>

      {error && ERROR_MESSAGES[error] && (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {ERROR_MESSAGES[error]}
        </div>
      )}

      <div className="mt-8 flex flex-col gap-3 rounded-md border border-border p-4">
        <p className="text-sm font-medium">Versions</p>
        <div className="flex flex-col gap-2">
          {doc.versions.map((v) => (
            <div
              key={v.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"
            >
              <div>
                <a href={v.fileUrl} target="_blank" rel="noreferrer" className="font-medium underline">
                  {v.versionLabel}
                </a>
                <p className="text-xs text-muted-foreground">
                  Uploaded {v.createdAt.toLocaleDateString()}
                  {v.notes ? ` · ${v.notes}` : ""}
                </p>
              </div>
            </div>
          ))}
        </div>

        <form
          action={uploadVersionWithId}
          className="mt-2 flex flex-col gap-3 rounded-md border border-border p-4"
        >
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Upload New Version
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="versionLabel">Version label</Label>
              <Input id="versionLabel" name="versionLabel" placeholder="e.g. Rev 2" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="file">File</Label>
              <input
                id="file"
                name="file"
                type="file"
                required
                className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm"
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="versionNotes">Notes</Label>
            <Input id="versionNotes" name="notes" placeholder="What changed" />
          </div>
          <Button type="submit" size="sm" variant="outline" className="self-start">
            Upload
          </Button>
        </form>
      </div>

      {doc.requiresAcknowledgment && (
        <div className="mt-8 flex flex-col gap-3 rounded-md border border-border p-4">
          <div>
            <p className="text-sm font-medium">Crew Acknowledgment — {latestVersion?.versionLabel ?? "no version"}</p>
            <p className="text-xs text-muted-foreground">
              Recorded manually by ops until crew have their own login to self-acknowledge.
            </p>
          </div>
          {activeCrew.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active crew on file.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {activeCrew.map((crew) => {
                const acknowledged = acknowledgedCrewIds.has(crew.id);
                return (
                  <li
                    key={crew.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"
                  >
                    <span>{crew.name}</span>
                    {acknowledged ? (
                      <span className="text-xs font-medium text-accent">Acknowledged</span>
                    ) : (
                      <form
                        action={recordAckWithId}
                        className="flex items-center gap-2"
                      >
                        <input type="hidden" name="crewId" value={crew.id} />
                        <Input
                          name="notes"
                          placeholder="Notes (optional)"
                          className="h-8 w-48 text-sm"
                        />
                        <Button type="submit" size="sm" variant="outline">
                          Record Acknowledgment
                        </Button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <form action={deleteWithId} className="mt-8">
        <Button type="submit" variant="outline">
          Delete Document
        </Button>
      </form>
    </div>
  );
}
