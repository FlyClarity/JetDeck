import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CopyLinkButton } from "@/components/quote/copy-link-button";

const ID_TYPES = [
  { value: "passport", label: "Passport" },
  { value: "drivers_license", label: "Driver's License" },
  { value: "government_id", label: "Government ID" },
] as const;

export type PassengerFormRecord = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: Date | null;
  weightLbs: number | null;
  idType: string | null;
  idNumber: string | null;
  idExpiry: Date | null;
  idImageUrl: string | null;
  specialRequests: string | null;
  submittedAt: Date | null;
  legIndexes: number[];
};

// Shared between the client self-service page (/manifest/[token], which
// binds `action` to savePassengerInfo behind its own token-based "who can
// edit whom" check) and the ops-side inline editor (which binds it to an
// operator/trip-ownership-checked action instead) — one set of fields, so
// the two entry points can't drift on what a passenger's info actually
// looks like.
export function PassengerForm({
  passenger,
  title,
  shareLink,
  legOptions,
  action,
}: {
  passenger: PassengerFormRecord;
  title: string;
  shareLink?: string;
  legOptions: { index: number; label: string }[];
  action: (formData: FormData) => void;
}) {
  const toDateInput = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

  return (
    <div className="rounded-2xl border border-border bg-background p-6 shadow-sm">
      {shareLink && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-accent">Let them fill this out themselves</p>
            <p className="text-xs text-muted-foreground">Send this passenger their own private link</p>
          </div>
          <CopyLinkButton link={shareLink} />
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {passenger.submittedAt && (
          <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">
            Submitted
          </span>
        )}
      </div>

      <form action={action} className="mt-4 flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`firstName-${passenger.id}`}>First name</Label>
            <Input id={`firstName-${passenger.id}`} name="firstName" defaultValue={passenger.firstName ?? ""} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`lastName-${passenger.id}`}>Last name</Label>
            <Input id={`lastName-${passenger.id}`} name="lastName" defaultValue={passenger.lastName ?? ""} required />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`dob-${passenger.id}`}>Date of birth</Label>
            <Input
              id={`dob-${passenger.id}`}
              name="dateOfBirth"
              type="date"
              defaultValue={toDateInput(passenger.dateOfBirth)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`weight-${passenger.id}`}>Weight (lbs)</Label>
            <Input
              id={`weight-${passenger.id}`}
              name="weightLbs"
              type="number"
              min={1}
              placeholder="Optional"
              defaultValue={passenger.weightLbs ?? ""}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`idType-${passenger.id}`}>ID type</Label>
            <select
              id={`idType-${passenger.id}`}
              name="idType"
              defaultValue={passenger.idType ?? ""}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select...</option>
              {ID_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`idNumber-${passenger.id}`}>ID number</Label>
            <Input id={`idNumber-${passenger.id}`} name="idNumber" defaultValue={passenger.idNumber ?? ""} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`idExpiry-${passenger.id}`}>ID expiry</Label>
          <Input
            id={`idExpiry-${passenger.id}`}
            name="idExpiry"
            type="date"
            defaultValue={toDateInput(passenger.idExpiry)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`idImage-${passenger.id}`}>ID photo</Label>
          <Input id={`idImage-${passenger.id}`} name="idImage" type="file" accept="image/*" />
          {passenger.idImageUrl && (
            <p className="text-xs text-muted-foreground">A photo is already on file — upload again to replace it.</p>
          )}
        </div>

        {legOptions.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label>Which legs is this passenger on?</Label>
            <div className="flex flex-col gap-2 rounded-md border border-input p-3">
              {legOptions.map((opt) => (
                <label key={opt.index} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="legs"
                    value={opt.index}
                    defaultChecked={passenger.legIndexes.length === 0 || passenger.legIndexes.includes(opt.index)}
                    className="h-4 w-4 rounded border-input"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`special-${passenger.id}`}>Special requests</Label>
          <Textarea
            id={`special-${passenger.id}`}
            name="specialRequests"
            rows={2}
            placeholder="Dietary, mobility, medical — optional"
            defaultValue={passenger.specialRequests ?? ""}
          />
        </div>

        <Button type="submit" className="self-start">
          Save
        </Button>
      </form>
    </div>
  );
}
