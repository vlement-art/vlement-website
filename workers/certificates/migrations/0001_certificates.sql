CREATE TABLE counters (
  certificate_type TEXT NOT NULL CHECK (certificate_type IN ('original', 'limited_edition', 'open_edition')),
  year INTEGER NOT NULL CHECK (year BETWEEN 1900 AND 9999),
  value INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0),
  PRIMARY KEY (certificate_type, year)
);

CREATE TABLE certificates (
  id TEXT PRIMARY KEY,
  certificate_type TEXT NOT NULL CHECK (certificate_type IN ('original', 'limited_edition', 'open_edition')),
  certificate_number TEXT NOT NULL UNIQUE,
  verification_token TEXT NOT NULL UNIQUE,
  artwork_slug TEXT NOT NULL,
  edition_number INTEGER,
  edition_size INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'valid', 'revoked', 'voided')),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  revocation_reason TEXT,
  CHECK (
    (certificate_type = 'limited_edition' AND edition_number IS NOT NULL AND edition_number >= 1
      AND edition_size IS NOT NULL AND edition_size >= 1 AND edition_number <= edition_size)
    OR
    (certificate_type != 'limited_edition' AND edition_number IS NULL AND edition_size IS NULL)
  ),
  UNIQUE (artwork_slug, certificate_type, edition_number)
);

CREATE UNIQUE INDEX certificates_one_original_per_artwork
  ON certificates (artwork_slug)
  WHERE certificate_type = 'original' AND status IN ('pending', 'valid');

CREATE INDEX certificates_by_artwork ON certificates (artwork_slug, created_at);
CREATE INDEX certificates_by_status ON certificates (status, created_at);

CREATE TABLE certificate_versions (
  id TEXT PRIMARY KEY,
  certificate_id TEXT NOT NULL REFERENCES certificates(id),
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  issued_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  original_image_path TEXT NOT NULL,
  web_image_path TEXT,
  pdf_path TEXT,
  pdf_sha256 TEXT,
  reissue_reason TEXT,
  previous_version_id TEXT REFERENCES certificate_versions(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'valid', 'superseded', 'voided')),
  created_at TEXT NOT NULL,
  UNIQUE (certificate_id, version_number)
);

CREATE UNIQUE INDEX certificate_versions_one_pending
  ON certificate_versions (certificate_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX certificate_versions_one_current
  ON certificate_versions (certificate_id)
  WHERE status = 'valid';

CREATE INDEX certificate_versions_history ON certificate_versions (certificate_id, version_number);

CREATE TABLE nfc_tags (
  id TEXT PRIMARY KEY,
  certificate_id TEXT NOT NULL REFERENCES certificates(id),
  tag_reference TEXT NOT NULL COLLATE NOCASE UNIQUE,
  placement TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  tested INTEGER NOT NULL DEFAULT 0 CHECK (tested IN (0, 1)),
  replaced_tag_id TEXT REFERENCES nfc_tags(id)
);

CREATE INDEX nfc_tags_by_certificate ON nfc_tags (certificate_id, registered_at);

CREATE TABLE certificate_events (
  id TEXT PRIMARY KEY,
  certificate_id TEXT REFERENCES certificates(id),
  event_type TEXT NOT NULL CHECK (
    event_type IN ('issue_pending', 'reissue_pending', 'issued', 'reissued', 'revoked', 'pending_voided', 'tag_registered',
      'tag_tested', 'tag_replaced', 'tag_revoked', 'backup_exported')
  ),
  occurred_at TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json))
);

CREATE INDEX certificate_events_by_certificate ON certificate_events (certificate_id, occurred_at);
CREATE UNIQUE INDEX certificate_events_one_finalization
  ON certificate_events (certificate_id, event_type, json_extract(details_json, '$.versionNumber'))
  WHERE event_type IN ('issued', 'reissued');
CREATE UNIQUE INDEX certificate_events_one_backup_export
  ON certificate_events (json_extract(details_json, '$.backupId'))
  WHERE event_type = 'backup_exported';

CREATE TRIGGER certificate_events_no_update
BEFORE UPDATE ON certificate_events
BEGIN
  SELECT RAISE(ABORT, 'certificate events are append-only');
END;

CREATE TRIGGER certificate_events_no_delete
BEFORE DELETE ON certificate_events
BEGIN
  SELECT RAISE(ABORT, 'certificate events are append-only');
END;

CREATE TRIGGER certificate_versions_snapshot_immutable
BEFORE UPDATE OF snapshot_json ON certificate_versions
WHEN OLD.snapshot_json != NEW.snapshot_json
BEGIN
  SELECT RAISE(ABORT, 'certificate version snapshots are immutable');
END;

CREATE TRIGGER certificate_versions_no_delete
BEFORE DELETE ON certificate_versions
BEGIN
  SELECT RAISE(ABORT, 'certificate versions cannot be deleted');
END;

CREATE TRIGGER certificates_no_delete
BEFORE DELETE ON certificates
BEGIN
  SELECT RAISE(ABORT, 'certificates cannot be deleted');
END;

CREATE TRIGGER limited_edition_size_immutable
BEFORE INSERT ON certificates
WHEN NEW.certificate_type = 'limited_edition'
  AND EXISTS (
    SELECT 1 FROM certificates
    WHERE artwork_slug = NEW.artwork_slug
      AND certificate_type = 'limited_edition'
      AND edition_size != NEW.edition_size
  )
BEGIN
  SELECT RAISE(ABORT, 'limited edition size cannot change after issuance');
END;
