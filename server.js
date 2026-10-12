const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5176;
const ROOT = __dirname;

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
        'Content-Type': type,
        'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(filePath).pipe(res);
  });
}).listen(PORT, () => {
  console.log(`Decor Website running at http://localhost:${PORT}`);
});
