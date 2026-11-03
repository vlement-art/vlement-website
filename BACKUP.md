# Encrypted backup and recovery

The **Back up everything** action in `/admin` dispatches the GitHub Actions
workflow in `.github/workflows/backup.yml`. The workflow also runs monthly on
the first day at 03:00 UTC. It creates a full-history Git bundle, exports the
configured production D1 database, copies the configured production R2 bucket
when credentials are supplied, verifies the archive contents, and encrypts the
archive and its SHA-256 checksum with GPG/AES-256 before uploading them.

This repository is public. GitHub Actions artifacts can be downloaded by
anyone signed in to GitHub, so the workflow uploads encrypted files only. It
never uploads a plaintext SQL dump, R2 object, Git bundle, or archive. The
backup workflow reads production services only; it does not restore, migrate,
write, or delete production data.

## Required GitHub Actions secrets

Add these under **Repository → Settings → Secrets and variables → Actions →
New repository secret**. Secrets are not committed to the repository.

| Secret | How to create it | Minimum scope |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | In Cloudflare, create a custom API token for the account containing the production D1 database. | Account-scoped **D1 Read** only; do not grant D1 Edit, Workers, or other write permissions. |
| `CLOUDFLARE_ACCOUNT_ID` | Copy the account ID from the Cloudflare dashboard for the account containing production D1. | Identifier only; store it as a GitHub Actions secret as requested by this workflow. |
| `R2_ACCESS_KEY_ID` | Create an R2 S3 API token in Cloudflare. | Object **read-only**, scoped to the production bucket only. |
| `R2_SECRET_ACCESS_KEY` | Copy the secret access key shown once when creating that R2 token. | Same read-only bucket scope as `R2_ACCESS_KEY_ID`. |
| `R2_ENDPOINT` | Use the account's Cloudflare R2 S3 endpoint, `https://<account-id>.r2.cloudflarestorage.com`. | Endpoint only; no permission is conveyed by this value. |
| `R2_BUCKET` | Use the production R2 bucket name from `workers/certificates/wrangler.jsonc`. | Name only; the workflow checks that R2 credentials and a production R2 binding are present before copying. |
| `BACKUP_PASSPHRASE` | Generate a unique, high-entropy passphrase (at least 32 random characters) and keep the recovery copy in a password manager. | Anyone with this secret and an artifact can decrypt private certificate records and files. Restrict access to repository Actions secrets. |

D1 export is skipped with a log message if no production D1 binding or either
Cloudflare secret is configured. R2 copy is skipped if no production R2 bucket
or any required `R2_*` secret is configured. The passphrase is mandatory: the
workflow fails before collecting data if it is missing, and never uploads an
unencrypted backup.

The workflow uses a read-only Cloudflare API token and R2 credentials. It does
not run a remote SQL command, alter a bucket, or change production data.

## Download, decrypt, and verify

Download both encrypted files from the workflow run's **Artifacts** section.
Keep them private while downloading; the decrypted archive contains private
certificate/COA records, verification tokens, source images, and repository
history.

Install GnuPG, then decrypt using the `BACKUP_PASSPHRASE` from the password
manager. GPG prompts for the passphrase; do not put it in a shell command or
save it in the repository:

```sh
gpg --output vlement-backup-YYYY-MM-DD.zip \
  --decrypt vlement-backup-YYYY-MM-DD.zip.gpg
gpg --output vlement-backup-YYYY-MM-DD.zip.sha256 \
  --decrypt vlement-backup-YYYY-MM-DD.zip.sha256.gpg
sha256sum --check vlement-backup-YYYY-MM-DD.zip.sha256
unzip -t vlement-backup-YYYY-MM-DD.zip
unzip vlement-backup-YYYY-MM-DD.zip -d vlement-backup-YYYY-MM-DD
```

Replace `YYYY-MM-DD` with the date in the artifact names. The manifest includes
SHA-256 and size for every payload file except itself, the Git commit, R2 file
count, and D1 table row counts. The external encrypted checksum verifies the
complete ZIP before extraction.

## Safe restore procedure

Never restore into the live production D1 database or bucket as a first step.
Use a new, empty D1 database and a new R2 bucket, verify both, and only then
plan a separately reviewed cutover. Use restore-only credentials with write
access to those new resources; do not add write credentials to the backup
workflow.

1. Decrypt and checksum-test the archive using the commands above. Extract it
   into a restricted-access directory. Protect or securely remove plaintext
   SQL, bundle, images, and certificate records after recovery.
2. Restore the Git history into a new local directory:

   ```sh
   git clone vlement-backup-YYYY-MM-DD/repo.bundle restored-repository
   cd restored-repository
   git bundle verify ../vlement-backup-YYYY-MM-DD/repo.bundle
   git log --oneline -5
   python3 scripts/create-backup-manifest.py \
     --verify ../vlement-backup-YYYY-MM-DD
   ```

   The manifest check verifies every payload file's size and SHA-256, the
   archive file count, and the D1 and R2 counts.
3. If `d1.sql` is present, create a **new** D1 database in Cloudflare. Apply the
   SQL only to that new database, using a separate restore credential with
   permission to edit that new database:

   ```sh
   npx wrangler d1 create vlement-certificates-restore-test
   npx wrangler d1 execute vlement-certificates-restore-test \
     --remote --file ../vlement-backup-YYYY-MM-DD/d1.sql --yes
   ```

   Configure the new database binding locally or pass its new database ID in a
   temporary Wrangler configuration outside the repository. Never substitute
   the production database name. Verify the restored table names and row counts
   against `manifest.json` with read-only queries before considering a
   separately planned cutover. The backup workflow also performs an isolated
   SQLite import test of `d1.sql` and compares its table row counts with the
   generated manifest before encrypting the archive.
4. If `r2-files/` is present, create a **new** empty bucket. Configure a
   separate local rclone remote using a token with write access only to that
   new bucket, then copy the files:

   ```sh
   rclone copy ../vlement-backup-YYYY-MM-DD/r2-files restore:new-bucket \
     --dry-run
   rclone copy ../vlement-backup-YYYY-MM-DD/r2-files restore:new-bucket
   ```

   Compare the destination object count and each object's size and SHA-256 with
   `manifest.json`. Do not point the destination at the production bucket.
5. Test the restored site, D1 data, and R2 objects in an isolated staging
   environment. Preserve the original production resources untouched until
   the verification is complete and a rollback plan is approved.

**Rollback:** if a recovery test or later cutover fails, stop using the new
resources, route traffic back to the unchanged production resources, and
investigate the staging restore. Do not overwrite or delete the original
production database, objects, or certificate records as part of rollback.

GitHub repository history does not contain Cloudflare Worker secrets or DNS
provider settings. Keep Worker secrets and DNS records in a password manager;
they are not included in this backup. Regularly copy a verified encrypted
backup to storage outside both GitHub and Cloudflare.
