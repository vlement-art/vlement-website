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

The repository currently has no checked-in artwork-code backfill command. Backfill requires a deterministic, reviewed mapping of each markdown artwork's `editionType` (including a manual decision for missing types), followed by links to existing certificates/sales. Generate and review that mapping before any explicit write operation; do not infer missing edition types silently.
