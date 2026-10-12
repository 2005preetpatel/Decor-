/* End-to-end check of the ADMIN dashboard, in a real Chrome, against the mock
   Supabase + Cloudinary (tests/mock-backend.mjs) and the REAL serverless
   functions in api/ (run through server.js with environment variables pointing
   at the mock). The admin page is served with the real Content-Security-Policy
   from vercel.json, so a blocked script, image or request would show up here.

     node tests/e2e-admin.mjs

   Covers: sign-in rules, creating a project, multi-file upload with progress,
   validation (type / size / empty), chunked upload of a big video, retry after
   a failed upload, reordering, cover, layout, alt text, publishing, what the
   public sees, deleting a file / a project (and the files on Cloudinary),
   sign-out, and that nothing typed into a title can run as code. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-backend.mjs';
import { launch, check, failures, sleep } from './cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const PORT = 5188;
const SITE = 'http://localhost:' + PORT;
const OUT = process.env.SHOTS || '.';

process.env.CLOUDINARY_API_SECRET = 'test-secret';
const mock = await startMock();
const { db } = mock;
mock.addUser('admin@example.com', 'correct horse', true);
mock.addUser('visitor@example.com', 'visitor-pass', false);

const server = spawn('node', ['server.js'], {
  cwd: root, stdio: 'ignore',
  env: {
    ...process.env, PORT: String(PORT), SUPABASE_URL: mock.url, SUPABASE_ANON_KEY: 'anon-key',
    CLOUDINARY_CLOUD_NAME: 'democloud', CLOUDINARY_API_KEY: 'key123', CLOUDINARY_API_SECRET: 'test-secret',
    CLOUDINARY_API_BASE: mock.url,
    DEV_CSP_CONNECT: mock.url,        // lets the fake backend through the real policy; nothing else is relaxed
  },
});
for (let i = 0; i < 40; i++) { try { if ((await fetch(SITE + '/admin.html')).ok) break; } catch (e) { /* starting */ } await sleep(250); }

// ---- files to upload -------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-'));
const MB = 1024 * 1024;
const f = (name, bytes) => { const p = path.join(tmp, name); fs.writeFileSync(p, typeof bytes === 'number' ? Buffer.alloc(bytes, 1) : bytes); return p; };
const photo = fs.readFileSync(path.join(root, 'assets', 'hero-plate.jpg'));
const files = {
  a: f('photo-a.jpg', photo), b: f('photo-b.png', photo), c: f('photo-c.jpg', photo),
  clip: f('clip.mp4', 6 * MB), huge: f('huge-film.mp4', 45 * MB),
  exe: f('virus.exe', 1000), big: f('toobig.jpg', 11 * MB), empty: f('empty.jpg', 0), flaky: f('flaky.jpg', photo),
};

const page = await launch({ width: 1280, height: 900 });
await page.intercept({
  replace: [{ part: 'assets/config.js', body: `window.OPULA_CONFIG = { supabaseUrl: '${mock.url}', supabaseAnonKey: 'anon-key', cloudName: 'democloud', showDemoContent: true, maxImageMB: 10, maxVideoMB: 100 };` }],
});

