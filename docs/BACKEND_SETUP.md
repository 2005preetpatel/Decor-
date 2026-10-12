# Opula Decor — backend setup guide

This adds a content system to the existing website **without changing its design**.
After setup, your client signs in to `/admin.html`, uploads photos and videos,
and the website's gallery updates by itself. No HTML or JavaScript editing.

```
 Visitors ──►  Website (Vercel, static files)
                 │  read published content
                 ▼
              Supabase  (database + sign-in)  ◄── Admin page /admin.html (client signs in)
                                                      │ upload a file
                                                      ▼ asks /api for a signature (Vercel function, holds the secret)
                                                  Cloudinary  (stores + delivers the photos and videos)
```

| Part | Job | Where it lives |
|---|---|---|
| **Cloudinary** | Stores every photo and video; makes optimised versions on the fly | Cloudinary account |
| **Supabase** | Titles, descriptions, categories, links to the files, published/draft; the admin login | Supabase project |
| **`api/` functions** | Hold the Cloudinary secret; sign uploads; delete files. Only for signed-in admins | Vercel |
| **Website** | Reads published content and fills the gallery | Vercel |
| **`admin.html`** | The dashboard | Vercel |

Nothing large is ever stored in the database or bundled with the website.

---

## What is secret and what is not

| Value | Secret? | Where it goes |
|---|---|---|
| Supabase **URL** and **anon / publishable key** | No — meant to be public. The database rules protect the data. | `assets/config.js` (committed) and Vercel env vars |
| Cloudinary **cloud name** | No | `assets/config.js` |
| Cloudinary **API key** | Treat as private | Vercel env vars, local `.env` |
| Cloudinary **API secret** | **Yes** | Vercel env vars, local `.env`. **Never** in the website, in GitHub, or in a chat |
| Supabase **service_role key** | **Yes — it bypasses every rule** | Only your own computer's `.env`, only for the bulk script. **Never** on Vercel, never in `config.js` |
| Admin password | **Yes** | Only the person who owns it |

`.env` is already in `.gitignore`. If a secret is ever exposed, rotate it (Cloudinary:
Settings → API Keys; Supabase: Project Settings → API) and update Vercel.

---

## Setup, step by step

Steps marked **(you)** need you to click in a dashboard. Everything else is already in the code.

### 1. Supabase **(you)**

1. Create an account at supabase.com → **New project**. Pick a region near your visitors
   (for India: *Mumbai* / `ap-south-1`) and save the database password somewhere safe.
2. **SQL Editor → New query**. Open `supabase/schema.sql` from this repo, paste all of it, **Run**.
   (It is safe to run twice.) This creates the tables, the access rules and the nine starter categories.
3. **Project Settings → API**. Copy:
   - *Project URL* (looks like `https://abcd1234.supabase.co`)
   - the **anon / publishable** key
   - (only for bulk upload later) the **service_role** key — keep it private.
4. **Authentication → Users → Add user → Create new user**: your client's email and a strong
   password; tick *Auto Confirm User*.
5. Make that user an admin. In the **SQL Editor** run (with their email):
   ```sql
   insert into public.admins (user_id, email)
   select id, email from auth.users where email = 'client@example.com'
   on conflict (user_id) do nothing;
   ```
6. **Authentication → Sign In / Providers → Email**: switch **off** *Allow new users to sign up*.
   (Even if left on, a stranger could not do anything — only people listed in `public.admins` can — but
   there is no reason to allow it.)

> **Free plan: pausing, and how this project avoids it.** Supabase pauses a free project that has had
> no activity for about a week (your data is kept; "Restore" brings it back, but the site is down
> until then). Two free keep-alives are included, both doing one tiny read of the public category list:
>
> - `api/keepalive.js`, called once a day by Vercel (`crons` in `vercel.json`). Optional: add a
>   `CRON_SECRET` environment variable on Vercel and the address refuses everyone but Vercel.
> - `.github/workflows/keepalive.yml`, run by GitHub every two days (it reads the public values from
>   `assets/config.js`, so there is nothing to set up). GitHub turns scheduled workflows off after about
>   60 days without any activity in the repository; if that happens, open the repository's **Actions**
>   tab and re-enable it. A failed run (red cross) there is your early warning that the database is not answering.
>
> Real visitors loading the site also count as activity. None of this is a guarantee written by
> Supabase, so for a client's business site the paid Supabase plan (no pausing, backups) is the safe
> choice. Check supabase.com/pricing for current terms.
>
> **Vercel's free "Hobby" plan is for non-commercial use only.** A client's business site needs
> Vercel Pro (or another host; the website itself is plain static files and would move easily, the two
> functions in `api/` would need small changes).

### 2. Cloudinary **(you)**

1. Create an account at cloudinary.com.
2. On the dashboard note the **Cloud name** (top left).
3. **Settings → API Keys**: note the **API Key** and **API Secret**.
4. Leave *unsigned uploading* off (the default). Uploads are signed by the server.

