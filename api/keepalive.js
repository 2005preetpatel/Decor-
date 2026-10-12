/* GET /api/keepalive

   Does one tiny read from the database (the list of category names, which is
   public anyway). Vercel calls it once a day (see "crons" in vercel.json) so
   that a free Supabase project never looks unused and never gets paused.

   It reveals nothing and changes nothing. If you set CRON_SECRET in Vercel's
   environment variables, Vercel sends it along and this refuses callers
   without it, so strangers cannot use the address to run queries. */

module.exports = async function (req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const secret = process.env.CRON_SECRET;
  if (secret && (req.headers.authorization || '') !== 'Bearer ' + secret) {
    return res.status(401).json({ ok: false });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ ok: false });
  }

  const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_ANON_KEY;
  if (!base || !key) return res.status(500).json({ ok: false, error: 'Not configured.' });

  try {
    const r = await fetch(base + '/rest/v1/categories?select=id&limit=1', {
      headers: { apikey: key, Authorization: 'Bearer ' + key },
    });
    if (!r.ok) return res.status(502).json({ ok: false, status: r.status });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ ok: false });
  }
};
