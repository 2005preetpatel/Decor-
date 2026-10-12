-- ============================================================================
-- Opula Decor: database schema, security rules and starter data.
--
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> paste ->
-- Run. It is safe to run again (everything is "if not exists" / "or replace").
--
-- WHO CAN DO WHAT
--   Visitors (anon)      read PUBLISHED projects and their media. Nothing else.
--   Admins (signed in)   read everything, create / edit / delete everything.
--   Everyone else        nothing. Signing up does not make anyone an admin:
--                        only a row in public.admins does, and nobody can add
--                        one from the website. You add it from this SQL editor
--                        (see the bottom of this file).
--
-- Files are NOT stored here. Photos and videos live on Cloudinary; this only
-- keeps their addresses and the text around them.
-- ============================================================================

-- gen_random_uuid() is built into Postgres 13+, so no extension is needed.

-- ---------------------------------------------------------------- admins ----
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

-- True when the signed-in user is listed in public.admins. SECURITY DEFINER so
-- the policies below can ask the question without every visitor being allowed
-- to read the admins table.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ------------------------------------------------------------- categories ---
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique
             check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name       text not null check (char_length(name) between 1 and 80),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------- projects ---
create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique
                check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  title         text not null check (char_length(title) between 1 and 160),
  description   text not null default '' check (char_length(description) <= 4000),
  category_id   uuid references public.categories (id) on delete set null,

  -- "Real Celebrations": a project with its own page (story.html?s=<slug>).
  is_story      boolean not null default false,
  location      text not null default '' check (char_length(location) <= 120),
  occasion      text not null default '' check (char_length(occasion) <= 120),
  -- Extra credit lines on the story page, as [["Photography","Name"], ...].
  credits       jsonb not null default '[]'::jsonb,

  featured      boolean not null default false,
  status        text not null default 'draft'
                check (status in ('draft', 'published')),
  sort_order    integer not null default 0,
  cover_media_id uuid,                     -- foreign key added below

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists projects_listing_idx
  on public.projects (status, sort_order, created_at desc);
create index if not exists projects_category_idx
  on public.projects (category_id);

-- ------------------------------------------------------------------ media ---
create table if not exists public.media (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  type          text not null check (type in ('image', 'video')),

  -- Cloudinary. public_id is what the website builds optimised URLs from, so
  -- sizes and formats can change later without touching the database.
  public_id     text not null unique,
  url           text not null,             -- original (secure_url)
  thumb_url     text,                      -- still image; for a video, a frame
  width         integer,
  height        integer,
  duration      numeric,                   -- seconds, videos only
  bytes         bigint,
  format        text,

  alt           text not null default '' check (char_length(alt) <= 300),
  -- Story page layout. wide = full width, tall = full width and taller,
  -- half = shares a row with the next "half".
  layout        text not null default 'wide'
                check (layout in ('wide', 'tall', 'half')),
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists media_project_idx
  on public.media (project_id, sort_order);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_cover_fk') then
    alter table public.projects
      add constraint projects_cover_fk
      foreign key (cover_media_id) references public.media (id) on delete set null;
  end if;
end $$;

-- ------------------------------------------------------------ updated_at ----
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch
  before update on public.projects
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- security --
alter table public.admins     enable row level security;
alter table public.categories enable row level security;
alter table public.projects   enable row level security;
alter table public.media      enable row level security;

-- Start from nothing, then grant exactly what is needed. Supabase's defaults
-- hand every table to anon/authenticated and rely on RLS alone; removing the
-- write privileges from anon means a mistake in a policy still cannot let a
-- visitor write.
revoke all on public.admins, public.categories, public.projects, public.media
  from anon, authenticated;

grant select on public.categories, public.projects, public.media to anon, authenticated;
grant insert, update, delete on public.categories, public.projects, public.media to authenticated;
grant select on public.admins to authenticated;

-- admins: you can see only your own row. There is no insert/update/delete
-- policy, so nobody can make themselves an admin through the API.
drop policy if exists "read own admin row" on public.admins;
create policy "read own admin row" on public.admins
  for select to authenticated
  using (user_id = auth.uid());

-- categories: public to read, admins to change.
drop policy if exists "categories are public" on public.categories;
create policy "categories are public" on public.categories
  for select to anon, authenticated
  using (true);

drop policy if exists "admins change categories" on public.categories;
create policy "admins change categories" on public.categories
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- projects: visitors see published ones only; admins see and change all.
drop policy if exists "published projects are public" on public.projects;
create policy "published projects are public" on public.projects
  for select to anon, authenticated
  using (status = 'published' or public.is_admin());

drop policy if exists "admins change projects" on public.projects;
create policy "admins change projects" on public.projects
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- media: visible exactly when its project is visible.
drop policy if exists "media of published projects is public" on public.media;
create policy "media of published projects is public" on public.media
  for select to anon, authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.projects p
      where p.id = media.project_id and p.status = 'published'
    )
  );

drop policy if exists "admins change media" on public.media;
create policy "admins change media" on public.media
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ------------------------------------------------------------- starter data -
-- The nine headings the gallery already uses. Rename, reorder or delete them
-- later from the admin dashboard.
insert into public.categories (slug, name, sort_order) values
  ('mandap-stage',        'Mandap & Stage',     10),
  ('tablescapes',         'Tablescapes',        20),
  ('drapery-ceiling',     'Drapery & Ceiling',  30),
  ('floral-walls',        'Floral Walls',       40),
  ('candlelight',         'Candlelight',        50),
  ('stage-lighting',      'Stage Lighting',     60),
  ('balloon-arches',      'Balloon Arches',     70),
  ('celebration-tables',  'Celebration Tables', 80),
  ('bouquets',            'Bouquets',           90)
on conflict (slug) do nothing;

-- ----------------------------------------------------- make someone an admin
-- 1. Authentication -> Users -> Add user (email + password) for your client.
--    Tick "Auto Confirm User".
-- 2. Run this, with their email, in the SQL editor:
--
--    insert into public.admins (user_id, email)
--    select id, email from auth.users where email = 'client@example.com'
--    on conflict (user_id) do nothing;
--
-- 3. Also switch OFF "Allow new users to sign up" in Authentication ->
--    Providers -> Email (or Sign In / Up), so strangers cannot create accounts.
--    (They still could not do anything without a row in public.admins.)
