/* ================================================================== cms ==

   Fills the gallery from Supabase, using the markup and classes the page
   already has — so nothing about the design changes; only where the pictures
   come from.

     reel     featured projects (or the newest, if none are featured)
     bento    one card per category: the cover of its best published project
     stories  published projects marked "celebration"; each opens story.html

   Safe by construction:
     - Until supabaseUrl is set in assets/config.js this file does nothing.
     - If the database cannot be reached, the sample content already in the
       HTML stays exactly as it is.
     - A section is only replaced when the database actually has something
       for it (unless showDemoContent is false — see config.js).
     - Every value from the database is escaped before it touches the page.

   The last answer is kept in localStorage so a returning visitor sees the
   real photographs on the first paint; a fresh copy is fetched every time and
   the page is updated if anything changed.
   ========================================================================= */

(function () {
  'use strict';

  const cfg = window.OPULA_CONFIG || {};
  const M = window.OpulaMedia;
  const api = (window.OpulaGallery = { configured: false });

  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !M) return;
  api.configured = true;

  const base = String(cfg.supabaseUrl).replace(/\/+$/, '');
  const KEY = 'opula:gallery:v1';
  const root = document.documentElement;
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------- helpers -- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function get(path, ms) {
    const ctl = new AbortController();
    const t = setTimeout(function () { ctl.abort(); }, ms || 8000);
    return fetch(base + '/rest/v1/' + path, {
      headers: { apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + cfg.supabaseAnonKey },
      cache: 'no-store',
      signal: ctl.signal,
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).finally(function () { clearTimeout(t); });
  }

  /* "Aanya & Dev" / "Aanya × Dev" -> ['Aanya', 'Dev']; anything else stays whole. */
  function names(title) {
    const parts = String(title).split(/\s+(?:&|×)\s+/);
    return parts.length === 2 ? parts : [String(title)];
  }

  /* -------------------------------------------------------------- queries -- */

  const COVER = 'cover:media!projects_cover_fk(id,type,public_id,url,thumb_url,width,height,duration,alt)';
  const LIST = 'projects?select=id,slug,title,is_story,featured,sort_order,created_at,location,'
    + 'category:categories(id,slug,name,sort_order),' + COVER
    + '&status=eq.published&order=sort_order.asc,created_at.desc&limit=1000';

  api.fetchList = function () { return get(LIST); };

  api.fetchProject = function (slug) {
    return get('projects?select=id,slug,title,description,location,occasion,credits,is_story,'
      + 'media:media!media_project_id_fkey(id,type,public_id,url,thumb_url,width,height,duration,alt,layout,sort_order)'
      + '&slug=eq.' + encodeURIComponent(slug)
      + '&status=eq.published&media.order=sort_order.asc&limit=1')
      .then(function (rows) { return rows[0] || null; });
  };

  api.fetchStoryOrder = function () {
    return get('projects?select=slug,title&is_story=eq.true&status=eq.published'
      + '&order=sort_order.asc,created_at.desc&limit=200');
  };

  /* ------------------------------------------------------------ selection -- */

  function hasCover(p) { return p && p.cover && (p.cover.public_id || p.cover.url || p.cover.thumb_url); }

  function pick(projects) {
    const ok = projects.filter(hasCover);

    const featured = ok.filter(function (p) { return p.featured; });
    const reel = (featured.length ? featured : ok).slice(0, 8);

    // One card per category, in the category's own order: its featured
    // project if it has one, otherwise its newest.
    const byCat = new Map();
    ok.forEach(function (p) {
      if (!p.category) return;
      const cur = byCat.get(p.category.id);
      if (!cur || (p.featured && !cur.featured)) byCat.set(p.category.id, p);
    });
    const bento = Array.from(byCat.values()).sort(function (a, b) {
      return (a.category.sort_order - b.category.sort_order) || a.category.name.localeCompare(b.category.name);
    });

    const stories = ok.filter(function (p) { return p.is_story; }).slice(0, 6);
    return { reel: reel, bento: bento, stories: stories };
  }

  /* ------------------------------------------------------------ templates -- */

  function sizes(w) { return w.join(','); }

  function reelSlide(p, i) {
    const m = p.cover, alt = esc(m.alt || p.title);
    const first = i === 0;
    if (m.type === 'video') {
      return '<video class="ed-slide' + (first ? ' is-on' : '') + '" muted loop playsinline preload="none"'
        + ' poster="' + esc(M.posterUrl(m, 1500)) + '" data-src="' + esc(M.videoUrl(m, 1280)) + '"'
        + ' aria-label="' + alt + '"></video>';
    }
    return '<img class="ed-slide' + (first ? ' is-on' : '') + '" src="' + esc(M.imageUrl(m, 1500)) + '"'
      + (M.usable(m) ? ' srcset="' + esc(M.srcset(m, [640, 960, 1500])) + '"'
        + ' sizes="(min-width: 960px) 948px, 100vw"' : '')
      + (first ? ' fetchpriority="high"' : ' loading="lazy"') + ' decoding="async" alt="' + alt + '">';
  }

  function bentoCard(p, i) {
    const m = p.cover, alt = esc(m.alt || p.title);
    const w = m.width || 760, h = m.height || 560;
    const idx = String(i + 1).padStart(2, '0');
    const inner = m.type === 'video'
      ? '<video muted loop playsinline preload="none" width="' + w + '" height="' + h + '"'
        + ' poster="' + esc(M.posterUrl(m, 900)) + '" data-src="' + esc(M.videoUrl(m, 900)) + '"'
        + ' aria-label="' + alt + '"></video>'
      : '<img src="' + esc(M.imageUrl(m, 900)) + '"'
        + (M.usable(m) ? ' srcset="' + esc(M.srcset(m, [400, 640, 900])) + '"'
          + ' sizes="(max-width:640px) 82vw, 27vw"' : '')
        + ' width="' + w + '" height="' + h + '" loading="lazy" decoding="async" alt="' + alt + '">';
    return '<figure class="bento-card"><div class="bento-media">' + inner + '</div>'
      + '<figcaption class="bento-cap"><span class="bento-index">' + idx + '</span>'
      + '<span class="bento-name">' + esc(p.category.name) + '</span>'
      + '<span class="bento-go" aria-hidden="true">&#8594;</span></figcaption></figure>';
  }

  function storyCard(p) {
    const m = p.cover;
    const n = names(p.title);
    const label = n.map(esc).join(' &times; ');
    const place = p.location ? ' <span>&#47;&#47;</span> ' + esc(p.location) + ' <span>&#47;&#47;</span>' : '';
    const img = M.imageUrl(m, 900);
    return '<figure><a class="ed-three-link" href="story.html?s=' + encodeURIComponent(p.slug) + '"'
      + ' aria-label="' + esc(n.join(' and ') + (p.location ? ' in ' + p.location : '')) + ', see the whole celebration">'
      + '<img src="' + esc(img) + '"'
      + (M.usable(m) ? ' srcset="' + esc(M.srcset(m, [400, 640, 900])) + '" sizes="(max-width:820px) 100vw, 33vw"' : '')
      + ' loading="lazy" decoding="async" alt="' + esc(m.alt || p.title) + '">'
      + '<span class="ed-three-open" aria-hidden="true">View the story &#8594;</span></a>'
      + '<figcaption>' + label + place + '</figcaption></figure>';
  }

  /* --------------------------------------------------------------- render -- */

  function section(sel) { return document.querySelector(sel); }

  function apply(box, items, build, wrapSel) {
    const el = section(box);
    const wrap = wrapSel && section(wrapSel);
    if (!el) return;
    if (items.length) {
      el.innerHTML = items.map(build).join('');
      if (wrap) wrap.hidden = false;
    } else if (cfg.showDemoContent === false) {
      el.innerHTML = '';
      if (wrap) wrap.hidden = true;
    }
    // else: leave the sample content that is already in the HTML.
  }

  function render(projects) {
    const s = pick(projects);
    apply('#edReel', s.reel, reelSlide, '.ed-reel');
    apply('.ed-bento .bento-grid', s.bento, bentoCard, '.ed-bento');
    apply('.ed-stories .ed-three', s.stories, storyCard, '.ed-stories');
    api.rendered = true;
    window.dispatchEvent(new Event('opula:gallery'));
  }

  /* ----------------------------------------------------------------- boot -- */

  const onHome = !!(section('#edReel') || section('.ed-bento'));
  if (!onHome) return;                 // e.g. story.html: only the API above is wanted

  // Hold the sample pictures back until the real ones are ready, so they are
  // never seen being replaced. The timeout is the safety net.
  root.classList.add('cms-wait');
  const release = function () { root.classList.remove('cms-wait'); };
  setTimeout(release, 3500);

  let cached = null;
  try { cached = localStorage.getItem(KEY); } catch (e) { /* private mode */ }

  let shown = null;
  if (cached) {
    try { render(JSON.parse(cached)); shown = cached; release(); } catch (e) { cached = null; }
  }

  api.fetchList().then(function (projects) {
    const text = JSON.stringify(projects);
    try { localStorage.setItem(KEY, text); } catch (e) { /* private mode / full */ }
    if (text !== shown) { render(projects); shown = text; }
  }).catch(function () {
    // Unreachable: whatever is on the page (cached photos or the samples) stays.
  }).finally(release);
})();
