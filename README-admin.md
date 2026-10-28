# Artwork admin

The static `/admin` panel uses the existing GitHub OAuth flow and saves artwork
records, categories, collections, and homepage settings to this repository.
GitHub Actions rebuilds the public Astro site from those records. No separate
artwork database is used.

The editor supports artwork dimensions and certificate metadata. Its
**Certificates** view can issue and reissue certificates, manage NFC tag
references, revoke certificates or tags, and download a ZIP backup containing
certificate records and the private R2 files. The certificate interface is
available only after the Cloudflare Worker has been configured; see
[`workers/certificates/README.md`](workers/certificates/README.md).

Use **Export Excel (.xlsx)** for artwork records. The workbook includes artwork
metadata and paths, with thumbnails embedded where browser access allows.
Back up the artwork image files separately from the repository paths listed in
the workbook.

## Local development

Requires Node.js 22 or later.

```powershell
npm install
npm run dev
```

For certificate-service development, configure local D1/R2 and the Worker as
described in the certificate README. Do not copy production credentials into
the repository; `.dev.vars` is ignored by Git.
