# Certificate service

The certificate service is a separate Cloudflare Worker. The Astro site and
artwork records remain on GitHub Pages and in Git; certificate records and
private uploaded image copies/PDFs use D1 and R2. The Worker does not modify the
existing admin OAuth Worker.

An issue is initially `pending`. The admin creates a PDF containing the
artwork image, certificate details, and a QR code. The Worker stores the PDF
privately, records its SHA-256 digest, and only then makes the certificate
valid. Public verification never exposes a pending or voided issue as valid.
Reissues preserve the previous valid version until the replacement PDF is
stored. SHA-256 confirms the bytes served match the stored issuance record; it
is an integrity check, not a cryptographic signature. Certificate numbers,
edition allocations, version history, and audit history are not reused or
deleted.

The ZIP backup contains a JSON snapshot of counters, certificates, versions,
NFC tags, and audit events, plus every object in the private certificate R2
bucket. Keep the downloaded archive private: it contains verification tokens and the
source image files captured at issue time. Artwork files in Git remain backed
up separately. Restoring a ZIP is intentionally not automated; restore into new
Cloudflare resources and verify the imported records and objects before
switching the public endpoint.

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
   Actions variable `PUBLIC_CERTIFICATES_API_URL`. It is public configuration,
   not a credential; never put tokens or secrets in this variable.
6. Only switch the public site to the production Worker after the staging
   checks and a private backup have been reviewed.

Production resources, migrations, secrets, and deployments have not been
created or changed by this implementation.
