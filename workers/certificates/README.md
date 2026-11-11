# Certificate service

The certificate service is a separate Cloudflare Worker. The Astro site and
artwork records remain on GitHub Pages and in Git; certificate records and
private uploaded image copies/PDFs use D1 and R2. The Worker does not modify the
existing admin OAuth Worker.

An issue is initially `pending`. The admin creates a PDF containing the
artwork image, certificate details, and a QR code. The Worker stores the PDF
privately, records its SHA-256 digest, and only then makes the certificate
valid. Public verification never exposes a pending or voided issue as valid.
The admin presents a browser PDF preview before finalization; approval stores
the exact previewed PDF. Editing replaces the pending version while retaining
the certificate number and verification token. The previous valid version of
a reissue remains available until the replacement is approved.
Reissues preserve the previous valid version until the replacement PDF is
stored and finalized. An optional NFC UID entered at issue or reissue is
included in the immutable certificate snapshot and PDF. Supplying a placement
also registers a new tag when that PDF is finalized; without a placement the
UID is printed only. Reissuing with the same
active UID on that certificate reuses the existing tag record without creating
a duplicate. Tag references are globally unique, including revoked tags, so a
UID registered to another certificate or a previously revoked tag cannot be
reused. SHA-256 confirms the bytes served match the stored issuance record; it
is an integrity check, not a cryptographic signature. Certificate numbers,
edition allocations, version history, and audit history are not reused or
deleted.

The PDF shows the matching active artwork code captured when a new certificate
is issued; if none is available it uses the existing certificate number.
Reissues retain the artwork code recorded for that certificate version, and
never rewrite an already issued PDF. The layout embeds Noto Sans under the SIL
Open Font License; its license is distributed with the admin assets.

To generate local review fixtures, run
`node scripts/certificate-pdf-samples.mjs <output-directory>`. Run
`npm run test:pdf` to verify the fixtures' text boundaries and QR codes; this
test requires `pdftotoppm`, `pdftotext`, `pdfimages`, and `zbarimg`. The fixture
verification token is synthetic and no database or Worker is contacted.

The public verification response points PDF downloads at the origin serving
the Worker request. The artwork and verification pages continue to use the
configured canonical website origin.

The ZIP backup contains a JSON snapshot of counters, certificates, versions,
NFC tags, and audit events, plus every object in the private certificate R2
bucket. Keep the downloaded archive private: it contains verification tokens and the
source image files captured at issue time. Artwork files in Git remain backed
up separately. Restoring a ZIP is intentionally not automated; restore into new
Cloudflare resources and verify the imported records and objects before
switching the public endpoint.

## Admin sales

The **Sales** section in `/admin` records sales in the same D1 database. It
loads artwork metadata from the GitHub repository using the signed-in user's
existing bearer token. Every sales route repeats the certificate Worker's
GitHub user-ID and repository-push authorization check and uses the existing
per-user rate limiter (30 requests per minute, automatically reset after one
minute; it does not lock the account).

The admin sends its existing GitHub OAuth access token in the `Authorization:
Bearer` header to the public Worker origin configured by the
`PUBLIC_CERTIFICATES_API_URL` GitHub Actions variable. No separate sales
password, cookie, or token is used. The Worker returns `401` when the request
has no valid sign-in, `403` when the GitHub identity or repository permission
is not allowed, and `503` when `ALLOWED_GITHUB_USER_ID` is unset or invalid.
For a `403`, check that the Cloudflare Worker secret `ALLOWED_GITHUB_USER_ID`
contains the signed-in user's numeric GitHub ID and that the account has push
permission on `vlement-art/vlement-website`. The Worker variables
`ARTWORK_REPOSITORY` and `ALLOWED_ORIGIN` must also be set for that environment.
For a `503`, configure the secret for the exact Worker environment serving the
request (`staging` or `production`) and redeploy/restart as required by
Cloudflare.

### Sale receipts and export

The receipt endpoints use the same admin authorization and rate limit as sales.
`GET /api/admin/sales/receipt?saleNumber=...` returns HTML; notes are omitted
unless `includeNotes=1` is supplied. `POST /api/admin/sales/receipt/printed`
records that the print dialog was opened, not that a physical receipt was
printed. `POST /api/admin/sales/receipt/email` sends via Resend and records a
successful provider acceptance, not delivery. Receipt emails omit notes.

Configure `SELLER_NAME`, `SELLER_WEBSITE`, `SELLER_EMAIL`, and
`RECEIPT_FROM_ADDRESS` in the relevant Worker's Wrangler environment; optional
variables are `SELLER_ADDRESS` and `RECEIPT_REPLY_TO`. Add `RESEND_API_KEY` as
a Worker secret, never as a public site variable or a repository file. For
production, maintain the non-secret variables under `env.production.vars` in
`workers/certificates/wrangler.jsonc`, so subsequent Wrangler deployments retain
them. See [DEPLOY.md](DEPLOY.md) for deployment and secret setup. The sender
domain must be verified with Resend.
The receipt logo must be available at `https://vlement.com/images/vaa-logo.png`.

The migration is tracked by Wrangler: repeated `d1 migrations apply` runs skip
already-applied migrations. SQLite does not support `ADD COLUMN IF NOT EXISTS`;
do not manually replay the migration SQL. The production deployment workflow
applies pending migrations and deploys the Worker after a push to `main`, so
complete the external setup and review the production environment approval
before merging.

