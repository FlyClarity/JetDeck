// Reference panel for the source material a quote/trip request was built
// from — mainly the raw inbound email, since AI extraction sometimes misses
// an airport or detail the operator needs to double-check by eye (routing is
// often stated in the subject line, e.g. "TEB-PBI 9/15", so that needs to be
// visible here too, not just the body).
export function OriginalRequestPanel({
  source,
  rawEmailFrom,
  rawEmailSubject,
  rawEmailBody,
  specialRequests,
}: {
  source: string;
  rawEmailFrom?: string | null;
  rawEmailSubject?: string | null;
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
      <div className="border-t border-border">
        {rawEmailSubject && (
          <p className="border-b border-border px-3 py-2 text-sm font-medium">
            {rawEmailSubject}
          </p>
        )}
        <pre className="max-h-64 overflow-y-auto p-3 text-sm whitespace-pre-wrap text-muted-foreground">
          {content}
        </pre>
      </div>
    </details>
  );
}
