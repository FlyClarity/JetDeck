import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { put, del } from "@vercel/blob";
import { getTenantContext } from "@/lib/auth";
import { getCurrentOperator } from "@/lib/operator";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AIRCRAFT_CATEGORIES, AIRCRAFT_STATUSES, AIRCRAFT_AMENITIES } from "@/lib/aircraft";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

async function getScopedOperatorId() {
  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return null;
  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  return operator?.id ?? null;
}

async function updateAircraft(id: string, formData: FormData) {
  "use server";

  const operatorId = await getScopedOperatorId();
  if (!operatorId) return;

  const existing = await prisma.aircraft.findFirst({ where: { id, operatorId } });
  if (!existing) return;

  await prisma.aircraft.update({
    where: { id },
    data: {
      tailNumber: String(formData.get("tailNumber") ?? "").toUpperCase(),
      make: String(formData.get("make") ?? ""),
      model: String(formData.get("model") ?? ""),
      category: String(formData.get("category") ?? "light"),
      seats: Number(formData.get("seats") ?? 0),
      homeBase: String(formData.get("homeBase") ?? "").toUpperCase(),
      currentBase: String(formData.get("currentBase") ?? "").toUpperCase(),
      hourlyRate: Number(formData.get("hourlyRate") ?? 0),
      repoRate: formData.get("repoRate") ? Number(formData.get("repoRate")) : null,
      rangeNm: formData.get("rangeNm") ? Number(formData.get("rangeNm")) : null,
      cruiseSpeedKts: formData.get("cruiseSpeedKts")
        ? Number(formData.get("cruiseSpeedKts"))
        : null,
      amenities: formData.getAll("amenities").map(String),
      status: String(formData.get("status") ?? "active"),
    },
  });

  redirect("/fleet");
}

async function deleteAircraft(id: string) {
  "use server";

  const operatorId = await getScopedOperatorId();
  if (!operatorId) return;

  const existing = await prisma.aircraft.findFirst({ where: { id, operatorId } });
  if (!existing) return;

  // Best-effort — an orphaned blob is a minor storage cost, not worth
  // failing the whole delete over.
  await Promise.all(
    existing.photos.map((url) =>
      del(url).catch((err) => console.error("Failed to delete aircraft photo blob", err))
    )
  );

  await prisma.aircraft.delete({ where: { id } });
  redirect("/fleet");
}

async function uploadPhoto(id: string, formData: FormData) {
  "use server";

  const operatorId = await getScopedOperatorId();
  if (!operatorId) return;

  const existing = await prisma.aircraft.findFirst({ where: { id, operatorId } });
  if (!existing) return;

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return;
  if (!file.type.startsWith("image/") || file.size > MAX_PHOTO_BYTES) return;

  try {
    const blob = await put(`aircraft/${id}/${randomUUID()}-${file.name}`, file, {
      access: "public",
    });
    await prisma.aircraft.update({
      where: { id },
      data: { photos: { push: blob.url } },
    });
  } catch (err) {
    // Most likely BLOB_READ_WRITE_TOKEN isn't configured yet (same
    // graceful-degradation pattern as Resend/Stripe elsewhere) — log and
    // move on rather than crashing the page.
    console.error("Failed to upload aircraft photo — check BLOB_READ_WRITE_TOKEN", err);
  }

  revalidatePath(`/fleet/${id}`);
}

async function removePhoto(id: string, url: string) {
  "use server";

  const operatorId = await getScopedOperatorId();
  if (!operatorId) return;

  const existing = await prisma.aircraft.findFirst({ where: { id, operatorId } });
  if (!existing) return;

  try {
    await del(url);
  } catch (err) {
    console.error("Failed to delete photo blob (removing from list anyway)", err);
  }

  await prisma.aircraft.update({
    where: { id },
    data: { photos: existing.photos.filter((p) => p !== url) },
  });

  revalidatePath(`/fleet/${id}`);
}

