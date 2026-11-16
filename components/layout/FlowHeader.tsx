import { Stepper } from '@/components/shared/Stepper';
import { Link } from '@/lib/i18n/navigation';

/**
 * The header of a flow (ui-registry `FlowHeader`, `s4`, `s5`): the step `Stepper` at the start and one way
 * out at the end, a link or a button. Display only.
 */
export function FlowHeader({
  label,
  steps,
  exit,
}: {
  label: string;
  steps: ReadonlyArray<{ label: string; state: 'done' | 'current' | 'next' }>;
  exit: { label: string; href: string } | { label: string; onClick: () => void };
}) {
  const exitClass =
    'inline-flex min-h-11 items-center rounded-full px-3 text-body-s font-semibold text-text-primary hover:underline';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Stepper label={label} steps={steps} />
      {'href' in exit ? (
        <Link href={exit.href} className={exitClass}>
          {exit.label}
        </Link>
      ) : (
        <button type="button" onClick={exit.onClick} className={exitClass}>
          {exit.label}
        </button>
      )}
    </div>
  );
}
