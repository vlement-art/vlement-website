# Production deployment

The production Worker is configured in `workers/certificates/wrangler.jsonc`
under `env.production`. Its `DB` binding points to D1 database
`vlement-certificates-prod` (ID `ab69d88a-e350-4769-8e94-f925199260ab`).

## Receipt settings

Non-secret variables live in `env.production.vars` in the Wrangler config:
`SELLER_NAME`, `SELLER_WEBSITE`, `SELLER_EMAIL`, `SELLER_ADDRESS`,
`RECEIPT_FROM_ADDRESS`, and `RECEIPT_REPLY_TO`. Seller name, website, and
email are required to render a receipt; `SELLER_ADDRESS` is optional and an
empty value is omitted. Emailing also requires `RECEIPT_FROM_ADDRESS`, with a
sender on a domain verified by Resend. `RECEIPT_REPLY_TO` is optional and an
empty value is omitted. Update these values in the repository rather than
only in the Cloudflare dashboard, so the next deployment retains them.

`RESEND_API_KEY` is a Cloudflare Worker secret, not a Wrangler variable or a
GitHub Actions secret. Set or update it interactively without placing its value
in a repository file or shell history:

```sh
npx wrangler secret put RESEND_API_KEY --config workers/certificates/wrangler.jsonc --env production
```

The Worker also requires the production `ALLOWED_GITHUB_USER_ID` secret for
admin authorization. Set it in the same Worker environment using Wrangler or
the Cloudflare dashboard; do not put it in `vars`.

## GitHub Actions

`.github/workflows/deploy-production.yml` runs on pushes to `main`, subject to
the `production` GitHub environment's protection rules. It tests, applies D1
migrations, then deploys the Worker. It uses exactly these GitHub Actions
secrets (available to the production environment): `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`. It does not reference any GitHub Actions variables or
the `RESEND_API_KEY` Worker secret. The Cloudflare token must permit the
configured D1 migration and Worker deployment.

## Manual production deployment

After review and authorization, apply pending migrations and deploy:

```sh
npx wrangler d1 migrations apply vlement-certificates-prod --remote --config workers/certificates/wrangler.jsonc --env production
npx wrangler deploy --env production --config workers/certificates/wrangler.jsonc
```

Wrangler records applied migrations and skips them on later runs. Do not replay
migration SQL by hand: SQLite cannot safely repeat the receipt column additions.
