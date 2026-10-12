/* Tests for the serverless functions, against fake Supabase and Cloudinary
   servers running on localhost. Run:  node --test tests/

   They check the rules that matter for security:
     - no token / bad token / non-admin token never gets a signature
     - an admin gets a signature that matches Cloudinary's own algorithm
     - only the allowed folders, formats and public ids go through
     - the API secret is never in any response */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

const SECRET = 'test-secret-do-not-use';
let supa, cloud, destroyed = [], categoryReads = 0;

function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(srv));
  });
}
function readBody(req) {
  return new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
}

test.before(async () => {
  // Fake Supabase: only the is_admin() call.
  supa = await listen((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/rest/v1/categories') && req.headers.apikey === 'anon-key') {
      categoryReads++; res.setHeader('Content-Type', 'application/json'); return res.end('[{"id":"1"}]');
    }
    if (req.url === '/rest/v1/rpc/is_admin' && req.method === 'POST'
        && req.headers.apikey === 'anon-key') {
      const t = (req.headers.authorization || '').replace('Bearer ', '');
      if (t === 'admin-token') { res.setHeader('Content-Type', 'application/json'); return res.end('true'); }
      if (t === 'user-token' || t === 'anon-key') { res.setHeader('Content-Type', 'application/json'); return res.end('false'); }
      res.statusCode = 401; return res.end('{"message":"JWT expired"}');
    }
    res.statusCode = 404; res.end();
  });

  // Fake Cloudinary: the destroy call, checking the signature like the real one.
  cloud = await listen(async (req, res) => {
    const m = /^\/v1_1\/democloud\/(image|video)\/destroy$/.exec(req.url);
    if (!m || req.method !== 'POST') { res.statusCode = 404; return res.end(); }
    const p = Object.fromEntries(new URLSearchParams(await readBody(req)));
    const { signature, api_key, ...signed } = p;
    const expect = crypto.createHash('sha1').update(
      Object.keys(signed).sort().map((k) => k + '=' + signed[k]).join('&') + SECRET).digest('hex');
    res.setHeader('Content-Type', 'application/json');
    if (api_key !== 'key123' || signature !== expect) { res.statusCode = 401; return res.end('{"error":{"message":"bad signature"}}'); }
    destroyed.push(m[1] + ':' + p.public_id);
    res.end(JSON.stringify({ result: p.public_id.endsWith('missing') ? 'not found' : 'ok' }));
  });

  process.env.SUPABASE_URL = 'http://127.0.0.1:' + supa.address().port;
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.CLOUDINARY_CLOUD_NAME = 'democloud';
  process.env.CLOUDINARY_API_KEY = 'key123';
  process.env.CLOUDINARY_API_SECRET = SECRET;
  process.env.CLOUDINARY_API_BASE = 'http://127.0.0.1:' + cloud.address().port;
});
test.after(() => { supa.close(); cloud.close(); });

function call(handler, { method = 'POST', token, body, contentType = 'application/json' } = {}) {
  return new Promise((resolve) => {
    const headers = { 'content-type': contentType };
    if (token) headers.authorization = 'Bearer ' + token;
    const res = {
      headers: {}, statusCode: 200,
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, body: o, headers: this.headers }); },
    };
    handler({ method, headers, body }, res);
  });
}

const sign = require('../api/sign-upload');
const del = require('../api/delete-asset');

