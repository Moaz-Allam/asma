import { supportHref } from '@/lib/region/support';

/** The WhatsApp line for one region. Renders nothing until the number exists (S25, AC-34). */
export function SupportLink({
  whatsapp,
  label,
  className,
}: {
  whatsapp: string | null | undefined;
  label: string;
  className?: string;
}) {
  const href = supportHref(whatsapp);
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {label}
    </a>
  );
}
