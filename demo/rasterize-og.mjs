// One-off: rasterize demo/og-image.svg → demo/og-image.png (1200×630) and
// demo/favicon.svg → demo/favicon.png (180×180, fallback for old browsers).
// Run via `node demo/rasterize-og.mjs` after editing either SVG.
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

async function render(svgPath, pngPath, width, height) {
  const svg = await readFile(svgPath);
  const png = await sharp(svg, { density: 384 })
    .resize(width, height, { fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(pngPath, png);
  console.log(`rasterize: ${svgPath} → ${pngPath} (${width}×${height})`);
}

await render('demo/og-image.svg', 'demo/og-image.png', 1200, 630);
await render('demo/favicon.svg', 'demo/favicon.png', 180, 180);
