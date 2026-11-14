ALTER TABLE sales ADD COLUMN invoice_number TEXT;
CREATE UNIQUE INDEX idx_sales_invoice_number ON sales(invoice_number) WHERE invoice_number IS NOT NULL;

CREATE TABLE invoice_counter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_value INTEGER NOT NULL
);
-- The first invoice is VL-048213.
INSERT INTO invoice_counter (id, last_value) VALUES (1, 48212);