export default async function EditAircraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const operator = await getCurrentOperator();
  if (!operator) return null;

  const aircraft = await prisma.aircraft.findFirst({
    where: { id, operatorId: operator.id },
  });

  if (!aircraft) {
    notFound();
  }

  const updateWithId = updateAircraft.bind(null, aircraft.id);
  const deleteWithId = deleteAircraft.bind(null, aircraft.id);
  const uploadPhotoWithId = uploadPhoto.bind(null, aircraft.id);

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">
        Edit {aircraft.tailNumber}
      </h1>

      <div className="mt-8 flex flex-col gap-3">
        <Label>Photos</Label>
        <p className="text-sm text-muted-foreground">
          Shown to clients on their quote page.
        </p>
        {aircraft.photos.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {aircraft.photos.map((url) => {
              const removePhotoWithArgs = removePhoto.bind(null, aircraft.id, url);
              return (
                <div key={url} className="group relative aspect-video overflow-hidden rounded-md border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="h-full w-full object-cover" />
                  <form action={removePhotoWithArgs} className="absolute top-1 right-1">
                    <Button
                      type="submit"
                      size="sm"
                      variant="destructive"
                      className="h-6 px-2 text-xs opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      Remove
                    </Button>
                  </form>
                </div>
              );
            })}
          </div>
        )}
        <form action={uploadPhotoWithId} className="flex items-center gap-2">
          <input
            type="file"
            name="photo"
            accept="image/*"
            required
            className="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
          <Button type="submit" variant="outline" size="sm">
            Upload
          </Button>
        </form>
      </div>

      <form action={updateWithId} className="mt-8 flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="tailNumber">Tail number</Label>
            <Input
              id="tailNumber"
              name="tailNumber"
              defaultValue={aircraft.tailNumber}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="category">Category</Label>
            <Select name="category" defaultValue={aircraft.category}>
              <SelectTrigger id="category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AIRCRAFT_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="make">Make</Label>
            <Input id="make" name="make" defaultValue={aircraft.make} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="model">Model</Label>
            <Input id="model" name="model" defaultValue={aircraft.model} required />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="seats">Seats</Label>
            <Input
              id="seats"
              name="seats"
              type="number"
              min={1}
              defaultValue={aircraft.seats}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="status">Status</Label>
            <Select name="status" defaultValue={aircraft.status}>
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AIRCRAFT_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="homeBase">Home base (ICAO)</Label>
            <Input
              id="homeBase"
              name="homeBase"
              defaultValue={aircraft.homeBase}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="currentBase">Current base (ICAO)</Label>
            <Input
              id="currentBase"
              name="currentBase"
              defaultValue={aircraft.currentBase ?? aircraft.homeBase}
            />
            <p className="text-sm text-muted-foreground">
              Updates automatically as trips complete — override manually if
              needed.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="hourlyRate">Hourly rate ($)</Label>
            <Input
              id="hourlyRate"
              name="hourlyRate"
              type="number"
              min={0}
              step="0.01"
              defaultValue={aircraft.hourlyRate}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="repoRate">Repositioning rate ($, optional)</Label>
            <Input
              id="repoRate"
              name="repoRate"
              type="number"
              min={0}
              step="0.01"
              defaultValue={aircraft.repoRate ?? ""}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="rangeNm">Range (nm, optional)</Label>
            <Input
              id="rangeNm"
              name="rangeNm"
              type="number"
              min={0}
              defaultValue={aircraft.rangeNm ?? ""}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="cruiseSpeedKts">Cruise speed (kts, optional)</Label>
            <Input
              id="cruiseSpeedKts"
              name="cruiseSpeedKts"
              type="number"
              min={0}
              defaultValue={aircraft.cruiseSpeedKts ?? ""}
            />
            <p className="text-sm text-muted-foreground">
              From the manufacturer&apos;s spec sheet — drives flight-time estimates.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Amenities</Label>
          <div className="grid grid-cols-2 gap-2">
            {AIRCRAFT_AMENITIES.map((a) => (
              <div key={a.value} className="flex items-center gap-2">
                <input
                  id={`amenity-${a.value}`}
                  name="amenities"
                  type="checkbox"
                  value={a.value}
                  className="size-4 rounded border-input"
                  defaultChecked={aircraft.amenities.includes(a.value)}
                />
                <Label htmlFor={`amenity-${a.value}`} className="font-normal">
                  {a.label}
                </Label>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit">Save Changes</Button>
        </div>
      </form>

      <form action={deleteWithId} className="mt-4">
        <Button type="submit" variant="outline">
          Delete Aircraft
        </Button>
      </form>
    </div>
  );
}
