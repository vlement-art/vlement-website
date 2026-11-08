import {
  AlignmentType, BorderStyle, Document, Footer, ImageRun, Packer, PageOrientation,
  Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType,
} from 'docx';
import { formatDimensions } from '../lib/dimensions.mjs';

const ink = '24241F';
const twip = cm => Math.round(cm * 1440 / 2.54);
const pixels = cm => cm * 96 / 2.54;
const line = { style: BorderStyle.SINGLE, size: 4, color: ink };
const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const borders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };

export function shortDescription(text) {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 350) return { text: cleaned, shortened: false };
  const end = [...cleaned.slice(0, 350).matchAll(/[.!?](?=\s|$)/g)].at(-1);
  return { text: end ? cleaned.slice(0, end.index + 1) : '', shortened: true };
}

export function labelOrientation(choice, width, height) {
  if (!['auto', 'landscape', 'portrait'].includes(choice)) throw new Error('Choose a valid label orientation.');
  if (!(width > 0 && height > 0)) throw new Error('The artwork image has invalid dimensions.');
  return choice === 'auto' ? (width >= height ? 'landscape' : 'portrait') : choice;
}

function paragraph(text, options = {}) {
  return new Paragraph({
    children: [new TextRun({ text: String(text), font: 'Arial', color: ink, size: options.size || 20, bold: options.bold || false })],
    spacing: { before: 0, after: options.after ?? 55, line: options.line || 240 },
    alignment: options.align,
    border: options.border,
  });
}

function imageParagraph(data, width, height, align = AlignmentType.LEFT) {
  return new Paragraph({
    children: [new ImageRun({ data, type: 'jpg', transformation: { width, height } })],
    alignment: align,
    spacing: { before: 0, after: 40 },
  });
}

function cell(children, width) {
  return new TableCell({
    width: { size: twip(width), type: WidthType.DXA },
    margins: { top: 0, bottom: 0, left: 0, right: twip(0.25) },
    borders,
    children,
  });
}

function table(cells, widths) {
  return new Table({
    width: { size: twip(widths.reduce((a, b) => a + b, 0)), type: WidthType.DXA },
    columnWidths: widths.map(twip),
    layout: TableLayoutType.FIXED,
    borders,
    rows: [new TableRow({ cantSplit: true, children: cells.map((items, i) => cell(items, widths[i])) })],
  });
}

export function createLabelDocument({ artwork, orientation, image, qr }) {
  const { data } = artwork;
  const title = String(data.title || '').trim();
  if (!title || title.length > 150 || /\S{40,}/u.test(title)) {
    throw new Error('The title is missing or too long for a one-page label. Shorten it before generating a label.');
  }
  if (String(data.medium || '').length > 100 || String(data.dimensions || '').length > 100) {
    throw new Error('The medium or dimensions are too long for a one-page label. Shorten them before generating a label.');
  }
  const content = [title, data.medium, data.dimensions, artwork.description].join(' ');
  if (/\bVL-(?:O|LE|OE)-(?:[ABC]\d+|\d{4}-\d+)\b|\b(?:artwork|unit|certificate|receipt)\s+(?:code|number)\b|\bnfc\s*(?:uid|tag)\b|[£€$]\s*\d|\b(?:price|sold|for sale)\b/i.test(content)) {
    throw new Error('The artwork text contains a code, price or sale information. Remove it before creating the label.');
  }
  const landscape = orientation === 'landscape';
  const description = shortDescription(artwork.description);
  const maxImageCm = landscape ? 5 : 6.3;
  const scale = Math.min(pixels(maxImageCm) / image.width, pixels(maxImageCm) / image.height);
  const picture = imageParagraph(image.bytes, Math.round(image.width * scale), Math.round(image.height * scale),
    landscape ? AlignmentType.LEFT : AlignmentType.CENTER);
  const details = [
    paragraph(title, { size: 32, bold: true, after: 40, line: 380 }),
    paragraph(data.year || '', { after: 80 }),
    paragraph('MEDIUM', { size: 16, bold: true, after: 0 }),
    paragraph(data.medium || '', { after: 50 }),
    paragraph('DIMENSIONS', { size: 16, bold: true, after: 0 }),
    paragraph(formatDimensions(data.dimensions), { after: 50 }),
  ];
  if (data.editionType === 'limited') details.push(paragraph('Limited edition print'));
  if (data.editionType === 'open') details.push(paragraph('Open edition print'));
  const qrParagraph = new Paragraph({
    alignment: AlignmentType.RIGHT,
    children: [new ImageRun({ data: qr, type: 'png', transformation: { width: pixels(2.5), height: pixels(2.5) } })],
    spacing: { after: 0 },
  });
  const bodyWidth = landscape ? 19.4 : 13.2;
  const children = [
    paragraph('VLEMENT J. RODRIGUES', { size: 16, bold: true, after: 110, border: { bottom: { ...line, space: 4 } } }),
    ...(landscape ? [table([[picture], details], [5.5, 13.9])] : [picture, ...details]),
    ...(description.text ? [paragraph(description.text, { after: 80 })] : []),
  ];
  const footer = [
    table([
      [paragraph('Please keep away from direct sunlight, heat and humidity. Clean gently with a dry, soft cloth.', { size: 20 })],
      [qrParagraph, paragraph('View this artwork online', { size: 16, align: AlignmentType.RIGHT, after: 0 })],
    ], [bodyWidth - 4.2, 4.2]),
    paragraph('vlement.com', { size: 16, after: 0, border: { top: { ...line, space: 4 } } }),
  ];
  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', color: ink, size: 20 }, paragraph: { spacing: { before: 0, after: 0 } } } } },
    sections: [{
      properties: {
        page: {
          size: { width: twip(14.8), height: twip(21), orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
          margin: { top: twip(0.8), bottom: twip(0.8), left: twip(0.8), right: twip(0.8), header: 0, footer: twip(0.8) },
        },
      },
      footers: { default: new Footer({ children: footer }) },
      children,
    }],
  });
  return { document: doc, shortened: description.shortened };
}

export async function makeLabelBlob(options) {
  const result = createLabelDocument(options);
  return { blob: await Packer.toBlob(result.document), shortened: result.shortened };
}
