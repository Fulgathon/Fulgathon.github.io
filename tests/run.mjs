// Unit tests without extra dependencies: bundle tests/*.test.ts with the
// esbuild that Astro already installs, then run them with node's own test runner.
//   npm test
import { build } from 'esbuild';
import { readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = fileURLToPath(new URL('../node_modules/.cache/icemaraton-tests/', import.meta.url));
const files = readdirSync(here).filter((f) => f.endsWith('.test.ts'));
rmSync(out, { recursive: true, force: true });
await build({
  entryPoints: files.map((f) => here + f), outdir: out, bundle: true, platform: 'node', format: 'esm',
  outExtension: { '.js': '.mjs' }, logLevel: 'warning', external: ['node:*'],
});
const r = spawnSync(process.execPath, ['--test', ...files.map((f) => out + f.replace(/\.ts$/, '.mjs'))], { stdio: 'inherit' });
process.exit(r.status ?? 1);
