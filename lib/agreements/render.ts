import 'server-only';

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import PDFDocument from 'pdfkit';

import {
  AgreementContentSchema,
  AgreementSectionsSchema,
  fieldValues,
  fillText,
  formatAgreementInstant,
  type AgreementContent,
  type AgreementSections,
} from './fields';

/**
 * The service agreement PDF (spec 0011-20 AC-6): the accepted template's sections with the frozen content
 * substituted, in Turkish, on A4, the number and the page on every footer, and the text signature block. Noto Sans
 * regular and bold are vendored in `fonts/` (SIL Open Font License, `fonts/OFL.txt`), so nothing is fetched at render
 * time. The creation date is the reveal time and the producer is fixed, so one agreement always renders the same bytes.
 * Only the relay calls this, never a request path (rule 3).
 */

export const AGREEMENT_MAX_BYTES = 1024 * 1024;

const FONT_DIR = path.join(process.cwd(), 'lib', 'agreements', 'fonts');
const REGULAR = 'NotoSans';
const BOLD = 'NotoSans-Bold';

// No ligatures: a contract's text must copy and search exactly as written (with them, 'fl' in 'Taraflar' copies as
// one glyph that text extraction drops). fontkit reads an object of feature switches; pdfkit's types say an array.
export const TEXT_FEATURES = { liga: false, clig: false, dlig: false } as const;
const features = TEXT_FEATURES as unknown as PDFKit.Mixins.OpenTypeFeatures[];

// The PDF is Turkish only (AC-13); these are its own fixed words.
const TR = {
  title: 'Hizmet Sözleşmesi',
  number: 'Sözleşme numarası',
  signatures: 'Elektronik kabul',
  accepted: 'elektronik olarak kabul etmiştir',
  customer: 'Hizmet alan',
  provider: 'Hizmet veren',
  page: 'Sayfa',
} as const;

let fonts: { regular: Buffer; bold: Buffer } | null = null;
function loadFonts(): { regular: Buffer; bold: Buffer } {
  fonts ??= {
    regular: readFileSync(path.join(FONT_DIR, 'NotoSans-Regular.ttf')),
    bold: readFileSync(path.join(FONT_DIR, 'NotoSans-Bold.ttf')),
  };
  return fonts;
}

export class AgreementRenderError extends Error {
  constructor(readonly code: 'content_invalid' | 'sections_invalid' | 'too_large') {
    super(`agreement render: ${code}`);
    this.name = 'AgreementRenderError';
  }
}

/** `compress: false` is for tests only: it leaves the streams readable so the embedded glyphs can be checked. */
export type RenderInput = { content: unknown; sections: unknown; compress?: boolean };
export type RenderedAgreement = { bytes: Buffer; sha256: string };

/** Renders one agreement. Throws `AgreementRenderError` on a shape it cannot trust or a file over 1 MiB. */
export async function renderAgreementPdf(input: RenderInput): Promise<RenderedAgreement> {
  const content = AgreementContentSchema.safeParse(input.content);
  if (!content.success) throw new AgreementRenderError('content_invalid');
  const sections = AgreementSectionsSchema.safeParse(input.sections);
  if (!sections.success) throw new AgreementRenderError('sections_invalid');
  const bytes = await draw(content.data, sections.data, input.compress ?? true);
  if (bytes.length > AGREEMENT_MAX_BYTES) throw new AgreementRenderError('too_large');
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function draw(content: AgreementContent, sections: AgreementSections, compress: boolean): Promise<Buffer> {
  const values = fieldValues(content);
  const revealedAt = new Date(content.unlocked_at);
  const { regular, bold } = loadFonts();
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 56, bottom: 64, left: 56, right: 56 },
    bufferPages: true,
    compress,
    // No default font: pdfkit's built in Helvetica cannot print Turkish letters or the lira sign.
    font: null as unknown as string,
    lang: 'tr-TR',
    info: {
      Title: `${TR.title} ${content.agreement_number}`,
      Author: content.platform_name,
      Creator: content.platform_name,
      Producer: content.platform_name,
      CreationDate: revealedAt,
      ModDate: revealedAt,
    },
  });
  doc.registerFont(REGULAR, regular);
  doc.registerFont(BOLD, bold);

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.font(BOLD).fontSize(18).text(TR.title, { width, align: 'center', features });
  doc.moveDown(0.3);
  doc
    .font(REGULAR)
    .fontSize(10)
    .text(`${TR.number}: ${content.agreement_number}`, { width, align: 'center', features });
  doc.moveDown(1.2);

  for (const section of sections) {
    doc.font(BOLD).fontSize(12.5).text(fillText(section.heading, values), { width, features });
    doc.moveDown(0.3);
    for (const paragraph of section.paragraphs) {
      doc
        .font(REGULAR)
        .fontSize(10.5)
        .text(fillText(paragraph, values), { width, align: 'left', lineGap: 2, features });
      doc.moveDown(0.5);
    }
    doc.moveDown(0.5);
  }

  // The text signature block: each side, its name and when it accepted (Template fields).
  doc.font(BOLD).fontSize(12.5).text(TR.signatures, { width, features });
  doc.moveDown(0.3);
  const line = (role: string, name: string, at: string) =>
    doc
      .font(REGULAR)
      .fontSize(10.5)
      .text(`${role}: ${name}, ${TR.accepted}: ${formatAgreementInstant(at, content.timezone)}`, {
        width,
        lineGap: 2,
        features,
      });
  line(TR.customer, content.customer_name, content.customer_accepted_at);
  doc.moveDown(0.3);
  line(TR.provider, content.provider_name, content.provider_accepted_at);

  // Footers: the number and the page on every page, inside the bottom margin.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font(REGULAR)
      .fontSize(8.5)
      .text(
        `${content.agreement_number} · ${TR.page} ${i - range.start + 1} / ${range.count}`,
        doc.page.margins.left,
        doc.page.height - bottom / 2 - 6,
        { width, align: 'center', lineBreak: false, features },
      );
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}