> **File-size limits.** Cloudinary's *free* plan currently accepts photos up to about **10 MB** and
> videos up to about **100 MB** per file, and gives a monthly allowance of storage/bandwidth. Bigger
> files need a paid plan. The dashboard defaults to those free-plan limits (see `maxImageMB` /
> `maxVideoMB` in `assets/config.js`); raise them only after upgrading. Videos over 40 MB are
> uploaded in 20 MB pieces, each retried on its own, so a weak connection does not restart a big upload.

### 3. Fill in the public settings **(you)**

Open `assets/config.js` and fill in the three public values:

```js
supabaseUrl: 'https://abcd1234.supabase.co',
supabaseAnonKey: 'the anon / publishable key',
cloudName: 'your-cloud-name',
```

Until `supabaseUrl` is filled in, the website behaves exactly as before (built-in sample content, no
network calls). When it is filled in, the sample content is replaced section by section as soon as
real projects exist. To stop sample photos ever appearing at launch, set `showDemoContent: false`.

### 4. Try it on your computer **(you)**

```bash
copy .env.example .env        # (macOS/Linux: cp .env.example .env)   then fill in the 5 values
npm run dev                   # http://localhost:5176
```

Open `http://localhost:5176/admin.html`, sign in, create a category/project, upload a few files, tick
**Published**, then look at `http://localhost:5176/`.

`.env` needs: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
`CLOUDINARY_API_SECRET`. The local server runs the same `api/` functions that Vercel will.

### 5. Put it on Vercel **(you)**

1. Push the project to GitHub (already: `2005preetpatel/Decor-`).
2. vercel.com → **Add New → Project** → import that repository.
3. **Framework Preset: Other.** Leave *Build Command* and *Output Directory* empty.
4. **Environment Variables** — add all five (names exactly as below), for *Production* (and *Preview* if you use it):

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | the Project URL |
   | `SUPABASE_ANON_KEY` | the anon / publishable key |
   | `CLOUDINARY_CLOUD_NAME` | your cloud name |
   | `CLOUDINARY_API_KEY` | your API key |
   | `CLOUDINARY_API_SECRET` | your API secret |

   Do **not** add the service_role key here.
5. **Deploy.** Vercel serves the website, runs `api/sign-upload.js` and `api/delete-asset.js` as
   functions, and applies the security headers in `vercel.json` (including a strict
   Content-Security-Policy on `/admin.html`).
6. If you change an environment variable later, **redeploy** for it to take effect.
7. Add your own domain under *Settings → Domains*. In Supabase *Authentication → URL Configuration*,
   set the *Site URL* to the live address.
8. Visit `https://your-site/admin.html`, sign in, and publish something to confirm the whole chain.

`vercel.json` / `.vercelignore` keep working files (`tools`, `tests`, `supabase`, `docs`) out of a
command-line deployment. Nothing secret is in those folders in any case.

---

## How the website uses the content

One project → up to three appearances. You decide with a category, a *Featured* tick and a
*Celebration story* tick.

| On the website | Shows | Rule |
|---|---|---|
| **Slideshow** at the top of the gallery | Cover of each **Featured** project (newest published if none are featured) | up to 8 |
| **Horizontal gallery** (square cards) | One card per **category**: the cover of its featured, or newest, project | Categories appear once they have a published project, in the category *Order* |
| **Real Celebrations** + its own page | **Published** projects with **Celebration story** ticked → `story.html?s=<web address>` | up to 6 on the home page |

- A project needs a **cover** to appear in the slideshow / gallery. The first file you upload becomes
  the cover; change it with ☆/★.
- **Videos**: a video can be a cover. In the gallery cards and slideshow it plays muted and looped when
  it is on screen (and not at all if the visitor asked their device for reduced motion). On the story page
  it has normal controls and sound. Videos download only when about to be seen.
- Photos are delivered optimised (`f_auto,q_auto`, sized to the screen, lazy-loaded).
- **Story page layout**: each photo is *Wide*, *Tall*, or *Half*; two *Half* photos in a row sit side by side.
- **Drafts are invisible** to the public (the database refuses to show them, not just the page).

### Day-to-day use (for your client)

1. Sign in at `/admin.html`.
2. **+ New project** → title (for a wedding: *Aanya & Dev*), category, location, description → **Create project**.
3. Drop photos/videos in the box (many at once). Watch the progress bars. Fix anything marked red.
4. Set the cover (★), reorder with ← →, add a description to each picture if wanted.
5. Set *Status* to **Published** → **Save changes**. It is live within seconds.
6. **Unpublish** hides it again without deleting anything. **Delete** removes the project *and* its files
   from Cloudinary (it asks first).

---

## Uploading hundreds or thousands of existing files

Do not add them one by one. Use the bulk script, which runs on **your own computer**.

1. Put the files in folders — one folder per project, inside a folder per category:
   ```
   bulk/
     mandap-stage/
       aanya-dev/            ← becomes the project "Aanya Dev" (give it a nicer title in project.json)
         01-entrance.jpg
         02-mandap.jpg
         film.mp4
         project.json        ← optional: {"title":"Aanya & Dev","location":"Udaipur","occasion":"Wedding","story":true}
     tablescapes/
       ishita-rohan/ ...
   ```
   Folder names become the web addresses; capitals and spaces are cleaned up. New categories are created
   automatically. Files are ordered by name with numbers understood (`2` before `10`).
