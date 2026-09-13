# Security

This is a static site: no server, no database, no user accounts, no
server-side secrets. The overwhelming majority of typical web-app
vulnerability classes (SQL injection, server-side auth bypass, session
hijacking, leaked API keys) don't apply because there is no server-side code
to exploit. What follows covers what *does* apply.

## Reporting an issue

If you find a security issue with this site (not with Astro, GitHub Pages,
or Cloudflare Pages themselves — report those to the respective projects),
email **sales@vlement.com**. There is no bug bounty; this is a personal
portfolio site.

## No secrets in this repository

- There are no API keys, passwords, tokens, or credentials anywhere in this
  codebase.
- `.env.example` documents variable *names* only. `.gitignore` excludes real
  `.env` files from ever being committed.
- The only environment variable this project uses
  (`PUBLIC_CONTACT_FORM_ENDPOINT`) is, by design, meant to be public — it's a
  form-service ID, not a secret, and Astro's `PUBLIC_` prefix convention
  exists specifically to mark variables that are safe to ship to every
  visitor's browser. **Never** put a real secret in a `PUBLIC_`-prefixed
  variable.

## Content Security Policy

`public/_headers` sets a restrictive CSP:

```
default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none';
form-action 'self' https://formspree.io https://api.web3forms.com;
script-src 'self' 'sha256-rVWJc7RZYLx/ujrEcl5PMTdETrfdqK8kKu+qVA5lTuE=';
style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self';
require-trusted-types-for 'script'
```

Design decisions behind this policy:

- **`script-src 'self' 'sha256-...'`, no `'unsafe-inline'`, no `'unsafe-eval'`.**
  Every script in this project is bundled into an external file by Astro
  (which satisfies `'self'`) **except one**: the small theme-flash-prevention
  snippet inlined in `src/layouts/BaseLayout.astro`'s `<head>`. It has to run
  inline and synchronously, before first paint, to set the dark-mode
  attribute before anything renders — an external/deferred script would
  cause a visible flash of the wrong theme on every load. Rather than
  weaken the policy with `'unsafe-inline'`, that one script is allowed by
  its exact SHA-256 hash instead.

  **Regenerating the inline script hash:** if you ever edit that script, the
  hash in `public/_headers` will no longer match and the browser will
  silently block it (you'll see a CSP violation in the console, and a brief
  flash of the wrong theme, but the rest of the site keeps working — this
  fails closed, not open). To regenerate it:

  ```bash
  # 1. Build the site, then copy the exact text between <script> and
  #    </script> for the theme-flash snippet in dist/index.html into a file:
  node -e "
    const fs = require('fs');
    const html = fs.readFileSync('dist/index.html', 'utf8');
    const match = html.match(/<script>\s*\/\/ Runs before paint[\s\S]*?<\/script>/);
    if (!match) throw new Error('Could not find the theme script in dist/index.html');
    const inner = match[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
    fs.writeFileSync('/tmp/theme-script.js', inner);
  "
  # 2. Compute its hash:
  openssl dgst -sha256 -binary /tmp/theme-script.js | openssl base64
  # 3. Replace the sha256-... value in public/_headers with the output.
  ```

- **`style-src 'self' 'unsafe-inline'`.** Astro's scoped component
  `<style>` blocks and a few inline `style="aspect-ratio: ..."` attributes
  (used to reserve image space and prevent layout shift) require this. This
  is a deliberate, lower-risk trade-off: injected styles can deface a page
  but — unlike script injection — cannot execute arbitrary code, exfiltrate
  cookies/localStorage, or make authenticated requests on a visitor's
  behalf. Hashing every style block was judged not worth the added build
  complexity for a static portfolio site with no user-generated content
  anywhere for an attacker to inject through in the first place.
- **`object-src 'none'`, `base-uri 'none'`** close two classic
  CSP-bypass vectors (plugins, and `<base>` tag hijacking) with no
  functional cost — this site uses neither.
- **`frame-ancestors 'none'`** stops the entire site from being embedded in
  an iframe anywhere (clickjacking protection). This is set as a real HTTP
  header, which is the only place browsers honor it — see "What GitHub
  Pages cannot enforce" below. `X-Frame-Options: DENY` is also set alongside
  it for older browsers that predate `frame-ancestors`.
- **`form-action 'self' https://formspree.io https://api.web3forms.com`**
  restricts where any `<form>` on the site can submit to. If you don't use
  a third-party contact form, delete the two service URLs and leave
  `form-action 'self'`.
- **`require-trusted-types-for 'script'`** asks supporting browsers
  (Chromium-based) to block DOM-based XSS sinks like `innerHTML` unless
  passed through a Trusted Types policy. Nothing in this codebase uses
  `innerHTML`, `dangerouslySetInnerHTML`-equivalents, or `eval`, so this
  is enabled with no code changes needed.

## Other headers in `public/_headers`

- **`Referrer-Policy: strict-origin-when-cross-origin`** — sends full URLs
  only to your own origin; other sites just get your domain, not full paths.
- **`X-Content-Type-Options: nosniff`** — stops browsers from guessing
  ("sniffing") a file's type against its declared `Content-Type`, which
  closes off some MIME-confusion attacks.
- **`Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`**
  — explicitly disables browser features this site never uses, and opts out
  of Chrome's FLoC/Topics-style cohort tracking.
- **`X-Frame-Options: DENY`** — see `frame-ancestors` above.

## What GitHub Pages can and cannot enforce

GitHub Pages serves static files only and **has no mechanism to set custom
HTTP response headers**. Concretely:

| Protection | GitHub Pages | Cloudflare Pages |
|---|---|---|
| HTTPS enforcement | ✅ (built-in, toggle in repo settings) | ✅ (built-in) |
| `Content-Security-Policy` header | ❌ ignored | ✅ via `public/_headers` |
| `frame-ancestors` / clickjacking protection | ❌ (no header support; `<meta>` cannot set this directive — see below) | ✅ |
| `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy` | ❌ ignored | ✅ via `public/_headers` |

**Why not just use a `<meta http-equiv="Content-Security-Policy">` tag on
GitHub Pages instead?** A few CSP directives — `frame-ancestors`,
`report-uri`/`report-to`, and `sandbox` — are **specified by browsers to be
ignored when delivered via `<meta>`**; they only take effect as a real HTTP
response header. So a meta-tag CSP could carry most of this policy, but not
the clickjacking protection, and browsers will log a console warning for the
ignored directive. `public/_headers` is written for Cloudflare Pages (or any
proxy in front of GitHub Pages, such as Cloudflare's Transform Rules
pointed at a GitHub Pages origin) specifically so the full policy, including
`frame-ancestors`, actually applies somewhere.

If you deploy to GitHub Pages **without** a CDN in front of it, this site
still works correctly and HTTPS is still enforced — you are simply without
the extra defense-in-depth these headers provide, most notably clickjacking
protection.

## Input handling

- The only user-controlled input anywhere on this site is the optional
  contact form (see README "Contact form"), and it is submitted directly
  to a third-party form service — this project's own code never receives,
  stores, parses, or renders that input, so there is no injection surface
  here to sanitize.
- The gallery search/filter script only ever reads `.value` from inputs and
  compares it against text already present in the static HTML (via
  `.dataset` attributes rendered at build time) — it never writes user
  input into the DOM as HTML, so there is no XSS vector there either.

## Dependency surface

Dependencies are intentionally minimal: `astro`, `@astrojs/tailwind`,
`@astrojs/sitemap`, and `tailwindcss`. No UI framework runtime, no
analytics SDK, no third-party embed scripts. Run `npm audit` periodically
and keep these updated.
