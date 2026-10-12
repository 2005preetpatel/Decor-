/* Shared helpers for the serverless functions in this folder.

   Vercel treats every file in /api as an endpoint EXCEPT those starting with
   an underscore, so this one is a library, not a route.

   Nothing here runs in the browser. The Cloudinary API secret is read from
   the host's environment variables and never leaves this process. */

const crypto = require('node:crypto');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function env(name) {
  const v = process.env[name];
  if (!v) throw new HttpError(500, 'Server is not configured: ' + name + ' is missing.');
  return v;
}

/* Only a signed-in user who is listed in public.admins gets through.

   The question is put to Supabase itself, using the caller's own token: the
   database function is_admin() answers for whoever the token belongs to. That
   means the rule lives in exactly one place (the SQL), and this process never
   needs the Supabase service-role key. */
async function requireAdmin(req) {
  const header = (req.headers && req.headers.authorization) || '';
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  if (!m) throw new HttpError(401, 'Please sign in.');

  const base = env('SUPABASE_URL').replace(/\/+$/, '');
  let res;
  try {
    res = await fetch(base + '/rest/v1/rpc/is_admin', {
      method: 'POST',
      headers: {
        apikey: env('SUPABASE_ANON_KEY'),
        Authorization: 'Bearer ' + m[1],
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
  } catch (e) {
    throw new HttpError(502, 'Could not reach the database.');
  }

  if (res.status === 401 || res.status === 403) {
    throw new HttpError(401, 'Your session has expired. Please sign in again.');
  }
  if (!res.ok) throw new HttpError(502, 'The database could not confirm your access.');

  const isAdmin = await res.json();
  if (isAdmin !== true) throw new HttpError(403, 'This account is not an admin.');
}

/* Cloudinary's signature: every parameter that is being signed, sorted by
   name, joined as key=value with &, the secret appended, then SHA-1. `file`,
   `cloud_name`, `resource_type`, `api_key` and the signature itself are never
   part of it. */
function sign(params, secret) {
  const base = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => k + '=' + params[k])
    .join('&');
  return crypto.createHash('sha1').update(base + secret).digest('hex');
}

function cloudinaryBase() {
  return (process.env.CLOUDINARY_API_BASE || 'https://api.cloudinary.com').replace(/\/+$/, '');
}

/* Wrap a handler: POST only, JSON in and out, errors turned into clean
   responses (and never a stack trace or a secret). */
function route(handler) {
  return async function (req, res) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        throw new HttpError(405, 'Use POST.');
      }
      const ct = String((req.headers && req.headers['content-type']) || '');
      if (!/application\/json/i.test(ct)) throw new HttpError(415, 'Send JSON.');
      const body = typeof req.body === 'string' ? safeParse(req.body) : req.body;
      if (!body || typeof body !== 'object') throw new HttpError(400, 'Bad request body.');

      await requireAdmin(req);
      const out = await handler(body);
      res.status(200).json(out);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (!(e instanceof HttpError)) console.error('[api]', e && e.message);
      res.status(status).json({ error: e instanceof HttpError ? e.message : 'Something went wrong.' });
    }
  };
}

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

module.exports = { HttpError, env, requireAdmin, sign, cloudinaryBase, route };
