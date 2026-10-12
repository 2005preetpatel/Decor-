/* Checks tools/bulk-upload.mjs against the mock Supabase + Cloudinary:
   folder scanning, creating categories / projects / media, ordering, cover,
   skipping bad files, chunked upload of a big video, and — the important one —
   that running it again changes nothing (so an interrupted run can be resumed).

     node tests/e2e-bulk.mjs                                                    */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-backend.mjs';
import { check, failures } from './cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', 'tools', 'bulk-upload.mjs');
const MB = 1024 * 1024;

const mock = await startMock();
const { db } = mock;
process.env.CLOUDINARY_API_SECRET = 'test-secret';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-'));
const put = (rel, bytes) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof bytes === 'number' ? Buffer.alloc(bytes, 7) : bytes); };

put('mandap-stage/aanya-dev/10-last.jpg', 2000);
put('mandap-stage/aanya-dev/2-second.jpg', 2000);
put('mandap-stage/aanya-dev/1-first.jpg', 2000);
put('mandap-stage/aanya-dev/film.mp4', 45 * MB);                  // chunked
put('mandap-stage/aanya-dev/notes.txt', 50);                      // unsupported
put('mandap-stage/aanya-dev/toobig.png', 11 * MB);                // over the 10 MB photo limit
put('mandap-stage/aanya-dev/project.json', JSON.stringify({ title: 'Aanya & Dev', location: 'Udaipur', occasion: 'Wedding', description: 'A palace courtyard.', story: true, featured: true }));
put('tablescapes/ishita-rohan/a.jpg', 1500);
put('Floral Walls/mehndi night/x.jpg', 1500);                     // names with spaces / capitals
put('empty-project/readme.txt', 10);                              // a project with no usable file

const env = {
  ...process.env, SUPABASE_URL: mock.url, SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  CLOUDINARY_CLOUD_NAME: 'democloud', CLOUDINARY_API_KEY: 'key123', CLOUDINARY_API_SECRET: 'test-secret', CLOUDINARY_API_BASE: mock.url,
};
// Async on purpose: the fake backend runs in THIS process, so blocking here would stop it answering.
const exec = (args, e) => new Promise((resolve) => {
  const p = spawn('node', [script, ...args], { env: e });
  let stdout = '', stderr = '';
  p.stdout.on('data', (d) => (stdout += d)); p.stderr.on('data', (d) => (stderr += d));
  const t = setTimeout(() => p.kill(), 120000);
  p.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
});
const run = (...a) => exec([root, ...a], env);

/* ------------------------------------------------------------- dry run ----- */
const dry = await run('--dry-run');
check('dry run sends nothing', dry.status === 0 && mock.uploads.length === 0 && db.projects.length === 0, dry.stdout + dry.stderr);
check('dry run reports what it found and what it will skip', /3 project\(s\), 6 file\(s\)/.test(dry.stdout) && /not a supported file type/.test(dry.stdout) && /too large \(11\.0 MB; limit 10 MB\)/.test(dry.stdout), dry.stdout);

/* ----------------------------------------------------------- first run ----- */
const r1 = await run('--concurrency', '3');
check('the first run finishes cleanly', r1.status === 0, r1.stdout.slice(-600) + r1.stderr);
check('3 projects were created, as DRAFTS by default', db.projects.length === 3 && db.projects.every((p) => p.status === 'draft'), db.projects.map((p) => [p.slug, p.status]));
check('a project folder with no usable file creates nothing', !db.projects.some((p) => p.slug === 'empty-project'));
const slugs = db.projects.map((p) => p.slug).sort();
check('folder names with spaces and capitals become clean web addresses', slugs.join() === 'aanya-dev,ishita-rohan,mehndi-night', slugs);
const cats = db.categories.map((c) => c.slug);
check('missing categories were created; existing ones reused (no duplicates)', cats.filter((c) => c === 'tablescapes').length === 1 && cats.includes('floral-walls') && db.categories.length === 9, cats);
const aanya = db.projects.find((p) => p.slug === 'aanya-dev');
check('project.json supplied title, place, occasion, story and featured', aanya.title === 'Aanya & Dev' && aanya.location === 'Udaipur' && aanya.is_story === true && aanya.featured === true && aanya.description === 'A palace courtyard.', aanya);
const am = db.media.filter((m) => m.project_id === aanya.id).sort((a, b) => a.sort_order - b.sort_order);
check('files are ordered naturally by name (1, 2, 10 — not 1, 10, 2)', am.slice(0, 3).map((m) => m.public_id.split('/').pop()).join() === '1-first,2-second,10-last', am.map((m) => m.public_id));
check('bad files were skipped, good ones kept (3 photos + 1 video)', am.length === 4 && am.filter((m) => m.type === 'video').length === 1, am.length);
check('the first file is the cover', aanya.cover_media_id === am[0].id);
check('the 45 MB video went up in 3 pieces', mock.chunkRequests === 3, mock.chunkRequests);
check('public ids are readable and stay inside opula/<project>/', am.every((m) => /^opula\/aanya-dev\/[A-Za-z0-9_-]+$/.test(m.public_id)), am.map((m) => m.public_id));
check('media rows carry size and duration', am.find((m) => m.type === 'video').duration > 0 && am.every((m) => m.width && m.bytes));
check('a report was written, listing the skipped files', fs.existsSync(path.join(root, 'bulk-report.json')) && JSON.parse(fs.readFileSync(path.join(root, 'bulk-report.json'), 'utf8')).skipped.length >= 2);
check('the secret never appears in the script output', !(r1.stdout + r1.stderr).includes('test-secret') && !(r1.stdout + r1.stderr).includes('service-role-key'));

