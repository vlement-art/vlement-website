import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ensureInvoiceNumber } from '../src/invoice-number';

async function insertSale(saleNumber: string) {
  await env.DB.prepare(
    `INSERT INTO sales (id, artwork_slug, item_type, sale_number, buyer_name, sale_date, price, currency, created_at, created_by)
     VALUES (?, 'x', 'original', ?, 'Buyer', '2026-01-01', 10, 'GBP', '2026-01-01T00:00:00Z', 'test')`,
  ).bind(crypto.randomUUID(), saleNumber).run();
}

describe('invoice numbers', () => {
  it('starts at VL-048213, increments, and reuses the number on reprint', async () => {
    await insertSale('INV-A');
    await insertSale('INV-B');
    expect(await ensureInvoiceNumber(env.DB, 'INV-A')).toBe('VL-048213');
    expect(await ensureInvoiceNumber(env.DB, 'INV-B')).toBe('VL-048214');
    expect(await ensureInvoiceNumber(env.DB, 'INV-A')).toBe('VL-048213');
    const counter = await env.DB.prepare('SELECT last_value FROM invoice_counter').first<{ last_value: number }>();
    expect(counter?.last_value).toBe(48214);
  });
});
