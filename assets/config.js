/* Public settings for the website and the admin page.

   Everything in this file is safe to publish: the Supabase "anon / publishable"
   key and the Cloudinary cloud name are meant to be in the browser. What keeps
   the data safe is the set of access rules in supabase/schema.sql, not the
   secrecy of these values.

   NEVER put any of these here:  the Supabase service_role key, the Cloudinary
   API secret, or an admin password. Those belong in environment variables on
   Vercel (and in a local .env for the bulk-upload script) — see
   docs/BACKEND_SETUP.md.

   While supabaseUrl is empty the site behaves exactly as it did before: it
   shows the built-in sample content and makes no network calls. */

window.OPULA_CONFIG = {
  // Supabase: Project Settings -> API
  supabaseUrl: '',          // e.g. https://abcdxyz.supabase.co
  supabaseAnonKey: '',      // the "anon" / "publishable" key (NOT service_role)

  // Cloudinary: Dashboard -> top-left "Cloud name"
  cloudName: '',

  // When the database has nothing published for a section, keep showing the
  // built-in sample content there? Set to false at launch so sample photos
  // never appear next to the client's real work.
  showDemoContent: true,

  // Admin page upload limits, in megabytes. Cloudinary's FREE plan rejects
  // images over 10 MB and videos over 100 MB; raise these only on a paid plan.
  maxImageMB: 10,
  maxVideoMB: 100
};
