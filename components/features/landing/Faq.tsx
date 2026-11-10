import { useTranslations } from 'next-intl';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

/** The FAQ keys, shared with the JSON-LD so the markup never says more than the page. */
export const FAQ_KEYS = ['price', 'pay', 'data', 'contact', 'unhappy', 'cancel', 'provider'] as const;

/** Every answer is in the server HTML, closed or open (AC-29): `AccordionContent` stays mounted. */
export function Faq() {
  const t = useTranslations('Landing.faq');

  return (
    <section id="faq" className="scroll-mt-6 pt-12 lg:pt-17.5">
      <h2 className="mb-6.5 font-display text-title text-text-primary lg:text-heading">{t('title')}</h2>
      <Accordion type="single" collapsible defaultValue="price" className="flex flex-col gap-2.5">
        {FAQ_KEYS.map((key) => (
          <AccordionItem key={key} value={key}>
            <AccordionTrigger>{t(`${key}Q`)}</AccordionTrigger>
            <AccordionContent>{t(`${key}A`)}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