2. Put your five values **plus** `SUPABASE_SERVICE_ROLE_KEY` in your local `.env` (never commit it).
3. Look before you leap:
   ```bash
   node tools/bulk-upload.mjs bulk --dry-run
   ```
   It lists every project and file, and what would be skipped (wrong type, empty, too large).
4. Upload:
   ```bash
   node tools/bulk-upload.mjs bulk
   ```
   Options: `--publish` (default is **draft**, so you can review first), `--concurrency 6` (files at a time,
   default 4), `--flat --category <slug>` (when the folders are projects with no category level).
5. **Safe to re-run.** Files already uploaded are skipped, so you can stop it (Ctrl+C), lose your connection,
   or add more files later, and run the same command again. A report is saved as `bulk/bulk-report.json`.
6. Open the dashboard, review the drafts, set covers/featured, and publish.

Tips for very large libraries: shrink first (photos about 2000 px on the long side; videos 1080p H.264 —
HandBrake is free), run it overnight on a wired connection, and mind your Cloudinary plan's storage and
bandwidth allowance.

---

## Security, in plain words

- **Who can change anything?** Only someone who signs in *and* is listed in `public.admins`. The database
  itself enforces this (row-level security). Even someone who copies the dashboard code and edits it gets
  nothing, because the database — not the page — decides.
- **Visitors** can read published content only. They cannot read drafts, the admin list, or write anything.
- **Uploads** are signed by `api/sign-upload.js` only after the database confirms the caller is an admin.
  A signature allows one upload, into one project folder, in an allowed format, for a few minutes. The
  Cloudinary secret never reaches a browser.
- **Deleting** goes through `api/delete-asset.js`, which re-checks the caller and refuses anything outside
  the `opula/` folder.
- **No secrets in the website.** Only public values are in `assets/config.js`.
- **Admin page** is served with a strict Content-Security-Policy, `no-store`, `noindex` and cannot be framed.
  The one script it loads from a CDN is pinned to an exact version with an integrity hash.
- **Text is escaped** everywhere it is shown, so a title containing markup cannot run code.
- If you use a Supabase **custom domain**, add it to `connect-src` in `vercel.json` (it currently allows
  `https://*.supabase.co`).

---

## Checks that were run

```bash
npm test             # server functions: sign-in required, admin only, signatures, folder/format limits
npm run test:e2e     # real Chrome: public site, admin dashboard, bulk upload (needs Chrome installed)
npm install --no-save @electric-sql/pglite && node tests/rls.check.mjs    # the database rules, on a real Postgres
```

These run against **stand-ins** for Supabase and Cloudinary (`tests/mock-backend.mjs`) and against a real
Postgres for the access rules. They have **not** been run against your real Supabase, Cloudinary or Vercel
accounts, because those need your accounts. After step 5, do the first-run check in step 8 yourself:
sign in, upload one photo and one video, publish, and look at the public site on a phone as well.

### Not verified (please check on your accounts)

- Real Supabase / Cloudinary / Vercel behaviour end to end, including your plan's file-size limits.
- Video poster frames use Cloudinary's `so_10p` (10% into the clip); confirm one looks right.
- Safari and Firefox (testing was in Chrome).
- Supabase's REST syntax for the two embedded queries (`media!projects_cover_fk(...)`,
  `media!media_project_id_fkey(...)`) is standard PostgREST and the foreign-key names are checked in the
  schema test, but the first real run is the true test. If the gallery stays on sample content, open the
  browser console on the home page: a failing request will show there.

---

## Limits and good-to-know

- Supabase returns at most 1000 rows per request by default. The dashboard lists the newest 1000 projects;
  the bulk script pages through larger projects.
- Home-page gallery data is cached in the visitor's browser and refreshed on every visit, so a returning
  visitor sees content instantly and any change a moment later.
- Videos are delivered as MP4/WebM at automatic quality over normal HTTP (they start playing before they finish
  downloading). For very long films, Cloudinary's adaptive streaming (HLS) is the next upgrade.
- The first upload to a project fixes its Cloudinary folder (`opula/<web-address>`). Changing the web address
  later does not move old files, and old links to it stop working — avoid it once a project is live.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Site still shows sample photos | `assets/config.js` empty; nothing published with a cover; or a failing request (see the console) |
| "Not set up yet" on `/admin.html` | `assets/config.js` not filled in |
| "That email or password is not right" | wrong password, or the user was not created/confirmed in Supabase |
| "This account is not set up as an admin" | step 1.5 (the `insert into public.admins …`) was not run for that email |
| Upload says *Server is not configured* | one of the five environment variables is missing on Vercel (then redeploy) |
| Upload says *Too large* | over the limit in `config.js`; raise it only on a paid Cloudinary plan |
| Upload fails with *Invalid Signature* | the API secret or key on Vercel does not match the Cloudinary account |
| Thumbnails in the dashboard are blank | wrong `cloudName`, or the file is still processing (videos take a moment) |
| Project published but missing from the grid | no category chosen, or no cover |