test('signature algorithm matches the worked example in Cloudinary\'s docs', () => {
  const { sign: signParams } = require('../api/_lib');
  assert.equal(
    signParams({ eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop', public_id: 'sample_image', timestamp: 1315060510 }, 'abcd'),
    'bfd09f95f331f558cbd1320e67aa8d488770583e');
});

test('sign-upload: no token -> 401, nothing signed', async () => {
  const r = await call(sign, { body: { resource_type: 'image', folder: 'a' } });
  assert.equal(r.status, 401);
  assert.equal(r.body.signature, undefined);
});

test('sign-upload: expired/garbage token -> 401', async () => {
  const r = await call(sign, { token: 'garbage', body: { resource_type: 'image', folder: 'a' } });
  assert.equal(r.status, 401);
});

test('sign-upload: signed-in but not an admin -> 403', async () => {
  const r = await call(sign, { token: 'user-token', body: { resource_type: 'image', folder: 'a' } });
  assert.equal(r.status, 403);
  assert.equal(r.body.signature, undefined);
});

test('sign-upload: the public anon key is not an admin either', async () => {
  const r = await call(sign, { token: 'anon-key', body: { resource_type: 'image', folder: 'a' } });
  assert.equal(r.status, 403);
});

test('sign-upload: admin gets a signature matching Cloudinary\'s algorithm', async () => {
  const r = await call(sign, { token: 'admin-token', body: { resource_type: 'video', folder: 'aanya-dev' } });
  assert.equal(r.status, 200);
  const b = r.body;
  assert.equal(b.folder, 'opula/aanya-dev');
  assert.equal(b.cloud_name, 'democloud');
  assert.equal(b.api_key, 'key123');
  assert.match(b.upload_url, /\/v1_1\/democloud\/video\/upload$/);
  assert.match(b.allowed_formats, /mp4/);
  assert.doesNotMatch(b.allowed_formats, /jpg/);
  const expect = crypto.createHash('sha1').update(
    `allowed_formats=${b.allowed_formats}&folder=${b.folder}&timestamp=${b.timestamp}` + SECRET).digest('hex');
  assert.equal(b.signature, expect);
  // The secret itself must never appear anywhere in a response.
  assert.ok(!JSON.stringify(r).includes(SECRET));
});

test('sign-upload: bad folder / type are rejected', async () => {
  for (const folder of ['../etc', 'A B', '', 'x/y', 'a'.repeat(81)]) {
    const r = await call(sign, { token: 'admin-token', body: { resource_type: 'image', folder } });
    assert.equal(r.status, 400, 'folder ' + JSON.stringify(folder));
  }
  const r = await call(sign, { token: 'admin-token', body: { resource_type: 'raw', folder: 'ok' } });
  assert.equal(r.status, 400);
});

test('only POST with JSON is accepted', async () => {
  assert.equal((await call(sign, { method: 'GET', token: 'admin-token', body: {} })).status, 405);
  assert.equal((await call(sign, { token: 'admin-token', contentType: 'text/plain', body: '{}' })).status, 415);
});

test('delete-asset: needs an admin', async () => {
  const body = { items: [{ public_id: 'opula/x/a', resource_type: 'image' }] };
  assert.equal((await call(del, { body })).status, 401);
  assert.equal((await call(del, { token: 'user-token', body })).status, 403);
  assert.deepEqual(destroyed, []);
});

test('delete-asset: removes files inside opula/, with a valid signature', async () => {
  destroyed = [];
  const r = await call(del, {
    token: 'admin-token',
    body: { items: [
      { public_id: 'opula/aanya-dev/one', resource_type: 'image' },
      { public_id: 'opula/aanya-dev/clip', resource_type: 'video' },
      { public_id: 'opula/aanya-dev/missing', resource_type: 'image' },
    ] },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.failed, 0);
  assert.deepEqual(destroyed.sort(), ['image:opula/aanya-dev/missing', 'image:opula/aanya-dev/one', 'video:opula/aanya-dev/clip']);
  assert.equal(r.body.results.find((x) => x.public_id.endsWith('missing')).result, 'not found');
});

test('delete-asset: refuses anything outside opula/ or with path tricks', async () => {
  destroyed = [];
  for (const id of ['samples/cat', 'opula/../samples/cat', 'opula/', '/opula/a', 'opula/a b', 'opula/' + 'x'.repeat(200)]) {
    const r = await call(del, { token: 'admin-token', body: { items: [{ public_id: id, resource_type: 'image' }] } });
    assert.equal(r.status, 400, id);
  }
  assert.deepEqual(destroyed, []);
});

test('delete-asset: a failed Cloudinary call is reported, not hidden', async () => {
  const saved = process.env.CLOUDINARY_API_SECRET;
  process.env.CLOUDINARY_API_SECRET = 'wrong-secret';           // fake Cloudinary will reject the signature
  const r = await call(del, { token: 'admin-token', body: { items: [{ public_id: 'opula/x/a', resource_type: 'image' }] } });
  process.env.CLOUDINARY_API_SECRET = saved;
  assert.equal(r.status, 200);
  assert.equal(r.body.failed, 1);
});

test('missing configuration is a clean 500, not a crash or a leak', async () => {
  const saved = process.env.CLOUDINARY_API_SECRET;
  delete process.env.CLOUDINARY_API_SECRET;
  const r = await call(sign, { token: 'admin-token', body: { resource_type: 'image', folder: 'a' } });
  process.env.CLOUDINARY_API_SECRET = saved;
  assert.equal(r.status, 500);
  assert.match(r.body.error, /not configured/);
});

/* ---- keep-alive (stops a free Supabase project being paused) --------------- */
const keep = require('../api/keepalive');

test('keepalive: reads one row from the database and says ok', async () => {
  delete process.env.CRON_SECRET;
  const r = await call(keep, { method: 'GET', contentType: 'text/plain' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.ok(categoryReads >= 1, 'it should really have queried Supabase');
});

test('keepalive: reports a failure when the database cannot be reached', async () => {
  const saved = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = 'http://127.0.0.1:1';           // nothing listens here
  const r = await call(keep, { method: 'GET', contentType: 'text/plain' });
  process.env.SUPABASE_URL = saved;
  assert.equal(r.status, 502);
});

test('keepalive: with CRON_SECRET set, strangers are refused and Vercel\'s call is accepted', async () => {
  process.env.CRON_SECRET = 'cron-secret-xyz';
  const before = categoryReads;
  const denied = await call(keep, { method: 'GET', contentType: 'text/plain' });
  const wrong = await call(keep, { method: 'GET', token: 'nope', contentType: 'text/plain' });
  const ok = await call(keep, { method: 'GET', token: 'cron-secret-xyz', contentType: 'text/plain' });
  delete process.env.CRON_SECRET;
  assert.equal(denied.status, 401); assert.equal(wrong.status, 401);
  assert.equal(ok.status, 200);
  assert.equal(categoryReads - before, 1, 'only the authorised call may reach the database');
});

test('keepalive: only GET, and it never echoes the keys', async () => {
  const r = await call(keep, { method: 'POST', token: undefined, contentType: 'application/json', body: {} });
  assert.equal(r.status, 405);
  const g = await call(keep, { method: 'GET', contentType: 'text/plain' });
  assert.ok(!JSON.stringify(g).includes('anon-key'));
});
