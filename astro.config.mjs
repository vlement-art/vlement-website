import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

// EDIT ME: if you deploy to a GitHub Pages *project* page (e.g. username.github.io/repo-name)
// instead of a custom domain, set `base` to '/repo-name' below and update `site` accordingly.
// If you use a custom domain (recommended, see CNAME file), leave base as '/'.
export default defineConfig({
  site: 'https://vlement.com', // EDIT ME: your production domain
  base: '/',
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [
    tailwind({ applyBaseStyles: false }),
    sitemap(),
  ],
  image: {
    // Astro's built-in image service is not used for artwork images in this project;
    // artwork images are pre-optimized and served as static files (see README > Images).
  },
});
