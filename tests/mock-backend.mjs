/* A small stand-in for Supabase (REST + Auth) and Cloudinary (upload), so the
   website and the admin dashboard can be exercised end to end with no
   accounts. It is deliberately simple: just enough PostgREST to run this
   project's own queries, and the same access rule as supabase/schema.sql
   (visitors see only published projects; only admins can write).

   Start it by hand:   node tests/mock-backend.mjs   (port 5190)
   or import { startMock } in a test. It is NOT a security reference: the real
   rules are the SQL ones, and those are checked in tests/rls.check.mjs. */

import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const uuid = () => crypto.randomUUID();

export function seed() {
  const cats = [
    ['mandap-stage', 'Mandap & Stage'], ['tablescapes', 'Tablescapes'], ['drapery-ceiling', 'Drapery & Ceiling'],
    ['floral-walls', 'Floral Walls'], ['candlelight', 'Candlelight'], ['stage-lighting', 'Stage Lighting'],
    ['balloon-arches', 'Balloon Arches'], ['celebration-tables', 'Celebration Tables'], ['bouquets', 'Bouquets'],
  ].map(([slug, name], i) => ({ id: uuid(), slug, name, sort_order: (i + 1) * 10, created_at: new Date().toISOString() }));
  return { categories: cats, projects: [], media: [], admins: [] };
}

