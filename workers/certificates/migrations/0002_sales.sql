CREATE TABLE sales (
  id TEXT PRIMARY KEY,
  artwork_slug TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('original', 'limited_edition', 'open_edition')),
  edition_number INTEGER,
  open_edition_number INTEGER,
  sale_number TEXT NOT NULL UNIQUE,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT,
  sale_date TEXT NOT NULL CHECK (sale_date GLOB '????-??-??'),
  price REAL NOT NULL CHECK (price >= 0),
  currency TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at TEXT,
  certificate_id TEXT REFERENCES certificates(id),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  CHECK (
    (item_type = 'limited_edition' AND edition_number IS NOT NULL AND edition_number >= 1
      AND open_edition_number IS NULL)
    OR
    (item_type = 'open_edition' AND edition_number IS NULL AND open_edition_number IS NOT NULL
      AND open_edition_number >= 1)
    OR
    (item_type = 'original' AND edition_number IS NULL AND open_edition_number IS NULL)
  ),
  CHECK ((status = 'active' AND cancelled_at IS NULL) OR (status = 'cancelled' AND cancelled_at IS NOT NULL))
);

CREATE UNIQUE INDEX sales_one_active_original_per_artwork
  ON sales (artwork_slug)
  WHERE item_type = 'original' AND status = 'active';

CREATE UNIQUE INDEX sales_one_active_limited_edition_number
  ON sales (artwork_slug, edition_number)
  WHERE item_type = 'limited_edition' AND status = 'active';

CREATE INDEX sales_by_artwork ON sales (artwork_slug);
CREATE INDEX sales_by_date ON sales (sale_date);
CREATE INDEX sales_by_status ON sales (status);

CREATE TABLE open_edition_sales_counters (
  artwork_slug TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0)
);

CREATE TABLE sales_audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('sale_recorded', 'sale_cancelled', 'certificate_linked')),
  sale_id TEXT NOT NULL REFERENCES sales(id),
  sale_number TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json))
);

CREATE INDEX sales_audit_by_sale ON sales_audit_log (sale_id, occurred_at);

CREATE TRIGGER sales_audit_no_update
BEFORE UPDATE ON sales_audit_log
BEGIN
  SELECT RAISE(ABORT, 'sales audit events are append-only');
END;

CREATE TRIGGER sales_audit_no_delete
BEFORE DELETE ON sales_audit_log
BEGIN
  SELECT RAISE(ABORT, 'sales audit events are append-only');
END;
