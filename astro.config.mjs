// @ts-check
import { defineConfig } from 'astro/config';

// Cloudflare: `npm run deploy` passes SITE_URL (canonical/OG links). The base
// is "/". Locally both fall back to the root.
export default defineConfig({
  site: process.env.SITE_URL || 'http://localhost:4321',
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'ignore',
  output: 'static',
  // Inline the CSS (≈14 KB gzipped): no extra round trips before the first paint.
  build: { inlineStylesheets: 'always' },
});