export async function startMock({ port = 0, cloudName = 'democloud', db = seed() } = {}) {
  const users = new Map();           // email -> {id, password}
  const tokens = new Map();          // access token -> user id
  const uploads = [];                // log of uploads for assertions
  const state = { db, users, uploads, deleted: [], failNextUpload: 0 };

  function addUser(email, password, admin) {
    const id = uuid();
    users.set(email, { id, password, email });
    if (admin) db.admins.push({ user_id: id, email });
    return id;
  }
  state.addUser = addUser;

  function session(email) {
    const u = users.get(email);
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const access = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, role: 'authenticated', aud: 'authenticated', exp, email })}.${crypto.randomBytes(8).toString('hex')}`;
    tokens.set(access, u.id);
    return {
      access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: exp,
      refresh_token: crypto.randomBytes(6).toString('hex'),
      user: { id: u.id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
    };
  }

  const who = (req) => {
    const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    // The service-role key (used by tools/bulk-upload.mjs) bypasses the rules, like the real one.
    if (t === 'service-role-key') return { id: 'service', admin: true };
    const id = tokens.get(t);
    return { id, admin: !!id && db.admins.some((a) => a.user_id === id) };
  };

  /* ------------------------------------------------ mini PostgREST ------- */
  const REL = {
    projects: {
      category: { table: 'categories', kind: 'one', local: 'category_id' },
      cover: { table: 'media', kind: 'one', local: 'cover_media_id' },
      media: { table: 'media', kind: 'many', foreign: 'project_id' },
    },
    media: { project: { table: 'projects', kind: 'one', local: 'project_id' } },
    categories: { projects: { table: 'projects', kind: 'many', foreign: 'category_id' } },
  };

  function splitTop(s) {
    const out = []; let d = 0, cur = '';
    for (const ch of s) {
      if (ch === '(') d++; if (ch === ')') d--;
      if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    if (cur) out.push(cur);
    return out.map((x) => x.trim()).filter(Boolean);
  }

  function visible(table, row, ctx) {
    if (ctx.admin) return true;
    if (table === 'projects') return row.status === 'published';
    if (table === 'media') { const p = db.projects.find((x) => x.id === row.project_id); return !!p && p.status === 'published'; }
    if (table === 'admins') return false;
    return true;
  }

  function project(row, cols) {
    if (!cols || cols.includes('*')) return { ...row };
    const o = {}; cols.forEach((c) => { if (c in row) o[c] = row[c]; }); return o;
  }

  function shape(table, rows, select, params, ctx, prefix = '') {
    const items = splitTop(select || '*');
    return rows.map((row) => {
      const plain = []; const out = {};
      for (const it of items) {
        const m = /^(?:(\w+):)?(\w+)(?:!\w+)?\((.*)\)$/.exec(it);
        if (!m) { plain.push(it); continue; }
        const alias = m[1] || m[2]; const relName = REL[table] && (REL[table][alias] ? alias : m[2]);
        const rel = REL[table] && REL[table][relName];
        if (!rel) continue;
        const target = db[rel.table];
        let related = rel.kind === 'one'
          ? target.filter((t) => t.id === row[rel.local])
          : target.filter((t) => t[rel.foreign] === row.id);
        related = related.filter((r) => visible(rel.table, r, ctx));
        const ord = params.get(alias + '.order') || params.get(m[2] + '.order');
        if (ord) related = order(related, ord);
        const lim = params.get(alias + '.limit') || params.get(m[2] + '.limit');
        if (lim) related = related.slice(0, +lim);
        if (m[3].trim() === 'count') { out[alias] = [{ count: related.length }]; continue; }
        const inner = related.map((r) => shape(rel.table, [r], m[3], params, ctx)[0]);
        out[alias] = rel.kind === 'one' ? (inner[0] || null) : inner;
      }
      Object.assign(out, project(row, plain));
      return out;
    });
  }

  function order(rows, spec) {
    const keys = spec.split(',').map((k) => { const [c, d] = k.split('.'); return [c, d === 'desc' ? -1 : 1]; });
    return [...rows].sort((a, b) => { for (const [c, d] of keys) { if (a[c] < b[c]) return -d; if (a[c] > b[c]) return d; } return 0; });
  }

  function filter(rows, params) {
    let out = rows;
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(k) || k.includes('.')) continue;
      const m = /^(eq|neq|in|is)\.(.*)$/.exec(v);
      if (!m) continue;
      const val = m[2];
      const cast = (x) => (x === 'true' ? true : x === 'false' ? false : x);
      if (m[1] === 'eq') out = out.filter((r) => String(r[k]) === val);
      else if (m[1] === 'neq') out = out.filter((r) => String(r[k]) !== val);
      else if (m[1] === 'is') out = out.filter((r) => (val === 'null' ? r[k] == null : String(r[k]) === val));
      else if (m[1] === 'in') { const set = val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')); out = out.filter((r) => set.includes(String(r[k]))); }
      void cast;
    }
    return out;
  }

  function checks(table, row) {
    if (table === 'projects') {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(row.slug || '')) return 'slug format';
      if (!['draft', 'published'].includes(row.status || 'draft')) return 'status';
      if (db.projects.some((p) => p.slug === row.slug && p.id !== row.id)) return 'duplicate slug';
    }
    if (table === 'media' && db.media.some((m) => m.public_id === row.public_id && m.id !== row.id)) return 'duplicate public_id';
    if (table === 'media' && row.layout && !['wide', 'tall', 'half'].includes(row.layout)) return 'layout';
    return null;
  }

  const DEFAULTS = {
    projects: () => ({ id: uuid(), description: '', is_story: false, location: '', occasion: '', credits: [], featured: false, status: 'draft', sort_order: 0, cover_media_id: null, category_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    media: () => ({ id: uuid(), thumb_url: null, width: null, height: null, duration: null, bytes: null, format: null, alt: '', layout: 'wide', sort_order: 0, created_at: new Date().toISOString() }),
    categories: () => ({ id: uuid(), sort_order: 0, created_at: new Date().toISOString() }),
  };

  async function rest(req, res, url, body) {
    const table = url.pathname.replace('/rest/v1/', '');
    const ctx = who(req);
    const params = url.searchParams;
    const json = (code, obj, extra = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...extra }); res.end(JSON.stringify(obj)); };

    if (table === 'rpc/is_admin') return json(200, ctx.admin);
    if (!db[table]) return json(404, { message: 'unknown table' });

    if (req.method === 'GET' || req.method === 'HEAD') {
      let rows = db[table].filter((r) => visible(table, r, ctx));
      rows = filter(rows, params);
      const ord = params.get('order'); if (ord) rows = order(rows, ord);
      const off = params.get('offset'); if (off) rows = rows.slice(+off);
      const lim = params.get('limit'); if (lim) rows = rows.slice(0, +lim);
      rows = rows.slice(0, state.maxRows || 1000);          // Supabase's default "max rows" per request
      const shaped = shape(table, rows, params.get('select'), params, ctx);
      const single = /vnd.pgrst.object/.test(req.headers.accept || '');
      if (single) return shaped.length === 1 ? json(200, shaped[0]) : json(406, { message: 'JSON object requested, multiple (or no) rows returned' });
      return json(200, shaped, { 'Content-Range': `0-${Math.max(0, shaped.length - 1)}/${shaped.length}` });
    }

    // Writes: admins only (the SQL policies say the same).
    if (!ctx.admin) return json(ctx.id ? 403 : 401, { message: 'new row violates row-level security policy' });

    const wantBack = /return=representation/.test(req.headers.prefer || '');
    if (req.method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      const made = [];
      for (const r of list) {
        const row = { ...DEFAULTS[table](), ...r };
        const bad = checks(table, row); if (bad) return json(409, { message: bad, code: '23505' });
        db[table].push(row); made.push(row);
      }
      const outRows = made.map((r) => shape(table, [r], params.get('select'), params, ctx)[0]);
      const one = /vnd.pgrst.object/.test(req.headers.accept || '');
      return wantBack ? json(201, one ? outRows[0] : outRows) : (res.writeHead(201), res.end());
    }
    if (req.method === 'PATCH') {
      const rows = filter(db[table], params);
      for (const r of rows) {
        const next = { ...r, ...body };
        const bad = checks(table, next); if (bad) return json(409, { message: bad, code: '23505' });
        Object.assign(r, body, table === 'projects' ? { updated_at: new Date().toISOString() } : {});
      }
      return wantBack ? json(200, rows.map((r) => shape(table, [r], params.get('select'), params, ctx)[0])) : (res.writeHead(204), res.end());
    }
    if (req.method === 'DELETE') {
      const rows = filter(db[table], params);
      db[table] = db[table].filter((r) => !rows.includes(r)); state.db[table] = db[table];
      if (table === 'projects') {
        const ids = rows.map((r) => r.id);
        state.db.media = state.db.media.filter((m) => !ids.includes(m.project_id));
        db.media = state.db.media;
      }
      if (table === 'media') db.projects.forEach((p) => { if (rows.some((m) => m.id === p.cover_media_id)) p.cover_media_id = null; });
      return wantBack ? json(200, rows) : (res.writeHead(204), res.end());
    }
    return json(405, { message: 'method' });
  }

  /* ------------------------------------------------------- auth ---------- */
  async function auth(req, res, url, body) {
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const u = users.get(body.email);
        if (!u || u.password !== body.password) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 400, msg: 'Invalid login credentials' });
        return json(200, session(body.email));
      }
      if (grant === 'refresh_token') {
        const first = [...users.keys()][0];
        return first ? json(200, session(first)) : json(400, { error: 'invalid_grant' });
      }
    }
    if (url.pathname === '/auth/v1/user') {
      const id = who(req).id;
      const u = [...users.values()].find((x) => x.id === id);
      return u ? json(200, { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }) : json(401, { msg: 'invalid JWT' });
    }
    if (url.pathname === '/auth/v1/logout') { res.writeHead(204); return res.end(); }
    return json(404, { msg: 'not found' });
  }

  /* ------------------------------------------------ cloudinary ----------- */
  const chunked = new Map();       // upload id -> bytes so far
  const assets = new Map();        // type:public_id -> stored result
  async function cloudinary(req, res, url, raw) {
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

    // delete: POST /v1_1/<cloud>/<type>/destroy, form-encoded and signed
    const dm = /^\/v1_1\/([^/]+)\/(image|video)\/destroy$/.exec(url.pathname);
    if (dm && req.method === 'POST') {
      const p = Object.fromEntries(new URLSearchParams(raw.toString()));
      const { signature, api_key, ...signed } = p;
      const secret = process.env.CLOUDINARY_API_SECRET || 'test-secret';
      const expect = crypto.createHash('sha1').update(Object.keys(signed).sort().map((k) => k + '=' + signed[k]).join('&') + secret).digest('hex');
      if (signature !== expect) return json(401, { error: { message: 'Invalid Signature' } });
      state.deleted.push(dm[2] + ':' + p.public_id);
      return json(200, { result: state.failDelete ? 'error' : 'ok' });
    }

    const m = /^\/v1_1\/([^/]+)\/(image|video)\/upload$/.exec(url.pathname);
    if (!m || req.method !== 'POST') return json(404, { error: { message: 'not found' } });

    if (state.failNextUpload > 0) { state.failNextUpload--; return json(400, { error: { message: 'Invalid image file' } }); }

    const ct = req.headers['content-type'] || '';
    const bm = /boundary=(.+)$/.exec(ct);
    if (!bm) return json(400, { error: { message: 'multipart required' } });
    const fields = {}; let fileLen = 0, fileName = '';
    const text = raw.toString('latin1');
    for (const part of text.split('--' + bm[1]).slice(1)) {
      const head = /name="([^"]+)"(?:; filename="([^"]*)")?/.exec(part);
      if (!head) continue;
      const bodyStart = part.indexOf('\r\n\r\n') + 4;
      const value = part.slice(bodyStart, part.lastIndexOf('\r\n'));
      if (head[2] !== undefined) { fileLen = value.length; fileName = head[2]; } else fields[head[1]] = value;
    }

    // Verify the signature exactly as Cloudinary does (secret from env).
    const secret = process.env.CLOUDINARY_API_SECRET || 'test-secret';
    const signed = {};
    Object.keys(fields).filter((k) => !['api_key', 'signature', 'file', 'resource_type', 'cloud_name'].includes(k)).forEach((k) => { signed[k] = fields[k]; });
    const expect = crypto.createHash('sha1').update(Object.keys(signed).sort().map((k) => k + '=' + signed[k]).join('&') + secret).digest('hex');
    if (fields.signature !== expect) return json(401, { error: { message: 'Invalid Signature' } });
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    if (fields.allowed_formats && !fields.allowed_formats.split(',').includes(ext)) return json(400, { error: { message: 'Format ' + ext + ' not allowed' } });

    // Chunked upload: Content-Range + X-Unique-Upload-Id; only the last chunk completes.
    const range = /bytes (\d+)-(\d+)\/(\d+)/.exec(req.headers['content-range'] || '');
    if (range) {
      const id = req.headers['x-unique-upload-id'];
      state.chunkRequests = (state.chunkRequests || 0) + 1;
      chunked.set(id, (chunked.get(id) || 0) + fileLen);
      if (+range[2] + 1 < +range[3]) return json(200, { done: false });
      fileLen = chunked.get(id); chunked.delete(id);
    }

    const base = fileName.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '_');
    // A caller-chosen public_id (the bulk script) or one generated inside the signed folder (the dashboard).
    const public_id = fields.public_id || `${fields.folder}/${base}_${crypto.randomBytes(3).toString('hex')}`;
    const isVideo = m[2] === 'video';
    const key = m[2] + ':' + public_id;
    // overwrite=false on an id that already exists returns the existing asset, as Cloudinary does.
    if (fields.overwrite === 'false' && assets.has(key)) return json(200, { ...assets.get(key), existing: true });
    uploads.push({ public_id, type: m[2], bytes: fileLen, fileName, folder: fields.folder });
    const out = {
      public_id, resource_type: m[2], format: ext, bytes: fileLen,
      width: isVideo ? 1280 : 1600, height: isVideo ? 720 : 1067, ...(isVideo ? { duration: 8.5 } : {}),
      secure_url: `https://res.cloudinary.com/${m[1]}/${m[2]}/upload/v1/${public_id}.${ext}`,
    };
    assets.set(key, out);
    return json(200, out);
  }

  /* ------------------------------------------------------ server --------- */
  const server = http.createServer(async (req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*, authorization, apikey, content-type, prefer, x-client-info, accept-profile, content-profile, content-range, x-unique-upload-id, x-requested-with',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS,HEAD',
      'Access-Control-Expose-Headers': 'Content-Range',
    };
    const wh = res.writeHead.bind(res);
    res.writeHead = (c, h) => wh(c, { ...cors, ...(h || {}) });
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    let body = {};
    if (/json/.test(req.headers['content-type'] || '') && raw.length) { try { body = JSON.parse(raw.toString()); } catch (e) { body = {}; } }
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname.startsWith('/rest/v1/')) return await rest(req, res, url, body);
      if (url.pathname.startsWith('/auth/v1/')) return await auth(req, res, url, body);
      if (url.pathname.startsWith('/v1_1/')) return await cloudinary(req, res, url, raw);
    } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ message: String(e && e.message) })); }
    res.writeHead(404); res.end();
  });

  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  state.port = server.address().port;
  state.url = 'http://127.0.0.1:' + state.port;
  state.close = () => new Promise((r) => server.close(r));
  state.cloudName = cloudName;
  return state;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const m = await startMock({ port: 5190 });
  m.addUser('admin@example.com', 'correct horse', true);
  console.log('mock backend on ' + m.url + '  (admin@example.com / correct horse)');
}