For an explicitly approved manual production rollout, run:

```sh
npx wrangler d1 migrations apply vlement-certificates-prod --remote --config workers/certificates/wrangler.jsonc --env production
npx wrangler deploy --env production --config workers/certificates/wrangler.jsonc
```

Recent sales can be exported to Excel; D1 remains authoritative. Sales CSV is
also included in the encrypted backup when D1 is exported, from that same
snapshot. The CSV prefixes formula-like text with an apostrophe to avoid
spreadsheet formula execution.

Authenticated routes:

- `GET /api/admin/sales/artworks` returns artwork title, category, price,
  edition metadata, and availability derived from Git frontmatter and active
  sales.
- `GET /api/admin/sales?page=1&per_page=20` returns newest sales first.
- `POST /api/admin/sales` records a sale; sale details are sent in the JSON
  body.
- `POST /api/admin/sales/cancel` cancels a sale; send its `saleNumber` in the
  JSON body. Cancellation is retained in the audit history, and open-edition
  numbers are never reused.

Sale numbers use the same configured `VL-{type}-{year}-{sequence}` prefixes
and annual D1 counters as certificates. Open editions also keep a separate
per-artwork sequence for display. Issuing a certificate for an active,
unlinked sale uses that sale's reserved number and associates the certificate
with it. Cancelling a sale that already has a certificate leaves the
certificate intact and flags it for manual follow-up. Sales, their per-artwork
open-edition counters, and their append-only audit log are included in the
certificate backup snapshot.

When recording or cancelling an original or limited-edition sale, the admin
updates the artwork's `available` frontmatter field through the same GitHub
Contents API write path used by the artwork editor. D1 and GitHub cannot share
a transaction; if the GitHub update fails during recording, the admin tries
to cancel the just-created sale and reports any remaining availability
correction clearly. Open editions remain available until manually changed.

### Sales deployment

The migration has **not** been applied and the Worker has **not** been
deployed. After review and merge, apply the migration to the intended
environment, then deploy the Worker. For production, first make or verify a
private backup and run these commands from the repository root:

```powershell
npx wrangler d1 migrations apply vlement-certificates-prod --remote --config workers/certificates/wrangler.jsonc --env production
npx wrangler deploy --config workers/certificates/wrangler.jsonc --env production
```

Do not run either command until the migration and deployment have been
reviewed and explicitly approved for production. For staging, use the
`vlement-certificates-staging` database and `--env staging` instead. Confirm
that the repository Actions variable `PUBLIC_CERTIFICATES_API_URL` points to
the deployed certificate Worker, then deploy the site so `/admin` loads the
Sales button. Test record, cancellation, availability writeback, and
certificate-number linking against staging before production use.

## Local development

Use Node.js 22 or later. These steps use local D1/R2 emulation and do not
contact production Cloudflare resources.

1. Copy `.dev.vars.example` to `.dev.vars` and replace the example number with
   the numeric GitHub user ID permitted to issue certificates.
2. Apply the local D1 schema:

   ```powershell
   npm run worker:migrate:local
   ```

3. In one terminal, start the Worker:

   ```powershell
   npm run worker:dev
   ```

4. In another terminal, point the static admin at the local Worker and start
   Astro:

   ```powershell
   $env:PUBLIC_CERTIFICATES_API_URL = 'http://localhost:8787'
   npm run dev
   ```

The Worker dev command allows the local Astro origin `http://localhost:4321`.
If Astro selects another port, update the Worker `ALLOWED_ORIGIN` override to
match it. The admin still authenticates with the existing GitHub OAuth flow;
the GitHub token is checked against the configured numeric user ID and the
repository's push permission, and is not stored in D1 or R2.

## Cloudflare setup required before deployment

`wrangler.jsonc` contains local resource names and a placeholder D1 ID. Do not
deploy it unchanged. Before deploying:

1. Create a dedicated D1 database, R2 bucket, and rate-limit namespace in
   Cloudflare. Use separate resources for staging and production.
2. Set the matching D1 database ID, database name, R2 bucket, and rate-limit
   namespace in the appropriate Wrangler environment. Keep the production
   configuration separate from local bindings.
3. Set `ALLOWED_GITHUB_USER_ID` as a Worker secret to the numeric GitHub user
   ID allowed to issue certificates. Set `ALLOWED_ORIGIN` to
   `https://vlement.com` and keep `ARTWORK_REPOSITORY` set to the artwork repo.
4. Apply migrations to the selected environment, deploy the Worker, and verify
   `/health`, admin authorization, a pending issue, finalization, and public
   verification against staging resources.
5. Add the public Worker origin (for example
   `https://vlement-certificates.<account>.workers.dev`) as the repository
   Actions variable `PUBLIC_CERTIFICATES_API_URL`. Ensure the Worker's
   `workers.dev` route is enabled when using this hostname. It is public
   configuration, not a credential; never put tokens or secrets in this
   variable.
6. Only switch the public site to the production Worker after the staging
   checks and a private backup have been reviewed.

Production resources, migrations, secrets, and deployments have not been
created or changed by this implementation.
