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

The optional **SEO description** replaces the generated search and social
description for that artwork; leave it blank to generate one from its details.
Saving an artwork with the same full description as another shows a warning
after saving, but does not prevent the save or change either description.

The editor keeps dimensions as entered and previews the display conversion
for two centimetre measurements, in the order entered (for example,
`42 × 30 cm / 16.54 × 11.81 in`). Other dimension text is shown unchanged.
Existing issued PDFs remain unchanged; newly generated PDFs use the display
conversion. Its
**Certificates** view can issue and reissue certificates, manage NFC tag
references, revoke certificates or tags, and download a ZIP backup containing
certificate records and the private R2 files. The certificate interface is
available only after the Cloudflare Worker has been configured; see
[`workers/certificates/README.md`](workers/certificates/README.md).

For a saved artwork, **Print label** downloads an editable A5 Word document in
your browser. Auto orientation uses the picture's proportions; choose Landscape
or Portrait to override it. The label uses the saved artwork, not unsaved edits.
No certificate service or database is used. If the public artwork page is not
yet available, the editor warns that its QR link may not work. Printed QR codes
use the artwork's saved slug and stop working if that URL changes.
Label rendering tests (`npm run test:label`) require LibreOffice Writer,
Python's UNO bindings, Poppler tools and `zbarimg`.

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

The **Sales** section can print or email receipts and export all sales to Excel.
The spreadsheet is an export; D1 remains the source of truth. Receipts omit
internal notes by default. Receipt email requires the certificate Worker seller
and Resend settings documented in `workers/certificates/README.md`. The
encrypted backup includes a sales CSV generated from the same D1 snapshot when
the database export is configured.

## Local development

Requires Node.js 22 or later.

```powershell
npm install
npm run dev
```

For certificate-service development, configure local D1/R2 and the Worker as
described in the certificate README. Do not copy production credentials into
the repository; `.dev.vars` is ignored by Git.
