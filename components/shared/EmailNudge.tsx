import { Button } from '@/components/ui/button';
import { Link } from '@/lib/i18n/navigation';

/**
 * Spec 0011-13 AC-4: a quiet note asking for a confirmed email, linking to the account page. Never a block. The
 * strings come from the caller, so a Server and a Client Component can both draw it.
 */
export function EmailNudge({ text, linkLabel }: { text: string; linkLabel: string }) {
  return (
    <section
      role="note"
      className="flex flex-col gap-3 rounded-row bg-accent-light px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-body-s text-text-primary">{text}</p>
      <Button asChild variant="white" size="sm" className="self-start sm:self-auto">
        <Link href="/account">{linkLabel}</Link>
      </Button>
    </section>
  );
}
