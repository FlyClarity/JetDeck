import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import { getTenantContext } from "@/lib/auth";
import { getCurrentOperator } from "@/lib/operator";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

async function createDocument(formData: FormData) {
  "use server";

  const { clerkOrgId, userId } = await getTenantContext();
  if (!clerkOrgId) return;
  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  if (!operator) return;

  const title = String(formData.get("title") ?? "").trim();
  if (!title) redirect("/ops/documents/new?error=title");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) redirect("/ops/documents/new?error=file");
  if (file.size > MAX_FILE_BYTES) redirect("/ops/documents/new?error=size");

  let fileUrl: string;
  try {
    const blob = await put(`documents/${operator.id}/${randomUUID()}-${file.name}`, file, {
      access: "public",
    });
    fileUrl = blob.url;
  } catch (err) {
    console.error("Failed to upload document file", err);
    redirect("/ops/documents/new?error=upload");
  }

  const document = await prisma.document.create({
    data: {
      operatorId: operator.id,
      title,
      category: String(formData.get("category") ?? "").trim() || null,
      requiresAcknowledgment: formData.get("requiresAcknowledgment") === "on",
      versions: {
        create: {
          operatorId: operator.id,
          versionLabel: String(formData.get("versionLabel") ?? "").trim() || "Rev 1",
          fileUrl,
          fileName: file.name,
          notes: String(formData.get("notes") ?? "").trim() || null,
          uploadedBy: userId,
        },
      },
    },
  });

  await logAction({
    operatorId: operator.id,
    action: "document.create",
    entityType: "Document",
    entityId: document.id,
    detail: { title },
  });

  redirect(`/ops/documents/${document.id}`);
}

const ERROR_MESSAGES: Record<string, string> = {
  title: "Title is required.",
  file: "Choose a file to upload.",
  size: "File is too large (20MB max).",
  upload: "Upload failed — try again.",
};

export default async function NewDocumentPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const operator = await getCurrentOperator();
  if (!operator) return null;
  const { error } = await searchParams;

  return (
    <div className="mx-auto w-full max-w-lg px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Add Document</h1>

      {error && ERROR_MESSAGES[error] && (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {ERROR_MESSAGES[error]}
        </div>
      )}

      <form action={createDocument} className="mt-8 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" placeholder="e.g. General Operations Manual" required />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="category">Category (optional)</Label>
            <Input id="category" name="category" placeholder="e.g. GOM" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="versionLabel">Version label</Label>
            <Input id="versionLabel" name="versionLabel" placeholder="e.g. Rev 1" />
          </div>
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

        <div className="flex flex-col gap-2">
          <Label htmlFor="notes">Notes (optional)</Label>
          <Input id="notes" name="notes" placeholder="What changed in this version" />
        </div>

        <div className="flex items-center gap-2">
          <input
            id="requiresAcknowledgment"
            name="requiresAcknowledgment"
            type="checkbox"
            className="size-4 rounded border-input"
          />
          <Label htmlFor="requiresAcknowledgment" className="font-normal">
            Crew must acknowledge this document
          </Label>
        </div>

        <Button type="submit" className="self-start">
          Add Document
        </Button>
      </form>
    </div>
  );
}
