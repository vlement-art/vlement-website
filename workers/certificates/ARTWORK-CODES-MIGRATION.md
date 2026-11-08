# Artwork-code migration safety and backfill plan

## Audit findings

- Certificates and sales currently refer to artworks by `artwork_slug`; certificates retain their existing unique `certificate_number` and random `verification_token`.
- Certificate numbers are generated from type/year counters using the existing `VL-%s-%04d-%04d` format. This feature does not rewrite, renumber, or delete those rows or alter that format.
- Sales store edition allocations in `edition_number` / `open_edition_number`; cancellation retains the sale record and writes an append-only audit event. The new code and unit references are nullable.
- The admin loads markdown from GitHub and renders its grid/editor in `public/admin/index.html`; the Sales API is served by the certificate Worker. Internal code data must be sourced only from the admin-authorized Worker API and must never be added to artwork markdown or the public verification routes.

## Migration safety (mandatory before each remote apply)

Do not run this migration against production from the coding task. Before an operator applies it:

1. Export a verified backup using `wrangler d1 export <DB_NAME> --remote --output backup-<date>.sql --config workers/certificates/wrangler.jsonc --env <environment>`.
2. Record the current D1 Time Travel bookmark with `wrangler d1 time-travel info <DB_NAME> --config workers/certificates/wrangler.jsonc --env <environment> --json`.
3. Import the export into an isolated local/temp D1 and compare every table's row counts to the source before proceeding. Stop if any counts differ.
4. First apply and test the migration on a local/preview database. No migration or backfill is included here that targets production automatically.
5. Rollback by disabling/reverting the Worker/admin feature while retaining the additive database objects. `0003_artwork_codes_down.sql` is intentionally non-destructive because dropping code/unit/audit data or nullable references could discard records created after rollout. For full database restoration, use the recorded Time Travel bookmark, or import the verified export into a *new* database and cut over its binding only after explicit review.

## Local/preview commands

From the repository root, after configuring an isolated local D1 binding (never production):

```sh
npx wrangler d1 migrations apply vlement-certificates-local --local --config workers/certificates/wrangler.jsonc
npx wrangler d1 execute vlement-certificates-local --local --command "PRAGMA foreign_key_check" --config workers/certificates/wrangler.jsonc
```

## Backfill existing artworks (`scripts/backfill-artwork-codes.mjs`)

The dry run uses an existing `editionType` when present. It maps `category: Original painting` to `original`; `category: Print` is not enough to distinguish `limited` from `open`, so those rows are marked `NEEDS DECISION`. A limited edition without a valid `editionSize` is also marked `NEEDS DECISION`.

1. **Dry run** (read-only; no database writes): `npm run codes:backfill -- --dry-run --csv artwork-codes-review.csv`. Optionally set `CERTIFICATES_API_URL` and `VLEMENT_ADMIN_TOKEN` to omit artworks that already have a code.
2. **Review** the CSV. Replace every `NEEDS DECISION` in `proposed_type` with `original`, `limited` or `open` (limited also needs `edition_size`).
3. **Apply** (only after the production steps below): `CERTIFICATES_API_URL=<worker url> VLEMENT_ADMIN_TOKEN=<GitHub token> npm run codes:backfill -- --apply --csv artwork-codes-review.csv`. It refuses to run while any row is invalid or still `NEEDS DECISION`, skips artworks that already have a code (safe to re-run), and uses the per-type counters (A/B/C).

## Production runbook (operator only)

1. Back up D1 and record the Time Travel bookmark (see "Migration safety" above).
2. `npx wrangler d1 migrations list <DB_NAME> --remote --config workers/certificates/wrangler.jsonc --env production`
3. If `0003_artwork_codes` is pending: `npx wrangler d1 migrations apply <DB_NAME> --remote --config workers/certificates/wrangler.jsonc --env production`
4. Deploy/approve the Worker so `/api/admin/artwork-codes` is live.
5. Run the backfill dry run, review/approve the CSV, then run `--apply`.
6. Verify: re-run `--apply` (all rows should say `skip`), and check `/admin` shows a code on every artwork card.

## Checking for missing creation audit events

An earlier Worker version could report "Could not create the artwork code" after
the code was saved, but before its creation audit event was written. Refresh the
admin and retain any existing code rather than assigning a replacement. An
authorized operator can identify affected records using this read-only query:

```sql
SELECT ac.artwork_slug, ac.artwork_code, ac.type, ac.created_at
FROM artwork_codes ac
WHERE NOT EXISTS (
  SELECT 1 FROM artwork_code_audit_log log
  WHERE log.artwork_code = ac.artwork_code AND log.action = 'code_created'
);
```

Review any results before deciding how to reconcile the audit history. Do not
fabricate the original actor or delete and reissue codes.
