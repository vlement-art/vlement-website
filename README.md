# Vlement J. Rodrigues — artwork portfolio

A static, no-database, no-secrets artwork portfolio site built with
[Astro](https://astro.build). Every page is pre-rendered to plain HTML at
build time; the only JavaScript that ships is small, optional, progressive
enhancement (theme toggle, gallery filtering, lightbox, mobile nav).

## Why Astro

Astro was chosen over Next.js because this site has **no interactivity that
needs a client-side framework** — it's text, images, and a handful of small
DOM-manipulation scripts. Astro's static output ships **zero framework
JavaScript by default**, which is the single biggest lever for the
Lighthouse/PageSpeed scores this brief asks for. Next.js's static export mode
could do this too, but it still bundles React's runtime unless you opt out
carefully, and its routing/config conventions add complexity this project
doesn't need.

## Project structure

```
artwork-site/
├── public/
│   ├── images/
│   │   ├── artwork/          full-size images shown on artwork pages
│   │   ├── thumbnails/       smaller images used on cards/grids
│   │   └── artist/           portrait + default social-share image
│   ├── documents/            put cv.pdf here if you use the CV link (not included)
│   ├── favicon.svg
│   ├── site.webmanifest
│   ├── robots.txt
│   ├── CNAME                 custom domain — see "Custom domain" below
│   └── _headers              security headers for Cloudflare Pages (see Security)
├── src/
│   ├── components/           Header, Footer, ThemeToggle, ArtworkCard, Lightbox
│   ├── content/
│   │   ├── config.ts          the artwork schema (see "Adding artwork")
│   │   └── artworks/*.md      one Markdown file per artwork — EDIT THESE
│   ├── data/site.ts           artist name, email, socials — EDIT THIS FIRST
│   ├── layouts/BaseLayout.astro
│   ├── pages/                 index, work/, about, contact, privacy, 404
│   └── styles/global.css
├── .github/workflows/deploy.yml   GitHub Pages CI/CD
├── astro.config.mjs
├── .env.example
├── SECURITY.md
└── README.md
```

## Run it locally

Requires Node.js 18.17+ (Node 20 recommended — matches the CI workflow).

```bash
npm install
npm run dev        # http://localhost:4321
```

Build and preview the production build:

```bash
npm run build       # outputs to ./dist
npm run preview     # serves ./dist locally, http://localhost:4321
```

## First things to edit

1. **`src/data/site.ts`** — artist name, email, Instagram handle, domain. Every
   page imports from here, so this is the one file that changes the whole
   site's contact details.
2. **`astro.config.mjs`** — the `site` value (your real domain).
3. **`public/CNAME`** — delete this file if you are *not* using a custom
   domain (i.e. deploying to the default `username.github.io` address).
4. Replace the placeholder images in `public/images/` with real photography
   (see "Images" below) — the build currently uses generated placeholder
   `.webp` files so the project builds and looks correct out of the box.
5. `public/documents/cv.pdf` doesn't exist yet — either add a real CV there,
   or remove the "Download CV" link in `src/pages/about.astro`.

## Adding a new artwork

Every artwork is one Markdown file in `src/content/artworks/`. To add one:

1. Copy an existing file, e.g. `src/content/artworks/sad-bunny.md`, to a new
   filename — **the filename becomes the URL**, so
   `src/content/artworks/blue-hour.md` → `/work/blue-hour`.
2. Edit the frontmatter fields (all required unless noted):

   | Field | Type | Notes |
   |---|---|---|
   | `title` | string | |
   | `year` | number | |
   | `medium` | string | e.g. "Oil on canvas" |
   | `dimensions` | string | e.g. "60 × 80 cm" |
   | `category` | string | used by the gallery category filter |
   | `collection` | string | used by the gallery collection filter |
   | `summary` | string | short description — used in meta tags & cards |
   | `image` | string | path under `/public`, e.g. `/images/artwork/blue-hour.webp` |
   | `thumbnail` | string | path under `/public`, e.g. `/images/thumbnails/blue-hour.webp` |
   | `altText` | string | describes the artwork for screen readers — be specific |
   | `featured` | boolean | shows on the home page (optional, default `false`) |
   | `available` | boolean | shows "Available"/"Sold" badge (optional, default `true`) |
   | `price` | string | optional — omit the field entirely to hide the price |
   | `displayOrder` | number | lower numbers appear first (optional, default `0`) |

3. Write the full description as the Markdown body, below the `---`.
4. Add the actual image files to `public/images/artwork/` and
   `public/images/thumbnails/`, matching the paths you set above.
5. If the schema in `src/content/config.ts` doesn't validate your file (e.g. a
   typo, wrong type), `npm run dev` / `npm run build` will fail with a clear
   error naming the exact field and file.

There is **no admin panel or database** — this is intentional, so the whole
site can be a plain static export with no attack surface beyond serving
files.

