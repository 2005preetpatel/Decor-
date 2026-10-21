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
     - With showDemoContent on (config.js), real photos come first and the
       sample content fills the remaining places, so the page never looks
       empty while content is still being added. With it off, only real
       content is shown (a section with nothing real is hidden).
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
    return get('projects?select=id,slug,title,description,location,occasion,credits,is_story,category:categories(name),'
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

  /* The reel shows photographs only. A project whose cover is a video appears
     here as a still frame from it; the video itself plays on the project page
     that opens on click. */
  function reelSlide(p, i) {
    const m = p.cover, alt = esc(m.alt || p.title);
    const first = i === 0;
    const still = m.type === 'video';
    const src = still ? M.posterUrl(m, 1500) : M.imageUrl(m, 1500);
    return '<img class="ed-slide' + (first ? ' is-on' : '') + '" data-slug="' + esc(p.slug) + '" src="' + esc(src) + '"'
      + (!still && M.usable(m) ? ' srcset="' + esc(M.srcset(m, [640, 960, 1500])) + '"'
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
    return '<figure class="bento-card" data-slug="' + esc(p.slug) + '" tabindex="0" role="link"'
      + ' aria-label="' + esc(p.title) + ', see all photos and videos"><div class="bento-media">' + inner + '</div>'
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

  /* The sample content that ships in the HTML, captured once, before anything
     has been replaced. With showDemoContent on, it fills whatever room the
     real content leaves, so the page keeps its full look from the first photo. */
  const SAMPLE = { reel: [], bento: [], stories: [] };
  const mix = cfg.showDemoContent !== false;

  function snapshot() {
    [['#edReel', 'reel'], ['.ed-bento .bento-grid', 'bento'], ['.ed-stories .ed-three', 'stories']]
      .forEach(function (pair) {
        const el = section(pair[0]);
        if (el) SAMPLE[pair[1]] = Array.prototype.map.call(el.children, function (c) { return c.cloneNode(true); });
      });
  }

  function nodes(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return Array.prototype.slice.call(t.content.children);
  }
  function copies(list) { return list.map(function (n) { return n.cloneNode(true); }); }

  function put(box, els, wrapSel) {
    const el = section(box);
    const wrap = wrapSel && section(wrapSel);
    if (!el) return;
    if (els.length) {
      el.replaceChildren.apply(el, els);
      if (wrap) wrap.hidden = false;
    } else {
      el.replaceChildren();
      if (wrap) wrap.hidden = true;     // nothing to show here (only when samples are switched off)
    }
  }

  function render(projects) {
    const s = pick(projects);

    // Slideshow: real photos first, samples fill up to six slides.
    const reelReal = [];
    s.reel.forEach(function (p, i) { nodes(reelSlide(p, i)).forEach(function (n) { reelReal.push(n); }); });
    const reelAll = reelReal.concat(mix ? copies(SAMPLE.reel).slice(0, Math.max(0, 6 - reelReal.length)) : []);
    reelAll.forEach(function (n, i) { n.classList.toggle('is-on', i === 0); });
    put('#edReel', reelAll, '.ed-reel');

    // Gallery row: a real card replaces the sample card with the same heading;
    // headings with no real project yet keep their sample card.
    const realByName = new Map();
    s.bento.forEach(function (p) { realByName.set(p.category.name.trim().toLowerCase(), nodes(bentoCard(p, 0))[0]); });
    let bentoAll = [];
    if (mix) {
      SAMPLE.bento.forEach(function (n) {
        const key = n.querySelector('.bento-name').textContent.trim().toLowerCase();
        const real = realByName.get(key);
        if (real) { bentoAll.push(real); realByName.delete(key); }
        else bentoAll.push(n.cloneNode(true));
      });
      realByName.forEach(function (n) { bentoAll.push(n); });      // categories the samples never had
    } else {
      bentoAll = s.bento.map(function (p) { return nodes(bentoCard(p, 0))[0]; });
    }
    bentoAll.forEach(function (n, i) { n.querySelector('.bento-index').textContent = String(i + 1).padStart(2, '0'); });
    put('.ed-bento .bento-grid', bentoAll, '.ed-bento');

    // Real Celebrations: real stories first, samples fill up to three.
    const storyReal = [];
    s.stories.forEach(function (p) { nodes(storyCard(p)).forEach(function (n) { storyReal.push(n); }); });
    put('.ed-stories .ed-three',
      storyReal.concat(mix ? copies(SAMPLE.stories).slice(0, Math.max(0, 3 - storyReal.length)) : []),
      '.ed-stories');

    api.rendered = true;
    window.dispatchEvent(new Event('opula:gallery'));
  }

  /* ----------------------------------------------------------------- boot -- */

  const onHome = !!(section('#edReel') || section('.ed-bento'));
  if (!onHome) return;                 // e.g. story.html: only the API above is wanted

  /* A click on a real project (the reel's current picture, or a gallery card)
     opens its page with every photo and video. Sample cards carry no slug and
     stay inert. One delegated listener, so re-rendering never needs rewiring. */
  function open(slug) { location.href = 'story.html?s=' + encodeURIComponent(slug); }
  document.addEventListener('click', function (e) {
    const card = e.target.closest && e.target.closest('.bento-card[data-slug]');
    if (card) { open(card.dataset.slug); return; }
    const stage = e.target.closest && e.target.closest('#edReel');
    const on = stage && stage.querySelector('.ed-slide.is-on[data-slug]');
    if (on) open(on.dataset.slug);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest && e.target.closest('.bento-card[data-slug]');
    if (card && card === e.target) { e.preventDefault(); open(card.dataset.slug); }
  });

  // Hold the sample pictures back until the real ones are ready, so they are
  // never seen being replaced. The timeout is the safety net.
  snapshot();                          // keep the samples before anything is replaced
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
