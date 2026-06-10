// Tiny static file server for the demo. No deps. Run via `npm run demo:serve`.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve, normalize } from 'node:path';

const ROOT = resolve('demo');
const PORT = Number(process.env.PORT) || 5173;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

createServer(async (req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  const target = normalize(join(ROOT, urlPath));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  try {
    const s = await stat(target);
    if (!s.isFile()) throw new Error('not a file');
  } catch {
    res.writeHead(404); res.end('not found'); return;
  }
  res.setHeader('Content-Type', TYPES[extname(target)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  createReadStream(target).pipe(res);
}).listen(PORT, () => {
  console.log(`demo: http://localhost:${PORT}/`);
});