## Images

Recommended source dimensions and limits:

- **Full artwork image** (`image` field): longest edge **1600–2000px**,
  **under ~400KB** as WebP (quality ~80). This is shown on the artwork page
  and in the lightbox — it is *not* your original high-resolution file.
- **Thumbnail** (`thumbnail` field): **640×800px** (or matching your image's
  aspect ratio), **under ~80KB**. Used on cards and grids.
- **Portrait / about image**: ~800×1000px.
- **Open Graph default image** (`public/images/artist/og-default.webp`):
  1200×630px, used when a page doesn't set its own `ogImage`.

Format: **WebP** throughout (broadly supported, good compression at
reasonable quality). If you need AVIF for specific images, add it as a
`<source>` in an Astro `<picture>` wrapper — not set up by default here to
keep the build dependency-light, but straightforward to add per-image.

Loading behavior already implemented:

- The **first 1–3 cards** on the home page and gallery, and the **main image
  on each artwork page**, use `loading="eager"` (and `fetchpriority="high"`
  on the single largest one) — never lazy-loaded, so they don't delay LCP.
- Every other artwork image uses `loading="lazy" decoding="async"`.
- Every `<img>` has explicit `width`/`height` (or an `aspect-ratio` on its
  wrapper) so the browser reserves space before the image loads — this is
  what prevents layout shift (CLS).
- Every artwork image has a real, specific `altText` from the content file —
  there are no purely decorative images on artwork pages, so nothing is
  marked `alt=""` there.

**Never publish your true original/print-resolution files** to
`public/images/` — anything in `public/` is served to anyone who requests it.
Keep originals outside the repository (or in a `public/images/originals/`
folder, which `.gitignore` already excludes) and only export reduced-size
web copies into `public/images/artwork/`.

## Contact form (optional)

The default, most secure option is the **direct `mailto:` link** already on
the Contact page — no form, no third-party service, nothing to configure or
secure.

If you want a real `<form>` instead:

