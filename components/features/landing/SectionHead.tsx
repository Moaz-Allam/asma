import { ArrowRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Link } from '@/lib/i18n/navigation';

/** The title of a landing section, with its outlined link to the request form at the far end. */
export function SectionHead({
  title,
  action,
  className,
}: {
  title: string;
  action: string;
  className: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-x-5 gap-y-3 ${className}`}>
      <h2 className="flex-1 font-display text-title text-text-primary lg:text-heading">{title}</h2>
      <Button asChild variant="outline" size="nav">
        <Link href={{ pathname: '/login', query: { next: '/requests/new' } }}>
          {action}
          <ArrowRight aria-hidden className="rtl:rotate-180" />
        </Link>
      </Button>
    </div>
  );
}
