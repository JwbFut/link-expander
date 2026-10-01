#!/usr/bin/env node
/**
 * Local dev server that behaves like GitHub Pages does for this site:
 * static files are served as-is, and every unknown path falls back to
 * index.html (Pages serves 404.html, which the deploy workflow copies from
 * index.html). Without that fallback you cannot test generated long links
 * locally.
 *
 *   npm start            # http://localhost:8080
 *   node tools/dev-server.mjs 9000
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

async function readIfFile(path) {
  const info = await stat(path);
  if (info.isDirectory()) return readIfFile(join(path, 'index.html'));
  return { body: await readFile(path), path };
}

const server = createServer(async (request, response) => {
  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch { /* keep '/' */ }

  const target = resolve(ROOT, '.' + pathname);
  const insideRoot = target === ROOT || target.startsWith(ROOT + sep);

  try {
    if (!insideRoot) throw new Error('outside root');
    const file = await readIfFile(target);
    response.writeHead(200, { 'content-type': TYPES[extname(file.path)] || 'application/octet-stream' });
    response.end(file.body);
  } catch {
    // Unknown path: same as GitHub Pages serving 404.html.
    const body = await readFile(join(ROOT, 'index.html'));
    response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    response.end(body);
  }
});

server.listen(PORT, () => {
  console.log(`Link Expander dev server running on http://localhost:${PORT}/`);
});
