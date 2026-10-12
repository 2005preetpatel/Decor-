#!/usr/bin/env node
/* Bulk upload: hundreds or thousands of existing photos and videos in one go.

   Run it on your own computer (not on Vercel). It reads a folder, uploads every
   file to Cloudinary, and creates the projects and media rows in Supabase.

     node tools/bulk-upload.mjs <folder> [options]

   Folder layout (one folder per project; the folder above it is the category):

     bulk/
       mandap-stage/              <- category (its slug; made if it does not exist)
         aanya-dev/               <- one project
           01-entrance.jpg
           02-mandap.jpg
           film.mp4
           project.json           <- optional details, see below
       tablescapes/
         ishita-rohan/ ...

   Or, without category folders:   node tools/bulk-upload.mjs bulk --flat --category tablescapes
     bulk/<project>/files...

   project.json (all optional):
     { "title": "Aanya & Dev", "location": "Udaipur", "occasion": "Wedding",
       "description": "A palace courtyard.", "story": true, "featured": false }

   Options:
     --publish          publish the projects (default: they are saved as drafts,
                        so you can look them over in the admin first)
     --dry-run          list what would be uploaded; sends nothing
     --concurrency N    files in flight at once (default 4)
     --flat             no category folders; use --category <slug> for all
     --category <slug>  category for --flat

   Safe to run again: files already uploaded are skipped, so an interrupted run
   (or a second run after adding more files) simply carries on.

   Needs, in a local .env file (see .env.example) — NEVER commit it:
     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
     CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET           */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { sign } = require(path.join(here, '..', 'api', '_lib.js'));   // the same signing code the website uses

const MB = 1024 * 1024;
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'heic', 'heif'];
const VIDEO_EXT = ['mp4', 'mov', 'webm', 'm4v'];
const FORMATS = { image: IMAGE_EXT.join(','), video: VIDEO_EXT.join(',') };
const CHUNK_AT = 40 * MB, CHUNK = 20 * MB;

/* ------------------------------------------------------------ arguments ---- */
const args = process.argv.slice(2);
const opts = { publish: false, dry: false, flat: false, concurrency: 4, category: '' };
let folder = '';
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--publish') opts.publish = true;
  else if (a === '--dry-run') opts.dry = true;
  else if (a === '--flat') opts.flat = true;
  else if (a === '--concurrency') opts.concurrency = Math.max(1, Math.min(10, parseInt(args[++i], 10) || 4));
  else if (a === '--category') opts.category = args[++i] || '';
  else if (a.startsWith('--')) die('Unknown option ' + a);
  else folder = a;
}
if (!folder) die('Tell me which folder to upload:  node tools/bulk-upload.mjs <folder>');
if (opts.flat && !opts.category) die('--flat needs --category <slug>.');

function die(msg) { console.error('\n' + msg + '\n'); process.exit(2); }

