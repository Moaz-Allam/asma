import { getTranslations } from 'next-intl/server';

import type { NoticeView } from '@/lib/notifications/kinds';

import { NoticeItem } from './NoticeItem';

/** The page's list (`s13`, `p15`; spec 0011-18 AC-9): "Today", then "Earlier", in the notice region's time zone. */
export async function NotificationList({ notices }: { notices: readonly NoticeView[] }) {
  const t = await getTranslations('Notices');
  const groups = (['today', 'earlier'] as const)
    .map((group) => ({ group, items: notices.filter((notice) => notice.group === group) }))
    .filter(({ items }) => items.length > 0);

  return (
    <div className="flex flex-col gap-5.5">
      {groups.map(({ group, items }) => (
        <section key={group} aria-labelledby={`notices-${group}`} className="flex flex-col gap-3">
          <h2 id={`notices-${group}`} className="text-label text-text-secondary">
            {t(group)}
          </h2>
          <ul className="flex flex-col gap-2.5">
            {items.map((notice) => (
              <li key={notice.id}>
                <NoticeItem notice={notice} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
