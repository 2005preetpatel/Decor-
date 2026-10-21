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
  supabaseUrl: 'https://bqlqgpoktlxqzuydkbww.supabase.co',
  supabaseAnonKey: 'sb_publishable_6n6cTHso5eLcCoBFeJwraQ_ECqLol8k',   // the public "publishable" key (NOT the secret / service_role key)

  // Cloudinary: Dashboard -> top-left "Cloud name"
  cloudName: 'pkhx9onz',

  // true : your real photos come FIRST and the built-in sample photos fill the
  //        remaining places (slideshow 6, gallery 9, celebrations 3), so the
  //        page keeps its full look while you are still adding projects. Each
  //        real project pushes a sample out.
  // false: show ONLY real content. Set this when you launch, so sample photos
  //        never appear next to the client's real work.
  showDemoContent: true,

  // Admin page upload limits, in megabytes. Cloudinary's FREE plan rejects
  // images over 10 MB and videos over 100 MB; raise these only on a paid plan.
  maxImageMB: 10,
  maxVideoMB: 100
};