/* ---- small helpers --------------------------------------------------------- */
const q = JSON.stringify;
const click = (sel, text) => page.eval(`(() => { const els = [...document.querySelectorAll(${q(sel)})].filter(e => ${q(text || '')} === '' || e.textContent.trim() === ${q(text || '')}); if (!els.length) throw new Error('nothing to click: ' + ${q(sel + ' ' + (text || ''))}); els[0].click(); return els.length; })()`);
const setv = (sel, v) => page.eval(`(() => { const e = document.querySelector(${q(sel)}); if (!e) throw new Error('missing ' + ${q(sel)}); e.value = ${q(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
const text = (sel) => page.eval(`(() => { const e = document.querySelector(${q(sel)}); return e ? e.textContent : null; })()`);
const exists = (sel) => page.eval(`!!document.querySelector(${q(sel)})`);
async function waitFor(fn, ms = 8000, label = '') {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch (e) { /* not yet */ } await sleep(120); }
  throw new Error('timed out waiting for ' + label);
}
const pickOption = (sel, label) => page.eval(`(() => { const s = document.querySelector(${q(sel)}); const o = [...s.options].find(o => o.textContent.trim() === ${q(label)}); if (!o) throw new Error('no option ' + ${q(label)}); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
const confirmModal = () => click('.modal .btn:not(.btn-quiet)');
const projectsInDb = () => db.projects;

const adminHead = await fetch(SITE + '/admin.html');
check('the admin page is served with a Content-Security-Policy, no-store and noindex', /default-src 'self'/.test(adminHead.headers.get('content-security-policy') || '') && /no-store/.test(adminHead.headers.get('cache-control') || '') && /noindex/.test(adminHead.headers.get('x-robots-tag') || ''), [...adminHead.headers]);
const homeHead = await fetch(SITE + '/');
check('the public site is NOT given that policy (it would break the pinned hero)', !homeHead.headers.get('content-security-policy') && homeHead.headers.get('x-content-type-options') === 'nosniff');

/* ================================================================ sign-in === */
await page.goto(SITE + '/admin.html', 3500);
check('the admin page shows a sign-in form, nothing else', await exists('#em') && await exists('#pw') && !(await exists('.plist')));

await setv('#em', 'admin@example.com'); await setv('#pw', 'wrong password');
await click('button[type=submit]');
await waitFor(async () => /not right/.test(await text('.login .err') || ''), 5000, 'wrong-password message');
check('a wrong password is refused with a plain message', true);
check('…and nothing else is revealed', !(await exists('.plist')));

await setv('#em', 'visitor@example.com'); await setv('#pw', 'visitor-pass');
await click('button[type=submit]');
await waitFor(async () => /not set up as an admin/.test(await text('.login .err') || ''), 6000, 'non-admin message');
check('a signed-in non-admin is turned away and signed out', await page.eval(`!document.querySelector('.plist') && document.getElementById('signout').hidden === true`));

await setv('#em', 'admin@example.com'); await setv('#pw', 'correct horse');
await click('button[type=submit]');
await waitFor(() => exists('.tabs'), 6000, 'dashboard');
check('the admin gets the dashboard', await text('#who') === 'admin@example.com');
check('empty state is friendly', /No projects yet/.test(await text('.plist')));

/* ============================================================ new project === */
await click('button', '+ New project');
await waitFor(() => exists('#f-title'), 4000, 'editor');
await setv('#f-title', 'Aanya & Dev');
check('the web address follows the title', await page.eval(`document.getElementById('f-slug').value`) === 'aanya-and-dev');
await pickOption('#f-cat', 'Mandap & Stage');
await page.eval(`(() => { const s = document.getElementById('f-story'); s.checked = true; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await setv('#f-loc', 'Udaipur'); await setv('#f-occ', 'Wedding'); await setv('#f-desc', 'A palace courtyard.');
check('before saving, uploads are not offered yet', /Create the project first/.test(await text('#media-card')));
await click('button', 'Create project');
await waitFor(() => exists('.drop'), 5000, 'upload area after create');
check('the project is saved as a DRAFT', projectsInDb().length === 1 && projectsInDb()[0].status === 'draft' && projectsInDb()[0].slug === 'aanya-and-dev');
check('category, story flag and location were saved', projectsInDb()[0].is_story === true && projectsInDb()[0].location === 'Udaipur' && !!projectsInDb()[0].category_id);
const project = projectsInDb()[0];

/* ============================================================== uploading === */
await page.setFiles('input[type=file]', [files.exe, files.big, files.empty]);
await waitFor(async () => (await page.eval(`document.querySelectorAll('.qitem').length`)) === 3, 4000, 'three rejected rows');
const rejects = await page.eval(`[...document.querySelectorAll('.qitem .qstate')].map(e => e.textContent)`);
check('a .exe is refused before any upload', rejects.some((t) => /Not a supported file type/.test(t)), rejects);
check('an oversize photo is refused with its size and the limit', rejects.some((t) => /Too large: 11\.0 MB \(limit 10 MB/.test(t)), rejects);
check('an empty file is refused', rejects.some((t) => /empty/.test(t)), rejects);
check('nothing was sent to Cloudinary for those', mock.uploads.length === 0);
await page.eval(`[...document.querySelectorAll('.qitem .btn')].filter(b => b.textContent === 'Remove').forEach(b => b.click())`);

await page.setFiles('input[type=file]', [files.a, files.b, files.clip, files.huge]);
await waitFor(async () => (await page.eval(`document.querySelectorAll('.mcard').length`)) === 4, 25000, 'four uploaded files');
check('four files uploaded and appear in the project', db.media.filter((m) => m.project_id === project.id).length === 4);
check('uploads went into the project\'s own folder', mock.uploads.every((u) => u.folder === 'opula/aanya-and-dev'), mock.uploads);
check('the 45 MB video went up in 20 MB pieces (3 requests)', mock.chunkRequests === 3, mock.chunkRequests);
const rows = db.media.filter((m) => m.project_id === project.id).sort((a, b) => a.sort_order - b.sort_order);
check('sort numbers are distinct (parallel uploads did not collide)', new Set(rows.map((r) => r.sort_order)).size === 4, rows.map((r) => r.sort_order));
check('video rows carry duration and a poster address', rows.filter((r) => r.type === 'video').every((r) => r.duration > 0 && /\/video\/upload\/.*\.jpg$/.test(r.thumb_url)), rows.map((r) => [r.type, r.duration, r.thumb_url]));
check('photo rows carry size, an optimised thumbnail address and a layout', rows.filter((r) => r.type === 'image').every((r) => r.width && r.height && /f_auto,q_auto/.test(r.thumb_url) && ['wide', 'tall'].includes(r.layout)));
check('the first upload became the cover automatically', !!db.projects[0].cover_media_id);
check('the file list shows the cover badge once', await page.eval(`document.querySelectorAll('.mcard.cover').length`) === 1);
await page.shot(OUT + '/e2e-admin-media.jpg', fs);

/* ============================================================== management === */
const ids = rows.map((r) => r.id);
// move the 2nd file earlier
await page.eval(`document.querySelectorAll('.mcard')[1].querySelector('[aria-label="Move earlier"]').click()`);
await waitFor(() => { const o = db.media.filter((m) => m.project_id === project.id).sort((a, b) => a.sort_order - b.sort_order).map((m) => m.id); return o[0] === ids[1] && o[1] === ids[0]; }, 4000, 'reorder');
check('moving a file earlier swaps the order in the database', true);

// make the 3rd file the cover
await page.eval(`document.querySelectorAll('.mcard')[2].querySelector('[aria-label="Use as cover"]').click()`);
await waitFor(() => db.projects[0].cover_media_id === db.media.filter((m) => m.project_id === project.id).sort((a, b) => a.sort_order - b.sort_order)[2].id, 4000, 'cover change');
check('choosing a cover saves it', true);

// layout + alt text on the first card (an image)
await page.eval(`(() => { const c = document.querySelector('.mcard'); const s = c.querySelector('select'); s.value = 'half'; s.dispatchEvent(new Event('change', { bubbles: true })); const i = c.querySelector('input[type=text]'); i.value = 'The mandap at dusk'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await waitFor(() => db.media.some((m) => m.layout === 'half' && m.alt === 'The mandap at dusk'), 4000, 'layout + alt');
check('layout and a description are saved', true);

// a simulated Cloudinary failure, then retry
mock.failNextUpload = 1;
await page.setFiles('input[type=file]', [files.flaky]);
await waitFor(async () => /Invalid image file/.test(await text('.qitem .qstate') || ''), 8000, 'upload error message');
check('a failed upload is reported on its row, with Cloudinary\'s reason', true);
check('…and no half-saved row was left behind', db.media.filter((m) => m.project_id === project.id).length === 4);
await click('.qitem .btn', 'Retry');
await waitFor(async () => (await page.eval(`document.querySelectorAll('.mcard').length`)) === 5, 10000, 'retry success');
check('Retry works once the problem is gone', db.media.filter((m) => m.project_id === project.id).length === 5);

/* ================================================================ publish === */
await pickOption('#f-status', 'Published (live on the website)');
await click('button', 'Save changes');
await waitFor(() => db.projects[0].status === 'published', 5000, 'publish');
const pub = await (await fetch(`${mock.url}/rest/v1/projects?select=slug&status=eq.published`, { headers: { apikey: 'anon-key', Authorization: 'Bearer anon-key' } })).json();
check('once published, an anonymous visitor can see it', pub.some((p) => p.slug === 'aanya-and-dev'), pub);
const media = await (await fetch(`${mock.url}/rest/v1/media?select=public_id`, { headers: { apikey: 'anon-key', Authorization: 'Bearer anon-key' } })).json();
check('…and its files', media.length === 5, media.length);

// publish without any file is blocked
await click('button', '← All projects');
await waitFor(() => exists('.plist'), 4000, 'list');
await click('button', '+ New project');
await waitFor(() => exists('#f-title'), 3000);
await setv('#f-title', '<img src=x onerror=window.__x=1>');
await pickOption('#f-status', 'Published (live on the website)');
await click('button', 'Create project');
await sleep(600);
check('publishing an empty project is blocked with a clear message', /Add at least one photo or video/.test(await text('#toasts') || '') && db.projects.length === 1);
await pickOption('#f-status', 'Draft (hidden)');
await click('button', 'Create project');
await waitFor(() => db.projects.length === 2, 4000, 'second project');
check('a title with markup is stored as text', db.projects[1].title === '<img src=x onerror=window.__x=1>');
await click('button', '← All projects');
await waitFor(() => exists('.plist'), 4000);
check('…shown as text in the list, never run as code', await page.eval(`window.__x === undefined && document.querySelector('.ptitle').textContent.includes('<img')`));

await page.shot(OUT + '/e2e-admin-list.jpg', fs);

/* ================================================================== delete === */
await click('.prow .btn', 'Edit');           // first row = newest = the markup one
await waitFor(() => exists('#f-title'), 3000);
await click('button', '← All projects');
await waitFor(() => exists('.plist'), 4000);
const rowFor = (title) => `[...document.querySelectorAll('.prow')].find(r => r.querySelector('.ptitle').textContent.includes(${q(title)}))`;
await page.eval(`${rowFor('Aanya')}.querySelector('.btn-danger').click()`);
await waitFor(() => exists('.modal'), 3000);
check('deleting asks first, in plain words', /permanently removes/.test(await text('.modal') || ''));
await page.eval(`document.querySelector('.modal .btn-quiet').click()`);      // Cancel
await sleep(300);
check('cancelling deletes nothing', db.projects.length === 2 && mock.deleted.length === 0);

await page.eval(`${rowFor('Aanya')}.querySelector('.btn-danger').click()`);
await waitFor(() => exists('.modal'), 3000);
await confirmModal();
await waitFor(() => db.projects.length === 1, 8000, 'project deletion');
check('deleting a project removes its row and its media rows', db.media.filter((m) => m.project_id === project.id).length === 0);
check('…and all 5 files from Cloudinary', mock.deleted.length === 5 && mock.deleted.every((d) => d.includes('opula/aanya-and-dev/')), mock.deleted);

/* ============================================ file removal + storage failure === */
mock.deleted.length = 0;
const p2 = db.projects[0];
await click('.prow .btn', 'Edit');
await waitFor(() => exists('.drop'), 4000);
await page.setFiles('input[type=file]', [files.a, files.c]);
await waitFor(async () => (await page.eval(`document.querySelectorAll('.mcard').length`)) === 2, 15000, 'two files in project 2');
mock.failDelete = true;
await page.eval(`document.querySelectorAll('.mcard')[0].querySelector('[aria-label="Delete this file"]').click()`);
await waitFor(() => exists('.modal'), 3000); await confirmModal();
await waitFor(async () => /could not remove it from storage/i.test(await text('.modal h3') || ''), 6000, 'storage-failure prompt');
check('if Cloudinary will not delete, you are asked before the row is removed', db.media.filter((m) => m.project_id === p2.id).length === 2);
await page.eval(`document.querySelector('.modal .btn-quiet').click()`);   // keep it
await sleep(300);
check('choosing to keep it leaves everything as it was', db.media.filter((m) => m.project_id === p2.id).length === 2);
mock.failDelete = false;
await page.eval(`document.querySelectorAll('.mcard')[0].querySelector('[aria-label="Delete this file"]').click()`);
await waitFor(() => exists('.modal'), 3000); await confirmModal();
await waitFor(() => db.media.filter((m) => m.project_id === p2.id).length === 1, 6000, 'single delete');
check('deleting one file removes it from Cloudinary and the database', mock.deleted.length >= 1);
check('the cover moves to the remaining file when the cover is deleted', db.projects[0].cover_media_id === db.media.find((m) => m.project_id === p2.id).id);

/* ============================================================== categories === */
await click('button', '← All projects');
await waitFor(() => exists('.tabs'), 4000);
await click('.tab', 'Categories');
await waitFor(() => exists('.crow'), 3000);
await setv('.crow:last-child input', 'Haldi & Mehndi');
await click('.crow:last-child .btn', 'Add category');
await waitFor(() => db.categories.some((c) => c.slug === 'haldi-and-mehndi'), 4000, 'new category');
check('a category can be added', true);

/* ================================================================= sign out === */
await click('#signout');
await waitFor(() => exists('#em'), 4000, 'back to sign-in');
check('signing out returns to the sign-in form and hides the dashboard', !(await exists('.tabs')));
await page.goto(SITE + '/admin.html', 3000);
check('after sign-out a reload still asks for sign-in', await exists('#em') && !(await exists('.tabs')));

/* ==================================================================== misc === */
check('the real Content-Security-Policy blocked nothing the dashboard needs', page.csp.length === 0, page.csp);
check('no JavaScript errors in the dashboard', page.logs.filter((l) => l.startsWith('EXCEPTION')).length === 0, page.logs);

await page.close(); server.kill(); await mock.close(); fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures() ? `\n${failures()} check(s) FAILED` : '\nAll checks passed');
process.exit(failures() ? 1 : 0);
