/**
 * The short details of a request on `p8` (ui-registry `ShortDetailsList`, spec 0009 AC-8): one row per fact the
 * definer function returned, structured answers included. The page builds the rows from `provider_request`
 * only, so a fact the function does not send cannot appear here.
 */
export function ShortDetailsList({ rows }: { rows: readonly { term: string; value: string }[] }) {
  return (
    <dl className="divide-y-2 divide-border-light rounded-panel border-2 border-border bg-surface">
      {rows.map((row, index) => (
        <div key={`${row.term}-${index}`} className="grid gap-1 px-5 py-4 sm:grid-cols-[1fr_2fr]">
          <dt className="text-body-s text-text-secondary">{row.term}</dt>
          <dd className="text-body-s font-semibold break-words text-text-primary">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
