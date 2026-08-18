import { redirect } from "next/navigation";
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
import { AIRCRAFT_CATEGORIES, AIRCRAFT_AMENITIES } from "@/lib/aircraft";

async function createAircraft(formData: FormData) {
  "use server";

  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return;

  const operator = await prisma.operator.findUnique({
    where: { clerkOrgId },
  });
  if (!operator) return;

  const homeBase = String(formData.get("homeBase") ?? "").toUpperCase();

  const aircraft = await prisma.aircraft.create({
    data: {
      operatorId: operator.id,
      tailNumber: String(formData.get("tailNumber") ?? "").toUpperCase(),
      make: String(formData.get("make") ?? ""),
      model: String(formData.get("model") ?? ""),
      category: String(formData.get("category") ?? "light"),
      seats: Number(formData.get("seats") ?? 0),
      homeBase,
      currentBase: homeBase,
      hourlyRate: Number(formData.get("hourlyRate") ?? 0),
      repoRate: formData.get("repoRate")
        ? Number(formData.get("repoRate"))
        : null,
      rangeNm: formData.get("rangeNm") ? Number(formData.get("rangeNm")) : null,
      cruiseSpeedKts: formData.get("cruiseSpeedKts")
        ? Number(formData.get("cruiseSpeedKts"))
        : null,
      yearOfManufacture: formData.get("yearOfManufacture")
        ? Number(formData.get("yearOfManufacture"))
        : null,
      yearOfRefurbishment: formData.get("yearOfRefurbishment")
        ? Number(formData.get("yearOfRefurbishment"))
        : null,
      amenities: formData.getAll("amenities").map(String),
    },
  });

  redirect(`/fleet/${aircraft.id}`);
}

export default async function NewAircraftPage() {
  const operator = await getCurrentOperator();
  if (!operator) return null;

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Add Aircraft</h1>

      <form action={createAircraft} className="mt-8 flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="tailNumber">Tail number</Label>
            <Input id="tailNumber" name="tailNumber" placeholder="N12345" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="category">Category</Label>
            <Select name="category" defaultValue="light">
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
            <Input id="make" name="make" placeholder="Cessna" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="model">Model</Label>
            <Input id="model" name="model" placeholder="Citation CJ3" required />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="seats">Seats</Label>
            <Input id="seats" name="seats" type="number" min={1} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="homeBase">Home base (ICAO)</Label>
            <Input id="homeBase" name="homeBase" placeholder="KTEB" required />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="hourlyRate">Hourly rate ($)</Label>
            <Input id="hourlyRate" name="hourlyRate" type="number" min={0} step="0.01" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="repoRate">Repositioning rate ($, optional)</Label>
            <Input id="repoRate" name="repoRate" type="number" min={0} step="0.01" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="rangeNm">Range (nm, optional)</Label>
            <Input id="rangeNm" name="rangeNm" type="number" min={0} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="cruiseSpeedKts">Cruise speed (kts, optional)</Label>
            <Input id="cruiseSpeedKts" name="cruiseSpeedKts" type="number" min={0} placeholder="416" />
            <p className="text-sm text-muted-foreground">
              From the manufacturer&apos;s spec sheet — drives flight-time estimates.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="yearOfManufacture">Year of manufacture (optional)</Label>
            <Input id="yearOfManufacture" name="yearOfManufacture" type="number" min={1900} placeholder="2015" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="yearOfRefurbishment">Year of refurbishment (optional)</Label>
            <Input id="yearOfRefurbishment" name="yearOfRefurbishment" type="number" min={1900} placeholder="2022" />
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
                />
                <Label htmlFor={`amenity-${a.value}`} className="font-normal">
                  {a.label}
                </Label>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Photos can be added once the aircraft is saved.
          </p>
        </div>

        <Button type="submit" className="self-start">
          Add Aircraft
        </Button>
      </form>
    </div>
  );
}
