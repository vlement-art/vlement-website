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
  currency: string;
  notes: string;
  status: 'active' | 'cancelled';
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
  const rows: Array<[string, string]> = [
    ['Receipt number', sale.sale_number],
    ['Sale date', sale.sale_date],
    ['Artwork', artwork.title || sale.artwork_slug],
    ['Item type', type],
  ];
  if (sale.item_type === 'limited_edition') {
    rows.push(['Edition', artwork.editionSize
      ? `Edition ${sale.edition_number} of ${artwork.editionSize}`
      : `Edition ${sale.edition_number} (edition size unavailable)`]);
  }
  rows.push(['Price', price], ['Buyer', sale.buyer_name]);
  if (sale.buyer_email) rows.push(['Email', sale.buyer_email]);
  if (includeNotes && sale.notes) rows.push(['Notes', sale.notes]);
  const seller = [env.SELLER_NAME, env.SELLER_WEBSITE, env.SELLER_EMAIL, env.SELLER_ADDRESS]
    .filter((value): value is string => Boolean(value));
  const rowHtml = rows.map(([label, value]) => `<tr><td style="padding:8px 18px 8px 0;color:#666;vertical-align:top">${escapeHtml(label)}</td><td style="padding:8px 0;white-space:pre-wrap;vertical-align:top">${escapeHtml(value)}</td></tr>`).join('');
  const cancelled = sale.status === 'cancelled';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Receipt</title><style>@media print { @page { size: A4; margin: 20mm; } body { margin: 0 !important; } .receipt { padding: 0 !important; } }</style></head>
<body style="margin:0;background:#fff;color:#333;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" style="border-collapse:collapse;width:100%;background:#fff"><tr><td align="center">
<table role="presentation" class="receipt" style="border-collapse:collapse;width:100%;max-width:680px;padding:32px"><tr><td style="padding:32px">
<h1 style="font-size:28px;font-weight:600;margin:0 0 24px">Receipt</h1>
${cancelled ? '<p style="font-size:20px;font-weight:bold;color:#444">CANCELLED</p>' : ''}
<table role="presentation" style="border-collapse:collapse;width:100%;font-size:15px">${rowHtml}</table>
<p style="margin:32px 0 8px;font-weight:bold">Seller</p>
<p style="margin:0;line-height:1.6;white-space:pre-wrap">${seller.map(escapeHtml).join('<br>')}</p>
<p style="margin:32px 0">Thank you for your purchase.</p>
<table role="presentation" style="border-collapse:collapse;margin-top:48px"><tr><td style="vertical-align:middle;padding-right:12px"><img src="https://vlement.com/images/vaa-logo.png" width="100" alt="Visual Artists Association logo" style="width:100px;height:auto;display:block"></td><td style="font-size:12px;color:#777;vertical-align:middle">Member of the Visual Artists Association</td></tr></table>
</td></tr></table></td></tr></table></body></html>`;
  const text = [
    'Receipt', ...(cancelled ? ['CANCELLED'] : []),
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '', 'Seller', ...seller, '', 'Thank you for your purchase.',
    '', 'Member of the Visual Artists Association',
  ].join('\n');
  return { html, text };
}
