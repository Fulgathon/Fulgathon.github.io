// @ts-check
import { defineConfig } from 'astro/config';

// GitHub Pages: the deploy workflow passes SITE_URL and BASE_PATH from
// actions/configure-pages, so the repo name is never hard-coded here.
// Locally both fall back to the root.
// With a custom domain: add public/CNAME and Pages reports base "/" by itself.
export default defineConfig({
  site: process.env.SITE_URL || 'http://localhost:4321',
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'ignore',
  output: 'static',
  build: { inlineStylesheets: 'auto' },
});
