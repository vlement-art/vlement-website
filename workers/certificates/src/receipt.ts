import { VAA_LOGO_DATA_URI } from './invoice-logo';
import type { CertificateType, Env } from './types';

export interface ReceiptSale {
  sale_number: string;
  artwork_slug: string;
  item_type: CertificateType;
  edition_number: number | null;
  buyer_name: string;
  buyer_email: string | null;
  sale_date: string;
  price: number;
  delivery?: number;
  currency: string;
  notes: string;
  status: 'active' | 'cancelled';
  invoice_number?: string | null;
}

export interface ReceiptArtwork {
  title: string;
  editionSize: number | null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] || char);
}

export function renderReceipt(
  sale: ReceiptSale,
  artwork: ReceiptArtwork,
  env: Env,
  includeNotes = false,
): { html: string; text: string } {
  const type = {
    original: 'Original',
    limited_edition: 'Limited edition',
    open_edition: 'Open edition',
  }[sale.item_type];
  const price = new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: sale.currency,
  }).format(sale.price);
  const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: sale.currency });
  const delivery = Number(sale.delivery) || 0;
  const total = money.format(sale.price + delivery);
  const [year, month, day] = sale.sale_date.split('-');
  const saleDate = `${day}-${month}-${year}`;
  const invoiceNumber = sale.invoice_number || sale.sale_number;
  const title = artwork.title || sale.artwork_slug;
  const edition = sale.item_type === 'limited_edition'
    ? (artwork.editionSize
      ? `Edition ${sale.edition_number} of ${artwork.editionSize}`
      : `Edition ${sale.edition_number}`)
    : '';
  const notes = includeNotes && sale.notes ? sale.notes : '';
  const seller = [env.SELLER_NAME, env.SELLER_WEBSITE, env.SELLER_EMAIL, env.SELLER_ADDRESS]
    .filter((value): value is string => Boolean(value?.trim()));
  const cancelled = sale.status === 'cancelled';
  const label = 'font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#7b8794;margin:0 0 6px';
  const cell = 'padding:14px 16px;border-bottom:1px solid #e4e7eb;vertical-align:top';
  const logo = VAA_LOGO_DATA_URI
    ? `<td style="vertical-align:middle;padding-right:14px"><img src="${VAA_LOGO_DATA_URI}" alt="Visual Artists Association logo" style="width:46mm;height:auto;display:block"></td>`
    : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Invoice_${escapeHtml(invoiceNumber)}</title><style>@page { size: A4; margin: 0 } html, body { margin: 0; padding: 0 } body { -webkit-print-color-adjust: exact; print-color-adjust: exact }</style></head>
<body style="margin:0;background:#fff;color:#1f2933;font-family:Helvetica,Arial,sans-serif">
<div style="max-width:210mm;min-height:297mm;margin:0 auto;box-sizing:border-box;background:#fff">
<div style="height:28px;background:#2f4858"></div>
<div style="padding:44px 56px 40px">
<table role="presentation" style="border-collapse:collapse;width:100%"><tr>
<td style="vertical-align:top"><h1 style="font-size:40px;font-weight:700;letter-spacing:2px;margin:0;color:#1f2933">INVOICE</h1>${cancelled ? '<p style="font-size:14px;font-weight:bold;color:#7b8794;margin:8px 0 0">CANCELLED</p>' : ''}</td>
<td style="vertical-align:top;text-align:right"><p style="${label}">Invoice number</p><p style="font-size:18px;font-weight:700;margin:0">${escapeHtml(invoiceNumber)}</p></td>
</tr></table>
<div style="border-top:1px solid #e4e7eb;margin:28px 0"></div>
<table role="presentation" style="border-collapse:collapse;width:100%"><tr>
<td style="vertical-align:top;width:40%"><p style="${label}">Billed to</p><p style="font-size:15px;margin:0">${escapeHtml(sale.buyer_name)}</p></td>
<td style="vertical-align:top;width:30%"><p style="${label}">Date of sale</p><p style="font-size:15px;margin:0">${escapeHtml(saleDate)}</p></td>
<td style="vertical-align:top;width:30%"><p style="${label}">Item type</p><p style="font-size:15px;margin:0">${escapeHtml(type)}</p></td>
</tr></table>
<table role="presentation" style="border-collapse:collapse;width:100%;margin-top:36px;font-size:14px">
<tr style="background:#2f4858;color:#fff"><th style="padding:12px 16px;text-align:left;font-size:11px;letter-spacing:1.5px">DESCRIPTION</th><th style="padding:12px 16px;text-align:left;font-size:11px;letter-spacing:1.5px">TYPE</th><th style="padding:12px 16px;text-align:right;font-size:11px;letter-spacing:1.5px">AMOUNT</th></tr>
<tr style="background:#f5f7fa"><td style="${cell}"><strong>${escapeHtml(title)}</strong>${edition ? `<br><span style="color:#7b8794;font-size:12px">${escapeHtml(edition)}</span>` : ''}</td><td style="${cell}">${escapeHtml(type)}</td><td style="${cell};text-align:right">${escapeHtml(money.format(sale.price))}</td></tr>
<tr style="background:#fff"><td style="${cell}">Delivery</td><td style="${cell}"></td><td style="${cell};text-align:right">${escapeHtml(money.format(delivery))}</td></tr>
</table>
${notes ? `<p style="margin:16px 0 0;font-size:12px;color:#7b8794;white-space:pre-wrap">Notes: ${escapeHtml(notes)}</p>` : ''}
<table role="presentation" style="border-collapse:collapse;width:100%;margin-top:24px"><tr><td style="text-align:right"><p style="${label}">Total due</p><p style="font-size:30px;font-weight:700;color:#2f4858;margin:0">${escapeHtml(total)}</p></td></tr></table>
<div style="border-top:1px solid #e4e7eb;margin:48px 0 28px"></div>
<p style="${label}">Seller</p>
<p style="margin:0;font-size:14px;line-height:1.7;white-space:pre-wrap">${seller.map(escapeHtml).join('<br>')}</p>
<p style="margin:48px 0 0;font-size:15px;font-style:italic">Thank you for your purchase.</p>
<div style="border-top:1px solid #e4e7eb;margin:48px 0 20px"></div>
<table role="presentation" style="border-collapse:collapse"><tr>${logo}<td style="font-size:11px;color:#7b8794;vertical-align:middle">Member of the Visual Artists Association</td></tr></table>
</div></div></body></html>`;
  const text = [
    'INVOICE', ...(cancelled ? ['CANCELLED'] : []),
    `Invoice number: ${invoiceNumber}`,
    `Billed to: ${sale.buyer_name}`,
    `Date of sale: ${saleDate}`,
    `Item type: ${type}`,
    '', `${title}${edition ? ` (${edition})` : ''}: ${money.format(sale.price)}`,
    `Delivery: ${money.format(delivery)}`,
    `Total due: ${total}`,
    ...(notes ? ['', `Notes: ${notes}`] : []),
    '', 'Seller', ...seller, '', 'Thank you for your purchase.',
    '', 'Member of the Visual Artists Association',
  ].join('\n');
  return { html, text };
}
