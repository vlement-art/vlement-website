import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { VAA_LOGO_DATA_URI } from './invoice-logo';
import type { ReceiptArtwork, ReceiptSale } from './receipt';
import type { Env } from './types';

const W = 595.28;
const H = 841.89;
const MM = 72 / 25.4;
const INK = rgb(0x1f / 255, 0x29 / 255, 0x33 / 255);
const MUTED = rgb(0x7b / 255, 0x87 / 255, 0x94 / 255);
const LIGHT = rgb(0xf5 / 255, 0xf7 / 255, 0xfa / 255);
const LINE = rgb(0xe4 / 255, 0xe7 / 255, 0xeb / 255);
const ACCENT = rgb(0x2f / 255, 0x48 / 255, 0x58 / 255);
const MARGIN = 56 * 0.75;

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function invoiceFileName(invoiceNumber: string): string {
  return `Invoice_${invoiceNumber.replace(/[^A-Za-z0-9-]/g, '')}.pdf`;
}

export async function renderInvoicePdf(
  sale: ReceiptSale,
  artwork: ReceiptArtwork,
  env: Env,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const invoiceNumber = sale.invoice_number || sale.sale_number;
  pdf.setTitle(`Invoice_${invoiceNumber}`);
  pdf.setProducer('Vlement');
  pdf.setCreator('Vlement');
  const page = pdf.addPage([W, H]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  // Helvetica uses WinAnsi: replace anything it cannot encode so drawing never throws.
  const supported = new Set(regular.getCharacterSet());
  const clean = (value: string) => Array.from(value.replace(/[\u00a0\u202f]/g, ' '))
    .map(char => (supported.has(char.codePointAt(0)!) ? char : '?')).join('');
  const text = (value: string, x: number, top: number, size: number, font: PDFFont, color = INK, align: 'left' | 'right' = 'left') => {
    const safe = clean(value);
    const width = font.widthOfTextAtSize(safe, size);
    page.drawText(safe, { x: align === 'right' ? x - width : x, y: H - top - size, size, font, color });
  };
  const label = (value: string, x: number, top: number, align: 'left' | 'right' = 'left') => {
    const safe = clean(value.toUpperCase());
    const size = 7.5;
    const spacing = 1;
    const width = regular.widthOfTextAtSize(safe, size) + spacing * (safe.length - 1);
    page.drawText(safe, {
      x: align === 'right' ? x - width : x, y: H - top - size, size, font: regular, color: MUTED, characterSpacing: spacing,
    });
  };
  const rule = (top: number) => page.drawLine({
    start: { x: MARGIN, y: H - top }, end: { x: W - MARGIN, y: H - top }, thickness: 0.75, color: LINE,
  });

  const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: sale.currency });
  const delivery = Number(sale.delivery) || 0;
  const type = { original: 'Original', limited_edition: 'Limited edition', open_edition: 'Open edition' }[sale.item_type];
  const [year, month, day] = sale.sale_date.split('-');
  const title = artwork.title || sale.artwork_slug;
  const edition = sale.item_type === 'limited_edition'
    ? (artwork.editionSize ? `Edition ${sale.edition_number} of ${artwork.editionSize}` : `Edition ${sale.edition_number}`)
    : '';
  const right = W - MARGIN;

  page.drawRectangle({ x: 0, y: H - 21, width: W, height: 21, color: ACCENT });

  text('INVOICE', MARGIN, 66, 30, bold);
  if (sale.status === 'cancelled') text('CANCELLED', MARGIN, 102, 10.5, bold, MUTED);
  label('Invoice number', right, 66, 'right');
  text(invoiceNumber, right, 80, 14, bold, INK, 'right');
  rule(118);

  label('Billed to', MARGIN, 142);
  text(sale.buyer_name, MARGIN, 156, 11, regular);
  label('Date of sale', MARGIN + 200, 142);
  text(`${day}-${month}-${year}`, MARGIN + 200, 156, 11, regular);
  label('Item type', MARGIN + 340, 142);
  text(type, MARGIN + 340, 156, 11, regular);

  const colType = MARGIN + 270;
  const tableTop = 196;
  page.drawRectangle({ x: MARGIN, y: H - tableTop - 30, width: right - MARGIN, height: 30, color: ACCENT });
  const white = rgb(1, 1, 1);
  const head = (value: string, x: number, align: 'left' | 'right' = 'left') => {
    const size = 8;
    const spacing = 1;
    const width = bold.widthOfTextAtSize(value, size) + spacing * (value.length - 1);
    page.drawText(value, { x: align === 'right' ? x - width : x, y: H - tableTop - 19, size, font: bold, color: white, characterSpacing: spacing });
  };
  head('DESCRIPTION', MARGIN + 12);
  head('TYPE', colType);
  head('AMOUNT', right - 12, 'right');

  const row1Top = tableTop + 30;
  page.drawRectangle({ x: MARGIN, y: H - row1Top - 46, width: right - MARGIN, height: 46, color: LIGHT });
  text(title, MARGIN + 12, row1Top + 12, 11, bold);
  if (edition) text(edition, MARGIN + 12, row1Top + 28, 9, regular, MUTED);
  text(type, colType, row1Top + 12, 11, regular);
  text(money.format(sale.price), right - 12, row1Top + 12, 11, regular, INK, 'right');
  page.drawLine({ start: { x: MARGIN, y: H - row1Top - 46 }, end: { x: right, y: H - row1Top - 46 }, thickness: 0.75, color: LINE });

  const row2Top = row1Top + 46;
  text('Delivery', MARGIN + 12, row2Top + 12, 11, regular);
  text(money.format(delivery), right - 12, row2Top + 12, 11, regular, INK, 'right');
  page.drawLine({ start: { x: MARGIN, y: H - row2Top - 40 }, end: { x: right, y: H - row2Top - 40 }, thickness: 0.75, color: LINE });

  const totalTop = row2Top + 70;
  label('Total due', right, totalTop, 'right');
  text(money.format(sale.price + delivery), right, totalTop + 16, 24, bold, ACCENT, 'right');

  const sellerTop = totalTop + 90;
  rule(sellerTop);
  label('Seller', MARGIN, sellerTop + 24);
  const seller = [env.SELLER_NAME, env.SELLER_WEBSITE, env.SELLER_EMAIL, env.SELLER_ADDRESS]
    .filter((value): value is string => Boolean(value?.trim()));
  seller.forEach((line, i) => text(line, MARGIN, sellerTop + 42 + i * 17, 10.5, regular));

  const thanksTop = sellerTop + 42 + seller.length * 17 + 36;
  text('Thank you for your purchase.', MARGIN, thanksTop, 11.5, italic);

  const footerTop = Math.max(thanksTop + 50, H - 120);
  rule(footerTop);
  let textX = MARGIN;
  if (VAA_LOGO_DATA_URI) {
    const png = await pdf.embedPng(base64ToBytes(VAA_LOGO_DATA_URI.split(',')[1]));
    const logoW = 46 * MM;
    const logoH = logoW * png.height / png.width;
    page.drawImage(png, { x: MARGIN, y: H - footerTop - 18 - logoH, width: logoW, height: logoH });
    textX = MARGIN + logoW + 14;
    text('Member of the Visual Artists Association', textX, footerTop + 18 + logoH / 2 - 4, 8.5, regular, MUTED);
  } else {
    text('Member of the Visual Artists Association', textX, footerTop + 18, 8.5, regular, MUTED);
  }

  return pdf.save();
}
