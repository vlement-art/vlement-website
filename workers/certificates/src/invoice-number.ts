// Assigns the sale's invoice number once; later calls return the stored number.
// Both statements run in one D1 batch (a transaction), so the counter only
// advances when a number was actually assigned.
export async function ensureInvoiceNumber(db: D1Database, saleNumber: string): Promise<string | null> {
  await db.batch([
    db.prepare(
      `UPDATE sales
          SET invoice_number = 'VL-' || printf('%06d', (SELECT last_value + 1 FROM invoice_counter WHERE id = 1))
        WHERE sale_number = ? AND invoice_number IS NULL`,
    ).bind(saleNumber),
    db.prepare('UPDATE invoice_counter SET last_value = last_value + 1 WHERE id = 1 AND changes() > 0'),
  ]);
  const row = await db.prepare('SELECT invoice_number FROM sales WHERE sale_number = ?')
    .bind(saleNumber).first<{ invoice_number: string | null }>();
  return row?.invoice_number ?? null;
}