1. Sign up for a static-form service that accepts a public form ID and POSTs
   directly from the browser to their servers — e.g.
   [Formspree](https://formspree.io) or [Web3Forms](https://web3forms.com).
   Both are designed for exactly this (no backend needed) and neither
   requires a secret key on the frontend.
2. Set `PUBLIC_CONTACT_FORM_ENDPOINT` to the URL/ID they give you — locally
   in a `.env` file (never committed — see `.gitignore`), and in production
   as a GitHub Actions **repository variable** (`vars.PUBLIC_CONTACT_FORM_ENDPOINT`,
   already wired into `.github/workflows/deploy.yml`) or a Cloudflare Pages
   **environment variable**.
3. If you use Formspree or Web3Forms, keep their domain in the
   `form-action` directive in `public/_headers` (already included, commented
   — remove it if you don't use a form at all).

**Spam protection:** the form includes a hidden **honeypot field**
(`company`) that's invisible to real visitors but often caught by bots that
fill in every field. This is a deterrent, not a guarantee — pair it with
your form provider's own spam filtering (Formspree and Web3Forms both have
basic built-in filtering), and consider adding a
[Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) widget
for stronger protection if spam becomes a problem.

## Deploying to GitHub Pages

1. Push this repository to GitHub.
2. In the repo, go to **Settings → Pages** and set **Source** to
   **GitHub Actions** (the included workflow at
   `.github/workflows/deploy.yml` handles the rest — it runs on every push
   to `main`).
3. **Custom domain:** in **Settings → Pages → Custom domain**, enter your
   domain (e.g. `vlement.com`) and save — GitHub will verify
   `public/CNAME` matches. At your DNS provider, add:
   - An `A` record for the root domain pointing to GitHub's Pages IPs
     (currently `185.199.108.153`, `.109.153`, `.110.153`, `.111.153` — check
     [GitHub's current docs](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)
     for the up-to-date list), **or** a `CNAME`/`ALIAS` record if using a
     `www` subdomain.
   - Do **not** put any DNS credentials or tokens in this repo — DNS changes
     happen entirely in your registrar/DNS provider's own dashboard.
4. Tick **"Enforce HTTPS"** in the same Pages settings once GitHub shows the
   domain as verified (this can take a few minutes to a few hours after DNS
   propagates).
5. **No custom domain?** Delete `public/CNAME`, and set `base` in
   `astro.config.mjs` to `/your-repo-name` if the repo is not named
   `username.github.io` (project pages are served from a subpath).

### GitHub Pages limitations (read this)

GitHub Pages serves static files only — it has **no way to set custom HTTP
response headers**. That means:

- `public/_headers` (Content-Security-Policy, Referrer-Policy,
  X-Content-Type-Options, Permissions-Policy, X-Frame-Options) **is ignored**
  on GitHub Pages. These headers only take effect on Cloudflare Pages, or if
  you put a CDN like Cloudflare in front of GitHub Pages (see below).
- HTTPS itself is provided and enforced by GitHub once you tick the box in
  step 4 — that part works fine on GitHub Pages alone.
- If you need the security headers to actually apply while still using
  GitHub Pages for hosting, put **Cloudflare in front of it**: point your
  domain's DNS through Cloudflare, keep GitHub Pages as the origin, and add
  a **Cloudflare Transform Rule** (Rules → Transform Rules → Modify Response
  Header) that injects the same headers from `public/_headers`.

## Deploying to Cloudflare Pages

1. Push this repository to GitHub (or GitLab).
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect
   to Git**, select this repo.
3. Build settings:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Node version:** set environment variable `NODE_VERSION=20` if
     prompted.
4. Add any `PUBLIC_...` environment variables (e.g.
   `PUBLIC_CONTACT_FORM_ENDPOINT`) under **Settings → Environment variables**.
5. `public/_headers` is picked up automatically by Cloudflare Pages — no
   extra configuration needed for the security headers.
6. **Custom domain:** **Custom domains → Set up a custom domain**, follow the
   prompts (Cloudflare manages DNS + HTTPS automatically if your domain is
   already on Cloudflare).

## Deployment troubleshooting

- **Images 404 after deploying:** confirm the path in your content file
  frontmatter starts with `/images/...` (not `images/...` or a relative
  path) and that the file actually exists under `public/images/...` with
  matching case — hosts are case-sensitive even if your local filesystem
  isn't.
- **Site works locally but not on a GitHub Pages project subpath:** set
  `base` in `astro.config.mjs` to `/your-repo-name` and rebuild — every
  internal link in this project uses root-relative paths (`/work`,
  `/images/...`), which Astro rewrites correctly once `base` is set.
- **Old content still showing after deploy:** GitHub Pages and Cloudflare
  both cache aggressively; hard-refresh or check the Actions/Pages build log
  to confirm the latest commit actually built and deployed.
- **CSP blocks something in the browser console:** see SECURITY.md — almost
  always means a new inline `<script>` or `<style>` was added without
  updating `public/_headers`.

## Testing performance

```bash
npm run build && npm run preview
```

Then, with the preview server running:

- Run [Lighthouse](https://developer.chrome.com/docs/lighthouse/) from
  Chrome DevTools (Lighthouse tab) against the preview URL, in **both**
  mobile and desktop modes.
- Or use [PageSpeed Insights](https://pagespeed.web.dev) against your live
  deployed URL once published (it can't test `localhost`).
- To find oversized images: Lighthouse's "Properly size images" and
  "Serve images in next-gen formats" audits name the exact files; you can
  also check `public/images/` file sizes directly
  (`ls -lh public/images/artwork/`) against the limits in "Images" above.
- To find slow/blocking assets: DevTools **Network** tab, sort by size or
  time, with "Disable cache" on and throttling set to "Slow 4G".

## Pre-publish checklist

Things to replace before this goes live — search the codebase for
`EDIT ME` to find every marked spot:

- [ ] `src/data/site.ts` — real email, confirm Instagram handle/URL
- [ ] `astro.config.mjs` — confirm `site` matches your real domain
- [ ] `public/CNAME` — your domain, or delete the file if not using one
- [ ] Replace every placeholder image in `public/images/` with real files
- [ ] `src/pages/about.astro` — real biography, real CV link or remove it
- [ ] `src/content/artworks/*.md` — replace the 8 example artworks with your
      own (or edit them in place)
- [ ] Decide on the contact form (see "Contact form" above) or leave
      email-only
- [ ] Confirm `robots.txt` and `astro.config.mjs`'s `site` use the same
      domain, so the generated sitemap URL is correct
- [ ] Review SECURITY.md and re-check the CSP if you've added any new inline
      script or third-party embed

## Known limitations (honest list)

- **JavaScript-disabled behavior:** every page's content, navigation, and
  images work with JavaScript fully disabled. The **theme toggle**, **mobile
  menu button**, **gallery search/filter**, and **lightbox** require
  JavaScript — without it, the mobile menu links are simply not reachable
  behind the toggle (consider this if that matters for your audience; the
  desktop nav is always plain links), and the gallery shows its full,
  unfiltered grid (which is itself a completely valid way to browse it).
- **Contact form spam protection** is a honeypot only by default — real
  protection depends on which form service you choose (see above).
- **Image optimization is manual**, not automated at build time — this
  project doesn't run an image pipeline/CDN; you're expected to export
  correctly-sized WebP files yourself (see "Images"). This keeps the build
  simple and dependency-light, at the cost of automation.
- **No automated tests** are included (no unit/e2e test suite) — the
  "Quality control" pass for this project was done manually against the
  checklist in this README and SECURITY.md, not via CI-enforced tests.
