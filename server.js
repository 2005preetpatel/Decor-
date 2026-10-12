const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5176;
const ROOT = __dirname;

// Local secrets live in .env (never committed). On Vercel the same names are
// set in the dashboard instead, so this only fills in what is not already set.
try {
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) return;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  });
} catch (e) { /* no .env: fine */ }

// The same response headers Vercel will send (vercel.json), so what is tested
// here is what is deployed — the admin page's Content-Security-Policy included.
// DEV_CSP_CONNECT lets a local test add one extra allowed origin to connect-src
// (for a fake backend); it is not used in production.
let HEADER_RULES = [];
try { HEADER_RULES = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).headers || []; } catch (e) { /* none */ }
function configuredHeaders(urlPath) {
  const out = {};
  HEADER_RULES.forEach((r) => {
    const src = r.source;
    const hit = src === '/(.*)' || src === urlPath
      || (src.endsWith('/(.*)') && urlPath.startsWith(src.slice(0, -4)));
    if (hit) r.headers.forEach((h) => { out[h.key] = h.value; });
  });
  if (process.env.DEV_CSP_CONNECT && out['Content-Security-Policy']) {
    out['Content-Security-Policy'] = out['Content-Security-Policy']
      .replace("connect-src 'self'", "connect-src 'self' " + process.env.DEV_CSP_CONNECT);
  }
  return out;
}

// Stand-in for Vercel's /api routing, so the same functions run locally:
// /api/<name> loads api/<name>.js and calls it like Vercel would.
function runApi(req, res, name) {
  if (!/^[a-z0-9-]+$/.test(name)) { res.writeHead(404); return res.end(); }
  let handler;
  try { handler = require(path.join(ROOT, 'api', name + '.js')); }
  catch (e) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":"No such endpoint."}'); }

  const chunks = [];
  let size = 0;
  req.on('data', (c) => { size += c.length; if (size < 1e6) chunks.push(c); });
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    if (/application\/json/i.test(req.headers['content-type'] || '')) {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (e) { req.body = undefined; }
    } else {
      req.body = raw;
    }
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
    Promise.resolve(handler(req, res)).catch(() => { if (!res.writableEnded) { res.statusCode = 500; res.end(); } });
  });
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  // Audio, for the hero ambience. Without these the browser is handed
  // application/octet-stream and refuses to decode the track.
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  // Video, for the films section. Without a video type the browser sniffs
  // octet-stream and refuses to play it.
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.csv': 'text/csv; charset=utf-8',
};

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  if (urlPath.startsWith('/api/')) return runApi(req, res, urlPath.slice(5));
  // Server-side and tooling files are not pages. Vercel never serves them
  // either (see .vercelignore); keep local behaviour the same.
  if (/^\/(\.env[^/]*|supabase|tools|tests|docs|bulk|api|node_modules|\.git)(\/|$)/.test(urlPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }

  // path.join collapses "..", so a request for /../../.ssh/id_rsa resolved
  // to a real file outside ROOT and this server would have handed it over.
  // Resolve first, then refuse anything that does not still sit under ROOT.
  const filePath = path.resolve(ROOT, '.' + urlPath);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const type = MIME[ext] || 'application/octet-stream';
    const size = stat.size;

    // Video needs byte ranges: without a 206 reply the browser cannot seek,
    // and Safari/iOS will not play the file at all. Streaming also means a
    // 20 MB film is not read into memory per request.
    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range) {
      let start = range[1] === '' ? size - parseInt(range[2], 10) : parseInt(range[1], 10);
      let end = range[1] === '' || range[2] === '' ? size - 1 : parseInt(range[2], 10);
      if (isNaN(start) || isNaN(end) || start > end || start < 0 || end >= size) {
        res.writeHead(416, { 'Content-Range': 'bytes */' + size });
        res.end();
        return;
      }
      res.writeHead(206, {
        ...configuredHeaders(urlPath),
        'Content-Type': type,
        'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, { ...configuredHeaders(urlPath), 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(filePath).pipe(res);
  });
}).listen(PORT, () => {
  console.log(`Decor Website running at http://localhost:${PORT}`);
});
