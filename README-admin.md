# Artwork admin

The static `/admin` panel uses the existing GitHub OAuth flow and saves artwork
records, categories, collections, and homepage settings to this repository.
GitHub Actions rebuilds the public Astro site from those records. No separate
artwork database is used.

Use the **Exhibitions** button in `/admin` to add, edit, or remove exhibitions
with their title, venue, dates, and optional details link. The homepage and
artist biography read the same exhibition records. Dates automatically group
each listing as coming up, on now, or past; changes to `/admin` are published
through the next site build.

In **Edit Artwork**, **Duplicate** opens an unsaved copy of the current form.
Choose its certificate artwork type before saving; the new artwork is available
for sale and receives its own code. The duplicate initially references the same
images. Each image field has a **Delete picture** button: clearing a new
selection restores its saved image, while removing a saved image requires
confirmation and takes effect only on Save. Full-size images and thumbnails
need replacements before saving; optional download images may be left empty.
Replacements use new storage paths so shared pictures remain unchanged.
JPEG photos with EXIF rotation are normalized on upload.

The editor supports artwork dimensions and certificate metadata. Its
**Certificates** view can issue and reissue certificates, manage NFC tag
references, revoke certificates or tags, and download a ZIP backup containing
certificate records and the private R2 files. The certificate interface is
available only after the Cloudflare Worker has been configured; see
[`workers/certificates/README.md`](workers/certificates/README.md).

Issuing or reissuing can optionally include an NFC tag UID and placement. The
UID is printed in small type on the PDF and registered to the certificate when
that PDF is finalized. Reissues prefill the latest active tag; reusing that
certificate's active UID keeps its existing tag record and placement, while a
UID already registered to another certificate or a revoked tag is rejected.
New issues and reissues open a PDF preview before finalization. Choose
**Approve and finalize** to make it valid, or **Back to edit** to revise the
pending details and generate another preview. Leaving the preview keeps the
pending version available to review later; an existing valid version stays
valid until the replacement is approved.

Use **Export Excel (.xlsx)** for artwork records. The workbook includes artwork
metadata and paths, with thumbnails embedded where browser access allows.
Back up the artwork image files separately from the repository paths listed in
the workbook.

Use **Back up everything** to start the encrypted repository, certificate D1,
and configured R2 backup workflow. The button requires the workflow on `main`
and the GitHub Actions secrets described in [`BACKUP.md`](BACKUP.md). Backup
artifacts are retained for 30 days; download and store a verified copy outside
GitHub and Cloudflare.

## Local development

Requires Node.js 22 or later.

```powershell
npm install
npm run dev
```

For certificate-service development, configure local D1/R2 and the Worker as
described in the certificate README. Do not copy production credentials into
the repository; `.dev.vars` is ignored by Git.