/* ---------------------------------------------------------- second run ----- */
const uploadsBefore = mock.uploads.length, mediaBefore = db.media.length, projectsBefore = db.projects.length;
const r2 = await run();
check('running it again succeeds', r2.status === 0, r2.stdout.slice(-400));
check('…uploads nothing new', mock.uploads.length === uploadsBefore, mock.uploads.length - uploadsBefore);
check('…creates no duplicate rows', db.media.length === mediaBefore && db.projects.length === projectsBefore, [db.media.length, mediaBefore]);

/* ------------------------------------------- resume: add one new file ------- */
put('tablescapes/ishita-rohan/b-new.jpg', 1500);
const r3 = await run();
check('adding a file and re-running uploads only the new one', r3.status === 0 && mock.uploads.length === uploadsBefore + 1 && db.media.length === mediaBefore + 1, r3.stdout.slice(-300));
const ishita = db.projects.find((p) => p.slug === 'ishita-rohan');
const im = db.media.filter((m) => m.project_id === ishita.id).sort((a, b) => a.sort_order - b.sort_order);
check('…and it is added after the existing ones', im.length === 2 && im[1].public_id.endsWith('/b-new') && im[0].sort_order < im[1].sort_order);

/* ---------------------- recovery: uploaded to Cloudinary but not recorded ---- */
db.media = db.media.filter((m) => m.project_id !== ishita.id);          // as if the run died before saving rows
db.projects.find((p) => p.id === ishita.id).cover_media_id = null;
const r4 = await run();
check('files already on Cloudinary but missing from the database are recorded again (not uploaded twice)', r4.status === 0 && db.media.filter((m) => m.project_id === ishita.id).length === 2 && mock.uploads.length === uploadsBefore + 1, r4.stdout.slice(-300));

/* ------------- a project that already has thousands of files (paging) -------- */
// Supabase answers at most 1000 rows per request. If the script read only the
// first page it would think most files were missing and try to record them
// again, which the database refuses (public_id is unique).
const big = db.projects.find((p) => p.slug === 'mehndi-night');
for (let i = 0; i < 2500; i++) {
  db.media.push({ id: 'bulkseed-' + i, project_id: big.id, type: 'image', public_id: 'opula/mehndi-night/seed_' + i, url: 'x', thumb_url: null, width: 1, height: 1, duration: null, bytes: 1, format: 'jpg', alt: '', layout: 'wide', sort_order: 100 + i, created_at: new Date().toISOString() });
}
for (let i = 0; i < 2500; i += 500) put('Floral Walls/mehndi night/seed_' + i + '.jpg', 800);   // files the DB already knows about
put('Floral Walls/mehndi night/seed_2499.jpg', 800);
put('Floral Walls/mehndi night/zz-brand-new.jpg', 800);
const beforeBig = mock.uploads.length;
const r6 = await run();
check('with 2,500 files already recorded, only the genuinely new file is uploaded', r6.status === 0 && mock.uploads.length - beforeBig === 1 && mock.uploads[mock.uploads.length - 1].public_id.endsWith('zz-brand-new'), r6.stdout.slice(-400));
check('…and it is recorded once, after all the others', db.media.filter((m) => m.project_id === big.id && m.public_id.endsWith('zz-brand-new')).length === 1 && db.media.filter((m) => m.project_id === big.id).length === 2502);

/* --------------------------------------------------------- --publish -------- */
put('publish-me/p1/one.jpg', 1000);
const r5 = await run('--publish');
check('--publish makes new projects live', r5.status === 0 && db.projects.find((p) => p.slug === 'p1')?.status === 'published', r5.stdout.slice(-200));

/* ---------------------------------------------------- bad configuration ----- */
const noEnv = await exec([root], { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot });
check('without credentials it stops with a plain message and uploads nothing', noEnv.status === 2 && /Missing in your \.env file/.test(noEnv.stderr), noEnv.stderr);
const bad = await exec([path.join(root, 'does-not-exist')], env);
check('a wrong folder is reported plainly', bad.status === 2 && /Folder not found/.test(bad.stderr), bad.stderr);

await mock.close(); fs.rmSync(root, { recursive: true, force: true });
console.log(failures() ? `\n${failures()} check(s) FAILED` : '\nAll checks passed');
process.exit(failures() ? 1 : 0);