/* ----------------------------------------------------------- environment --- */
try {
  for (const line of fs.readFileSync(path.join(here, '..', '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch (e) { /* no .env file */ }

const env = (k) => process.env[k] || '';
if (!opts.dry) {
  const need = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const missing = need.filter((k) => !env(k));
  if (missing.length) die('Missing in your .env file: ' + missing.join(', ') + '\n(see .env.example; the values are never printed or sent anywhere except Supabase and Cloudinary)');
}
const SB = env('SUPABASE_URL').replace(/\/+$/, '');
const CLOUD = env('CLOUDINARY_CLOUD_NAME');
const CLD_BASE = (env('CLOUDINARY_API_BASE') || 'https://api.cloudinary.com').replace(/\/+$/, '');
const MAX_IMAGE = (parseFloat(env('MAX_IMAGE_MB')) || 10) * MB;
const MAX_VIDEO = (parseFloat(env('MAX_VIDEO_MB')) || 100) * MB;

/* ------------------------------------------------------------- scanning ---- */
const slugify = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const titleCase = (s) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const extOf = (n) => (/\.([A-Za-z0-9]+)$/.exec(n) || [])[1]?.toLowerCase() || '';
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

async function dirs(p) { return (await fsp.readdir(p, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort(natural); }

async function scan(root) {
  const projects = [], skipped = [];
  const categoryDirs = opts.flat ? [[opts.category, root]] : (await dirs(root)).map((d) => [d, path.join(root, d)]);

  for (const [catName, catPath] of categoryDirs) {
    for (const name of await dirs(catPath)) {
      const dir = path.join(catPath, name);
      let meta = {};
      try { meta = JSON.parse(await fsp.readFile(path.join(dir, 'project.json'), 'utf8')); }
      catch (e) { if (e.code !== 'ENOENT') skipped.push({ file: path.join(dir, 'project.json'), why: 'could not be read: ' + e.message }); }

      const entries = (await fsp.readdir(dir, { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name).sort(natural);
      const files = [];
      for (const f of entries) {
        if (f.toLowerCase() === 'project.json' || f.startsWith('.')) continue;
        const ext = extOf(f);
        const kind = IMAGE_EXT.includes(ext) ? 'image' : VIDEO_EXT.includes(ext) ? 'video' : null;
        const full = path.join(dir, f), size = (await fsp.stat(full)).size;
        if (!kind) { skipped.push({ file: full, why: 'not a supported file type' }); continue; }
        if (!size) { skipped.push({ file: full, why: 'empty file' }); continue; }
        if (size > (kind === 'image' ? MAX_IMAGE : MAX_VIDEO)) { skipped.push({ file: full, why: 'too large (' + (size / MB).toFixed(1) + ' MB; limit ' + ((kind === 'image' ? MAX_IMAGE : MAX_VIDEO) / MB) + ' MB)' }); continue; }
        files.push({ path: full, name: f, kind, size, ext });
      }
      const slug = slugify(meta.slug || name);
      if (!slug) { skipped.push({ file: dir, why: 'folder name has no usable letters or numbers' }); continue; }
      if (files.length) projects.push({
        slug, folderName: name, categorySlug: slugify(catName), categoryName: titleCase(catName), files,
        title: meta.title || titleCase(name), description: meta.description || '', location: meta.location || '',
        occasion: meta.occasion || '', is_story: !!meta.story, featured: !!meta.featured,
      });
    }
  }
  // two folders that slugify to the same project would silently merge
  const seen = new Map();
  for (const p of projects) {
    if (seen.has(p.slug)) die('Two folders become the same web address "' + p.slug + '": ' + seen.get(p.slug) + ' and ' + p.folderName + '. Rename one.');
    seen.set(p.slug, p.folderName);
  }
  return { projects, skipped };
}

/* ------------------------------------------------------------- Supabase ---- */
async function rest(method, pathAndQuery, body, extra = {}) {
  const res = await fetch(SB + '/rest/v1/' + pathAndQuery, {
    method,
    headers: {
      apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: 'Bearer ' + env('SUPABASE_SERVICE_ROLE_KEY'),
      'Content-Type': 'application/json', Prefer: 'return=representation', ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
  if (!res.ok) throw new Error('Supabase ' + method + ' ' + pathAndQuery.split('?')[0] + ' failed (' + res.status + '): ' + ((data && (data.message || data.error)) || text.slice(0, 120)));
  return data;
}

/* ----------------------------------------------------------- Cloudinary ---- */
function publicIdFor(projectSlug, file, taken) {
  const base = file.name.replace(/\.[^.]+$/, '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'file';
  let id = 'opula/' + projectSlug + '/' + base, n = 2;
  while (taken.has(id)) id = 'opula/' + projectSlug + '/' + base + '_' + n++;   // two files, same name
  taken.add(id);
  return id;
}

async function post(url, form, headers) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { method: 'POST', body: form, headers });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return data;
      const err = new Error((data.error && data.error.message) || 'HTTP ' + res.status);
      err.retry = res.status >= 500 || res.status === 429;
      throw err;
    } catch (e) {
      const transient = e.retry !== false && (e.retry || e.name === 'TypeError' || /fetch failed|ECONNRESET|ETIMEDOUT/i.test(String(e.message) + String(e.cause)));
      if (!transient || attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 700 * 2 ** attempt));
    }
  }
}

async function uploadFile(f, publicId) {
  const params = { allowed_formats: FORMATS[f.kind], overwrite: 'false', public_id: publicId, timestamp: Math.floor(Date.now() / 1000) };
  const signature = sign(params, env('CLOUDINARY_API_SECRET'));
  const url = CLD_BASE + '/v1_1/' + CLOUD + '/' + f.kind + '/upload';
  const blob = await fs.openAsBlob(f.path);               // streamed from disk, never loaded whole
  const form = (part) => {
    const fd = new FormData();
    fd.append('api_key', env('CLOUDINARY_API_KEY')); fd.append('signature', signature);
    Object.entries(params).forEach(([k, v]) => fd.append(k, String(v)));
    fd.append('file', part, f.name);
    return fd;
  };
  if (f.size <= CHUNK_AT) return post(url, form(blob));

  const uid = crypto.randomUUID();
  let last;
  for (let start = 0; start < f.size; start += CHUNK) {
    const end = Math.min(start + CHUNK, f.size);
    last = await post(url, form(blob.slice(start, end)),
      { 'X-Unique-Upload-Id': uid, 'Content-Range': 'bytes ' + start + '-' + (end - 1) + '/' + f.size });
  }
  return last;
}

/* ------------------------------------------------------------------ main --- */
async function pool(items, n, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const item = items[i++]; await worker(item); }
  }));
}

const root = path.resolve(folder);
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) die('Folder not found: ' + root);

const { projects, skipped } = await scan(root);
const totalFiles = projects.reduce((n, p) => n + p.files.length, 0);
const totalBytes = projects.reduce((n, p) => n + p.files.reduce((m, f) => m + f.size, 0), 0);

console.log(`\nFound ${projects.length} project(s), ${totalFiles} file(s), ${(totalBytes / MB).toFixed(0)} MB.`);
projects.forEach((p) => console.log(`  ${p.categorySlug || '(no category)'} / ${p.slug}: ${p.files.length} file(s) — "${p.title}"`));
if (skipped.length) { console.log(`\nSkipped ${skipped.length}:`); skipped.slice(0, 25).forEach((s) => console.log('  ' + s.file + ' — ' + s.why)); if (skipped.length > 25) console.log('  …and ' + (skipped.length - 25) + ' more (see bulk-report.json)'); }

if (opts.dry) { console.log('\nDry run: nothing was sent.\n'); process.exit(0); }
if (!projects.length) { console.log('\nNothing to upload.\n'); process.exit(skipped.length ? 1 : 0); }

const report = { startedAt: new Date().toISOString(), uploaded: 0, alreadyThere: 0, failed: [], skipped, projects: [] };
let done = 0;

for (const p of projects) {
  console.log(`\n== ${p.slug}`);
  // category
  let categoryId = null;
  if (p.categorySlug) {
    const found = await rest('GET', 'categories?select=id&slug=eq.' + encodeURIComponent(p.categorySlug));
    if (found.length) categoryId = found[0].id;
    else {
      const maxRow = await rest('GET', 'categories?select=sort_order&order=sort_order.desc&limit=1');
      const made = await rest('POST', 'categories', { slug: p.categorySlug, name: p.categoryName, sort_order: (maxRow[0] ? maxRow[0].sort_order : 0) + 10 });
      categoryId = made[0].id; console.log('   new category: ' + p.categoryName);
    }
  }
  // project
  let proj = (await rest('GET', 'projects?select=id,cover_media_id&slug=eq.' + encodeURIComponent(p.slug)))[0];
  if (!proj) {
    proj = (await rest('POST', 'projects', {
      slug: p.slug, title: p.title, description: p.description, location: p.location, occasion: p.occasion,
      category_id: categoryId, is_story: p.is_story, featured: p.featured, status: opts.publish ? 'published' : 'draft',
    }))[0];
    console.log('   new project (' + (opts.publish ? 'published' : 'draft') + ')');
  } else console.log('   project exists; adding anything missing');

  // Supabase returns at most 1000 rows per request, so read them page by page;
  // a project with thousands of files must not look empty on the second run.
  const existing = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await rest('GET', 'media?select=public_id,sort_order&project_id=eq.' + proj.id + '&order=sort_order.asc&limit=1000&offset=' + offset);
    existing.push(...page);
    if (page.length < 1000) break;
  }
  const have = new Set(existing.map((m) => m.public_id));
  let order = existing.reduce((m, r) => Math.max(m, r.sort_order), -1) + 1;

  const taken = new Set();
  const jobs = p.files.map((f) => ({ f, id: publicIdFor(p.slug, f, taken) }));
  const rows = [];
  await pool(jobs, opts.concurrency, async (job) => {
    const label = '[' + (++done) + '/' + totalFiles + '] ' + path.relative(root, job.f.path);
    if (have.has(job.id)) { report.alreadyThere++; console.log('   skip (already uploaded) ' + label); return; }
    try {
      const out = await uploadFile(job.f, job.id);
      const thumb = job.f.kind === 'video'
        ? 'https://res.cloudinary.com/' + CLOUD + '/video/upload/so_10p,f_auto,q_auto,c_limit,w_600/' + out.public_id + '.jpg'
        : 'https://res.cloudinary.com/' + CLOUD + '/image/upload/f_auto,q_auto,c_limit,w_600/' + out.public_id;
      rows.push({
        job, row: {
          project_id: proj.id, type: job.f.kind, public_id: out.public_id, url: out.secure_url, thumb_url: thumb,
          width: out.width || null, height: out.height || null, duration: out.duration || null,
          bytes: out.bytes || job.f.size, format: out.format || job.f.ext,
          layout: job.f.kind === 'image' && out.width && out.height && out.height > out.width * 1.05 ? 'tall' : 'wide',
        },
      });
      report.uploaded++; console.log('   ok   ' + label + ' (' + (job.f.size / MB).toFixed(1) + ' MB)');
    } catch (e) {
      report.failed.push({ file: job.f.path, why: String(e.message) }); console.log('   FAIL ' + label + ' — ' + e.message);
    }
  });

  // Record in the file-name order, not in the order the uploads happened to finish.
  rows.sort((a, b) => natural(a.job.f.name, b.job.f.name));
  const toInsert = rows.map((r) => ({ ...r.row, sort_order: order++ }));
  let inserted = [];
  for (let i = 0; i < toInsert.length; i += 100) inserted = inserted.concat(await rest('POST', 'media', toInsert.slice(i, i + 100)));
  if (!proj.cover_media_id && inserted.length) {
    const first = inserted.slice().sort((a, b) => a.sort_order - b.sort_order)[0];
    await rest('PATCH', 'projects?id=eq.' + proj.id, { cover_media_id: first.id });
  }
  report.projects.push({ slug: p.slug, files: p.files.length, newlyRecorded: inserted.length });
}

report.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(root, 'bulk-report.json'), JSON.stringify(report, null, 2));
console.log(`\nDone. ${report.uploaded} uploaded, ${report.alreadyThere} already there, ${report.failed.length} failed, ${skipped.length} skipped.`);
if (report.failed.length) console.log('Run the same command again to retry the failed ones (finished files are skipped). Details: ' + path.join(root, 'bulk-report.json'));
if (!opts.publish) console.log('Projects were saved as DRAFTS. Open the admin page to look them over and publish.');
console.log('');
process.exit(report.failed.length ? 1 : 0);
