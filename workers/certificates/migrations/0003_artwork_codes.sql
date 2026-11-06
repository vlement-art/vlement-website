-- Additive artwork inventory codes. Existing certificate numbers and sales rows are untouched.
CREATE TABLE artwork_codes (
  id TEXT PRIMARY KEY,
  artwork_slug TEXT NOT NULL UNIQUE,
  artwork_code TEXT NOT NULL UNIQUE
    CHECK (artwork_code GLOB 'VL-O-A[0-9][0-9][0-9][0-9]*'
        OR artwork_code GLOB 'VL-LE-B[0-9][0-9][0-9][0-9]*'
        OR artwork_code GLOB 'VL-OE-C[0-9][0-9][0-9][0-9]*'),
  type TEXT NOT NULL CHECK (type IN ('O', 'LE', 'OE')),
  edition_size INTEGER,
  based_on_code TEXT REFERENCES artwork_codes(artwork_code),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at TEXT NOT NULL,
  CHECK ((type = 'LE' AND edition_size IS NOT NULL AND edition_size >= 1)
      OR (type IN ('O', 'OE') AND edition_size IS NULL)),
  CHECK ((type = 'O' AND artwork_code GLOB 'VL-O-A[0-9][0-9][0-9][0-9]*')
      OR (type = 'LE' AND artwork_code GLOB 'VL-LE-B[0-9][0-9][0-9][0-9]*')
      OR (type = 'OE' AND artwork_code GLOB 'VL-OE-C[0-9][0-9][0-9][0-9]*'))
);

CREATE TABLE code_counter (
  type TEXT PRIMARY KEY CHECK (type IN ('O', 'LE', 'OE')),
  next_number INTEGER NOT NULL CHECK (next_number >= 1)
);
INSERT INTO code_counter (type, next_number) VALUES ('O', 1), ('LE', 1), ('OE', 1);

CREATE TABLE artwork_units (
  id TEXT PRIMARY KEY,
  artwork_code TEXT NOT NULL REFERENCES artwork_codes(artwork_code),
  unit_number INTEGER NOT NULL CHECK (unit_number >= 1),
  unit_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'sold', 'cancelled-reserved', 'released')),
  sale_id TEXT REFERENCES sales(id),
  created_at TEXT NOT NULL,
  UNIQUE (artwork_code, unit_number)
);
CREATE INDEX artwork_units_by_sale ON artwork_units(sale_id);

CREATE TABLE artwork_code_audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('code_created', 'unit_assigned', 'unit_released', 'code_retired')),
  artwork_code TEXT NOT NULL,
  unit_code TEXT,
  occurred_at TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json))
);
CREATE INDEX artwork_code_audit_by_code ON artwork_code_audit_log(artwork_code, occurred_at);

CREATE TRIGGER artwork_code_audit_no_update
BEFORE UPDATE ON artwork_code_audit_log BEGIN
  SELECT RAISE(ABORT, 'artwork code audit events are append-only');
END;
CREATE TRIGGER artwork_code_audit_no_delete
BEFORE DELETE ON artwork_code_audit_log BEGIN
  SELECT RAISE(ABORT, 'artwork code audit events are append-only');
END;

-- Link fields are nullable so every existing production record remains unchanged.
ALTER TABLE certificates ADD COLUMN artwork_code TEXT REFERENCES artwork_codes(artwork_code);
ALTER TABLE certificates ADD COLUMN unit_code TEXT REFERENCES artwork_units(unit_code);
ALTER TABLE sales ADD COLUMN artwork_code TEXT REFERENCES artwork_codes(artwork_code);
ALTER TABLE sales ADD COLUMN unit_code TEXT REFERENCES artwork_units(unit_code);

-- Keep a print number reserved on sale cancellation. The worker must also enforce this rule
-- when choosing an edition number; the trigger rejects numbers beyond the configured size.
CREATE TRIGGER artwork_units_enforce_limited_size
BEFORE INSERT ON artwork_units
WHEN (SELECT type FROM artwork_codes WHERE artwork_code = NEW.artwork_code) = 'LE'
 AND NEW.unit_number > (SELECT edition_size FROM artwork_codes WHERE artwork_code = NEW.artwork_code)
BEGIN
  SELECT RAISE(ABORT, 'limited edition size exceeded');
END;

CREATE TRIGGER artwork_codes_lock_type_and_size
BEFORE UPDATE OF type, edition_size ON artwork_codes
WHEN NEW.type != OLD.type OR (NEW.edition_size IS NOT OLD.edition_size AND EXISTS (
  SELECT 1 FROM artwork_units WHERE artwork_code = OLD.artwork_code AND status IN ('sold', 'cancelled-reserved')
))
BEGIN
  SELECT RAISE(ABORT, 'artwork code type is locked; edition size is locked after a copy is sold');
END;

CREATE TRIGGER artwork_codes_never_reuse
BEFORE DELETE ON artwork_codes BEGIN
  SELECT RAISE(ABORT, 'artwork codes cannot be deleted; retire the code instead');
END;
