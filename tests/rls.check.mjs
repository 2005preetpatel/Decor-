/* Checks supabase/schema.sql against a real Postgres (PGlite, Postgres
   compiled to WebAssembly), acting as a visitor, a signed-in non-admin and an
   admin, exactly as Supabase's API would.

   Needs PGlite, which is not a dependency of the site:
     npm install --no-save @electric-sql/pglite
     node tests/rls.check.mjs

   Supabase itself provides the pieces faked here: the anon / authenticated
   roles, the auth.users table and auth.uid(). */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, '..', 'supabase', 'schema.sql'), 'utf8');

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  grant usage on schema public to anon, authenticated;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
`);
await db.exec(schema);
await db.exec(schema);                       // a second run must be harmless

const ADMIN = '11111111-1111-1111-1111-111111111111';
const USER  = '22222222-2222-2222-2222-222222222222';
await db.exec(`
  insert into auth.users values ('${ADMIN}','admin@x.com'), ('${USER}','user@x.com');
  insert into public.admins (user_id, email) values ('${ADMIN}','admin@x.com');
`);

// Seed content as the owner (bypasses RLS, like the SQL editor does).
await db.exec(`
  insert into public.projects (id, slug, title, status, category_id) values
    ('aaaaaaaa-0000-0000-0000-000000000001', 'live',  'Live',  'published', (select id from public.categories where slug='bouquets')),
    ('aaaaaaaa-0000-0000-0000-000000000002', 'draft', 'Draft', 'draft',     (select id from public.categories where slug='bouquets'));
  insert into public.media (project_id, type, public_id, url) values
    ('aaaaaaaa-0000-0000-0000-000000000001', 'image', 'opula/live/a',  'https://x/a'),
    ('aaaaaaaa-0000-0000-0000-000000000002', 'image', 'opula/draft/b', 'https://x/b');
`);

let failed = 0;
async function as(role, sub, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub || ''}', false); set role ${role};`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
}
async function rows(sql) { return (await db.query(sql)).rows; }
async function denied(sql) {
  try { const r = await db.query(sql); return { ok: true, rowCount: r.affectedRows ?? r.rows.length }; }
  catch (e) { return { ok: false, msg: e.message }; }
}
function check(name, cond, extra) {
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '   ' + JSON.stringify(extra)));
  if (!cond) failed++;
}

// ---- visitor ---------------------------------------------------------------
await as('anon', '', async () => {
  const p = await rows('select slug from public.projects order by slug');
  check('visitor sees only the published project', p.length === 1 && p[0].slug === 'live', p);
  const m = await rows('select public_id from public.media');
  check('visitor sees only media of published projects', m.length === 1 && m[0].public_id === 'opula/live/a', m);
  check('visitor can read categories', (await rows('select 1 from public.categories')).length === 9);

  for (const [what, sql] of [
    ['insert a project', `insert into public.projects (slug,title) values ('evil','Evil')`],
    ['publish the draft', `update public.projects set status='published' where slug='draft'`],
    ['delete a project', `delete from public.projects where slug='live'`],
    ['insert media', `insert into public.media (project_id,type,public_id,url) values ('aaaaaaaa-0000-0000-0000-000000000001','image','opula/e','x')`],
    ['edit a category', `update public.categories set name='x'`],
    ['make themselves admin', `insert into public.admins (user_id) values ('${USER}')`],
    ['read the admins table', `select * from public.admins`],
  ]) {
    const r = await denied(sql);
    check('visitor cannot ' + what, !r.ok || r.rowCount === 0, r);
  }
});

// ---- signed in, but not an admin ------------------------------------------
await as('authenticated', USER, async () => {
  check('is_admin() is false for a normal user',
    (await rows('select public.is_admin() as a'))[0].a === false);
  check('normal user still sees only published',
    (await rows('select slug from public.projects')).length === 1);
  for (const [what, sql] of [
    ['insert a project', `insert into public.projects (slug,title) values ('evil2','Evil')`],
    ['edit a project', `update public.projects set title='hacked'`],
    ['delete media', `delete from public.media`],
    ['add themselves to admins', `insert into public.admins (user_id,email) values ('${USER}','user@x.com')`],
  ]) {
    const r = await denied(sql);
    check('normal user cannot ' + what, !r.ok || r.rowCount === 0, r);
  }
  check('normal user sees no admin rows', (await rows('select * from public.admins')).length === 0);
});

// ---- admin -----------------------------------------------------------------
await as('authenticated', ADMIN, async () => {
  check('is_admin() is true for the admin',
    (await rows('select public.is_admin() as a'))[0].a === true);
  check('admin sees drafts too', (await rows('select slug from public.projects')).length === 2);
  check('admin sees all media', (await rows('select 1 from public.media')).length === 2);

  const ins = await denied(`insert into public.projects (slug,title,status) values ('new-one','New','draft')`);
  check('admin can create a project', ins.ok, ins);
  const upd = await denied(`update public.projects set status='published' where slug='draft'`);
  check('admin can publish', upd.ok && upd.rowCount === 1, upd);
  const del = await denied(`delete from public.projects where slug='new-one'`);
  check('admin can delete a project', del.ok && del.rowCount === 1, del);
  const adm = await denied(`insert into public.admins (user_id,email) values ('${USER}','user@x.com')`);
  check('even an admin cannot add admins through the API', !adm.ok || adm.rowCount === 0, adm);
});

// ---- data rules ------------------------------------------------------------
for (const [what, sql] of [
  ['rejects a slug with spaces', `insert into public.projects (slug,title) values ('Bad Slug','x')`],
  ['rejects an unknown status', `insert into public.projects (slug,title,status) values ('ok-slug','x','archived')`],
  ['rejects an unknown media layout', `insert into public.media (project_id,type,public_id,url,layout) values ('aaaaaaaa-0000-0000-0000-000000000001','image','opula/z','x','huge')`],
  ['rejects a duplicate public_id', `insert into public.media (project_id,type,public_id,url) values ('aaaaaaaa-0000-0000-0000-000000000001','image','opula/live/a','x')`],
]) {
  const r = await denied(sql);
  check('database ' + what, !r.ok, r);
}

// The website and admin name these two foreign keys in their queries
// ("media!projects_cover_fk", "media!media_project_id_fkey") because projects and
// media are linked two ways and PostgREST needs to be told which one is meant.
const fks = (await rows(`select conname from pg_constraint where conname in ('projects_cover_fk','media_project_id_fkey')`)).map((r) => r.conname).sort();
check('the foreign-key names the website queries rely on exist', fks.join() === 'media_project_id_fkey,projects_cover_fk', fks);

// deleting a project removes its media rows; the cover pointer clears itself.
await db.exec(`
  update public.projects set cover_media_id = (select id from public.media where public_id='opula/live/a') where slug='live';
  delete from public.media where public_id='opula/live/a';`);
check('deleting a cover photo clears the project cover',
  (await rows(`select cover_media_id from public.projects where slug='live'`))[0].cover_media_id === null);
await db.exec(`delete from public.projects where slug='live'`);
check('deleting a project deletes its media rows',
  (await rows(`select 1 from public.media where project_id='aaaaaaaa-0000-0000-0000-000000000001'`)).length === 0);

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
