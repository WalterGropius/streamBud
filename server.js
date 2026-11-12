// Local / self-hosted server: serves the app from public/ and the API at
// /api/convert. Run with `npm start` (no install needed, Node 20+).
//
// Optional settings (environment variables):
//   PORT                   default 3000
//   YOUTUBE_API_KEY        direct YouTube Music links instead of search links
//   SPOTIFY_CLIENT_ID      } direct Spotify links via Spotify's API
//   SPOTIFY_CLIENT_SECRET  } (needs a Spotify Premium developer account)

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleConvert } from './lib/http.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const PORT = Number(process.env.PORT) || 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// Small in-memory cache so repeat conversions are instant.
const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;

async function serveApi(url, res) {
  const key = url.searchParams.get('url') ?? '';
  const hit = cache.get(key);
  let out;
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    out = hit.out;
  } else {
    out = await handleConvert(url.searchParams, { env: process.env });
    if (out.status === 200) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(key, { at: Date.now(), out });
    }
  }
  res.writeHead(out.status, out.headers);
  res.end(JSON.stringify(out.body));
}

async function serveStatic(url, res) {
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/convert') await serveApi(url, res);
    else if (req.method === 'GET' || req.method === 'HEAD') await serveStatic(url, res);
    else res.writeHead(405).end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500).end('Server error');
  }
});

server.listen(PORT, () => {
  console.log(`streamBud running at http://localhost:${PORT}`);
  const extras = [
    process.env.YOUTUBE_API_KEY ? 'YouTube API: on' : 'YouTube API: off (search links for YouTube Music)',
    process.env.SPOTIFY_CLIENT_ID ? 'Spotify API: on' : 'Spotify API: off',
  ];
  console.log(extras.join(' · '));
});
