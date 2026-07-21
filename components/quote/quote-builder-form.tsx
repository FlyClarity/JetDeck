"use client";

import { useMemo, useState } from "react";
import type { Aircraft } from "@/lib/generated/prisma/client";
import { calculateQuoteTotals, formatCurrency, type AdditionalFee } from "@/lib/quote";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type QuoteBuilderInitialValues = {
  aircraftId: string | null;
  flightHours: number;
  hourlyRate: number;
  repoHours: number;
  repoRate: number;
  landingFees: number;
  handlingFees: number;
  additionalFees: AdditionalFee[];
  fetTax: boolean;
  discount: number;
  discountNote: string;
  internalNotes: string;
  validUntil: string;
};

export function QuoteBuilderForm({
  routeSummaryText,
  requestorLine,
  aircraftList,
  initialValues,
  priceSuggestion,
  depositPercent,
  action,
  submitLabel,
}: {
  routeSummaryText: string;
  requestorLine: string;
  aircraftList: Aircraft[];
  initialValues: QuoteBuilderInitialValues;
  priceSuggestion: { suggestedPrice: number; reasoning: string } | null;
  depositPercent: number;
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
}) {
  const [aircraftId, setAircraftId] = useState(initialValues.aircraftId ?? "");
  const [flightHours, setFlightHours] = useState(String(initialValues.flightHours || ""));
  const [hourlyRate, setHourlyRate] = useState(String(initialValues.hourlyRate || ""));
  const [repoHours, setRepoHours] = useState(String(initialValues.repoHours || ""));
  const [repoRate, setRepoRate] = useState(String(initialValues.repoRate || ""));
  const [landingFees, setLandingFees] = useState(String(initialValues.landingFees || ""));
  const [handlingFees, setHandlingFees] = useState(String(initialValues.handlingFees || ""));
  const [additionalFees, setAdditionalFees] = useState<AdditionalFee[]>(
    initialValues.additionalFees
  );
  const [fetTax, setFetTax] = useState(initialValues.fetTax);
  const [discount, setDiscount] = useState(String(initialValues.discount || ""));
  const [discountNote, setDiscountNote] = useState(initialValues.discountNote);

  function handleAircraftChange(id: string) {
    setAircraftId(id);
    const aircraft = aircraftList.find((a) => a.id === id);
    if (aircraft) {
      setHourlyRate(String(aircraft.hourlyRate));
      setRepoRate(String(aircraft.repoRate ?? aircraft.hourlyRate));
    }
  }

  function updateFee(index: number, patch: Partial<AdditionalFee>) {
    setAdditionalFees((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...patch } : f))
    );
  }

  const totals = useMemo(
    () =>
      calculateQuoteTotals({
        flightHours: Number(flightHours) || 0,
        hourlyRate: Number(hourlyRate) || 0,
        repoHours: Number(repoHours) || 0,
        repoRate: Number(repoRate) || 0,
        landingFees: Number(landingFees) || 0,
        handlingFees: Number(handlingFees) || 0,
        additionalFees,
        fetTax,
        discount: Number(discount) || 0,
      }),
    [flightHours, hourlyRate, repoHours, repoRate, landingFees, handlingFees, additionalFees, fetTax, discount]
  );

  const discountPercentOfSubtotal =
    totals.subtotal > 0 ? ((Number(discount) || 0) / totals.subtotal) * 100 : 0;
  const needsDiscountNote = discountPercentOfSubtotal > 10;
  const depositAmount = totals.total * depositPercent;

  return (
    <form action={action} className="flex gap-8">
      <input type="hidden" name="aircraftId" value={aircraftId} />
      <input type="hidden" name="additionalFeesJson" value={JSON.stringify(additionalFees)} />
      <input type="hidden" name="fetTax" value={fetTax ? "on" : ""} />

      <div className="flex flex-1 flex-col gap-6">
        <div>
          <p className="font-medium">{routeSummaryText}</p>
          <p className="text-sm text-muted-foreground">{requestorLine}</p>
        </div>

        {priceSuggestion && (
          <div className="rounded-md border border-accent/40 bg-accent/10 p-3 text-sm">
            <p className="font-medium">
              AI suggests {formatCurrency(priceSuggestion.suggestedPrice)}
            </p>
            <p className="mt-1 text-muted-foreground">{priceSuggestion.reasoning}</p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="aircraftId-select">Aircraft</Label>
          <Select value={aircraftId} onValueChange={handleAircraftChange}>
            <SelectTrigger id="aircraftId-select">
              <SelectValue placeholder="Select aircraft" />
            </SelectTrigger>
            <SelectContent>
              {aircraftList.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.tailNumber} — {a.make} {a.model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="flightHours">Flight hours</Label>
            <Input
              id="flightHours"
              name="flightHours"
              type="number"
              min={0}
              step="0.1"
              value={flightHours}
              onChange={(e) => setFlightHours(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="hourlyRate">Hourly rate ($)</Label>
            <Input
              id="hourlyRate"
              name="hourlyRate"
              type="number"
              min={0}
              step="0.01"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="repoHours">Repositioning hours</Label>
            <Input
              id="repoHours"
              name="repoHours"
              type="number"
              min={0}
              step="0.1"
              value={repoHours}
              onChange={(e) => setRepoHours(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="repoRate">Repositioning rate ($)</Label>
            <Input
              id="repoRate"
              name="repoRate"
              type="number"
              min={0}
              step="0.01"
              value={repoRate}
              onChange={(e) => setRepoRate(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="landingFees">Landing fees ($)</Label>
            <Input
              id="landingFees"
              name="landingFees"
              type="number"
              min={0}
              step="0.01"
              value={landingFees}
              onChange={(e) => setLandingFees(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="handlingFees">Handling fees ($)</Label>
            <Input
              id="handlingFees"
              name="handlingFees"
              type="number"
              min={0}
              step="0.01"
              value={handlingFees}
              onChange={(e) => setHandlingFees(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Additional fees</Label>
          {additionalFees.map((fee, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                placeholder="Catering"
                value={fee.label}
                onChange={(e) => updateFee(i, { label: e.target.value })}
              />
              <Input
                type="number"
                min={0}
                step="0.01"
                className="w-32"
                placeholder="0.00"
                value={fee.amount || ""}
                onChange={(e) => updateFee(i, { amount: Number(e.target.value) || 0 })}
              />
              <button
                type="button"
                onClick={() => setAdditionalFees((prev) => prev.filter((_, idx) => idx !== i))}
                className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Remove
              </button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setAdditionalFees((prev) => [...prev, { label: "", amount: 0 }])}
          >
            Add fee
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="fetTaxCheckbox"
            type="checkbox"
            className="size-4 rounded border-input"
            checked={fetTax}
            onChange={(e) => setFetTax(e.target.checked)}
          />
          <Label htmlFor="fetTaxCheckbox">FET tax (7.5%, US domestic)</Label>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="discount">Discount ($)</Label>
          <Input
            id="discount"
            name="discount"
            type="number"
            min={0}
            step="0.01"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
          />
          {totals.subtotal > 0 && Number(discount) > 0 && (
            <p className="text-sm text-muted-foreground">
              {discountPercentOfSubtotal.toFixed(1)}% of subtotal
            </p>
          )}
          {needsDiscountNote && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="discountNote">Reason for discount (required, &gt;10%)</Label>
              <Input
                id="discountNote"
                name="discountNote"
                value={discountNote}
                onChange={(e) => setDiscountNote(e.target.value)}
                required
              />
            </div>
          )}
          {!needsDiscountNote && (
            <input type="hidden" name="discountNote" value={discountNote} />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="internalNotes">Internal notes</Label>
          <Textarea
            id="internalNotes"
            name="internalNotes"
            rows={3}
            defaultValue={initialValues.internalNotes}
            placeholder="Not visible to the client"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="validUntil">Quote valid until</Label>
          <Input
            id="validUntil"
            name="validUntil"
            type="date"
            defaultValue={initialValues.validUntil}
            required
          />
        </div>

        <Button type="submit" size="lg" className="self-start" disabled={!aircraftId}>
          {submitLabel}
        </Button>
      </div>

      <div className="w-72 shrink-0">
        <div className="sticky top-6 flex flex-col gap-2 rounded-md border border-border p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Flight</span>
            <span>{formatCurrency(totals.flightCost)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Repositioning</span>
            <span>{formatCurrency(totals.repoCost)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Fees</span>
            <span>
              {formatCurrency(
                Number(landingFees || 0) + Number(handlingFees || 0) + totals.feesTotal
              )}
            </span>
          </div>
          {Number(discount) > 0 && (
            <div className="flex justify-between text-destructive">
              <span>Discount</span>
              <span>-{formatCurrency(Number(discount))}</span>
            </div>
          )}
          {fetTax && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">FET (7.5%)</span>
              <span>{formatCurrency(totals.fetAmount)}</span>
            </div>
          )}
          <div className="mt-2 flex justify-between border-t border-border pt-2 font-semibold">
            <span>Total</span>
            <span>{formatCurrency(totals.total)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Deposit ({Math.round(depositPercent * 100)}%)</span>
            <span>{formatCurrency(depositAmount)}</span>
          </div>
        </div>
      </div>
    </form>
  );
}
