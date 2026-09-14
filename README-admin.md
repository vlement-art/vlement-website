# Setting up your admin panel (Sveltia CMS)

This adds a login-protected page at `yoursite.com/admin` where you can add,
edit, and publish artworks yourself — no code editing needed. Publishing
commits straight to this GitHub repo, which your existing GitHub Actions
workflow then automatically builds and deploys.

Two new files were added:

- `public/admin/index.html` — loads the admin panel
- `public/admin/config.yml` — tells it what fields an "artwork" has (matches
  your `src/content/config.ts` schema exactly)

Because GitHub Pages can't run server code, logging in needs one small
free helper (an "OAuth proxy") hosted elsewhere. Cloudflare Workers has a
generous free tier and this takes about 10 minutes, one time only.

## 1. Create a GitHub OAuth App

1. Go to **github.com/settings/developers** → **OAuth Apps** → **New OAuth App**
2. Fill in:
   - **Application name**: anything, e.g. "Vlement Admin"
   - **Homepage URL**: `https://vlement.com` (your site)
   - **Authorization callback URL**: `https://<your-worker-name>.<your-subdomain>.workers.dev/callback`
     (you'll get the exact worker URL in step 2 — you can come back and edit this after)
3. Click **Register application**, then **Generate a new client secret**.
   Copy the **Client ID** and **Client Secret** — you'll need both next.

## 2. Deploy the free OAuth proxy (Cloudflare Worker)

1. Sign up / log in at **dash.cloudflare.com** (free tier is enough)
2. Go to **Workers & Pages** → **Create** → **Create Worker**
3. Use the community script **sveltia-cms-auth** — the source and deploy
   instructions are at: https://github.com/sveltia/sveltia-cms-auth
   (Cloudflare's dashboard lets you paste the code in directly, or you can
   deploy via the `wrangler` CLI if you prefer.)
4. In the Worker's **Settings → Variables**, add:
   - `GITHUB_CLIENT_ID` = the Client ID from step 1
   - `GITHUB_CLIENT_SECRET` = the Client Secret from step 1 (mark as "secret")
5. Note the Worker's URL, e.g. `https://vlement-admin-auth.yourname.workers.dev`
6. Go back to your GitHub OAuth App (step 1) and set the callback URL to
   `https://vlement-admin-auth.yourname.workers.dev/callback`

## 3. Point the CMS config at your repo and proxy

Edit `public/admin/config.yml`:

```yaml
backend:
  name: github
  repo: your-username/your-repo     # <- change this
  branch: main
  base_url: https://vlement-admin-auth.yourname.workers.dev   # <- your Worker URL
```

## 4. Push and use it

1. Commit and push these files (`public/admin/index.html`, `public/admin/config.yml`)
   to `main`. GitHub Pages will deploy them like any other page.
2. Visit `https://vlement.com/admin`, click **Login with GitHub**, and
   authorize the app (only accounts with write access to the repo can log in
   — this is your personal admin gate, not public).
3. You'll see a list of all 8 artworks. Click one to edit, or **New Artwork**
   to add one — fill in the title, upload the image and thumbnail, write the
   description, and click **Publish**.
4. That commit triggers your existing `deploy.yml` workflow, and the change
   goes live in a minute or two — same as if you'd edited the markdown by
   hand and pushed it, just without touching code or Copilot at all.

## Notes

- The auto-generated slug (and filename) comes from the **Title** field, the
  same convention your existing files already use — so "Nunca dejes que la
  luz se apague" becomes `nunca-dejes-que-la-luz-se-apague.md`, matching its
  images automatically.
- You can delete `README-admin.md` once you're set up — it's just for you,
  not part of the site.
