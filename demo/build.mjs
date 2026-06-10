// Bundles demo/demo.ts (+ its src/ imports + culori + suncalc) into a single
// browser-ready ESM file. esbuild resolves `.js` import specifiers back to
// `.ts` source, handles culori's .mjs format, and tree-shakes the rest.
//
// Two modes:
//   default      → demo/demo.js + sourcemap, unminified (dev: serve from demo/)
//   --prod       → dist/demo.js minified, no sourcemap, with index.html,
//                  theme.css, demo.css, favicon.svg, og-image.* copied in.
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const watch = process.argv.includes('--watch');
const minify = process.argv.includes('--minify') || process.argv.includes('--prod');
const prod = process.argv.includes('--prod');

const outDir = prod ? 'dist' : 'demo';

const opts = {
  entryPoints: ['demo/demo.ts'],
  outfile: join(outDir, 'demo.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: prod ? false : true,
  minify,
  logLevel: 'info',
};

if (prod) {
  await rm('dist', { recursive: true, force: true });
  await mkdir('dist', { recursive: true });
}

if (watch) {
  const { context } = await import('esbuild');
  const ctx = await context(opts);
  await ctx.watch();
  console.log('demo: watching for changes...');
} else {
  await build(opts);
}

if (prod) {
  const staticAssets = [
    ['demo/index.html', 'dist/index.html'],
    ['demo/theme.css',  'dist/theme.css'],
    ['demo/demo.css',   'dist/demo.css'],
    ['demo/favicon.svg', 'dist/favicon.svg'],
  ];
  for (const [src, dst] of staticAssets) {
    if (existsSync(src)) await copyFile(src, dst);
  }
  // OG image: PNG preferred, SVG fallback. Ship whichever is present.
  for (const name of ['og-image.png', 'og-image.svg', 'favicon.png']) {
    const src = `demo/${name}`;
    if (existsSync(src)) await copyFile(src, `dist/${name}`);
  }
  // Sanity check: every asset referenced by index.html must exist in dist/.
  const html = await readFile('dist/index.html', 'utf8');
  const required = ['theme.css', 'demo.css', 'demo.js', 'favicon.svg'];
  const missing = required.filter((f) => html.includes(f) && !existsSync(`dist/${f}`));
  if (missing.length) {
    throw new Error(`prod build missing assets in dist/: ${missing.join(', ')}`);
  }
  console.log('demo: prod build complete → dist/');
}
