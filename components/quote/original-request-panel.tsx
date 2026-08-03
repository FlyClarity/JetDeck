// Reference panel for the source material a quote/trip request was built
// from — mainly the raw inbound email, since AI extraction sometimes misses
// an airport or detail the operator needs to double-check by eye.
export function OriginalRequestPanel({
  source,
  rawEmailFrom,
  rawEmailBody,
  specialRequests,
}: {
  source: string;
  rawEmailFrom?: string | null;
  rawEmailBody?: string | null;
  specialRequests?: string | null;
}) {
  const content = rawEmailBody || specialRequests;
  if (!content) return null;

  const label = source === "email_inbound" ? "Original email" : "Original request";

  return (
    <details className="rounded-md border border-border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        {label}
        {rawEmailFrom && (
          <span className="font-normal text-muted-foreground"> · {rawEmailFrom}</span>
        )}
      </summary>
      <pre className="max-h-64 overflow-y-auto border-t border-border p-3 text-sm whitespace-pre-wrap text-muted-foreground">
        {content}
      </pre>
    </details>
  );
}
