/* ================================================================== story ==

   Builds a celebration page from the entry named by the `s` query parameter.

   Two sources, in this order:
     1. the database (assets/cms.js), when it is configured and has a
        published project with that slug;
     2. the built-in samples in assets/story-data.js.
   Either way the page is built from the same shape, so the layout is one
   piece of code.

   No GSAP here on purpose. The home page needs it for the pinned hero; this
   page is a stack of photographs and a scroll listener, and pulling two CDN
   scripts in for a fade would be the tail wagging the dog.
   ========================================================================= */

(function story() {
  const key = new URLSearchParams(location.search).get('s');
  const root = document.getElementById('storyRoot');
  if (!root) return;

  const M = window.OpulaMedia;
  const cms = window.OpulaGallery;

  /* Values that come from the database are escaped here, once, so the builder
     below can treat everything as ready-made HTML (the built-in samples
     contain entities such as &amp; on purpose). */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function splitNames(title) {
    const parts = String(title).split(/\s+(?:&|×)\s+/);
    return parts.length === 2 ? parts : [String(title)];
  }

  /* ---- the built-in samples ---------------------------------------------- */

  function fromStatic() {
    const data = key && typeof STORIES !== 'undefined' && STORIES[key];
    if (!data) return null;
    const at = STORY_ORDER.indexOf(key);
    const nextKey = STORY_ORDER[(at + 1) % STORY_ORDER.length];
    const nextData = STORIES[nextKey];
    return {
      names: data.names,
      place: data.place,
      intro: data.intro,
      credits: data.credits,
      frames: data.frames.map(function (f) {
        return Array.isArray(f) ? f.map(asImage) : asImage(f);
      }),
      next: nextKey !== key ? { key: nextKey, names: nextData.names } : null,
    };
  }

  function asImage(f) {
    return { type: 'image', src: f.src, w: f.w, h: f.h, alt: f.alt };
  }

  /* ---- a project from the database --------------------------------------- */

  function frameFor(m, half, title) {
    const alt = esc(m.alt || title);
    if (m.type === 'video') {
      return {
        type: 'video',
        src: esc(M.videoUrl(m, 1920)),
        poster: esc(M.posterUrl(m, 1200)),
        w: m.width || 1920, h: m.height || 1080, alt: alt,
      };
    }
    return {
      type: 'image',
      src: esc(M.imageUrl(m, half ? 900 : 1600)),
      srcset: M.usable(m) ? esc(M.srcset(m, half ? [450, 700, 900] : [640, 1000, 1600])) : '',
      sizes: half ? '(min-width: 900px) 350px, 50vw' : '(min-width: 900px) 700px, 100vw',
      w: m.width || 1800, h: m.height || 1200, alt: alt,
    };
  }

  /* Photographs are packed into rows of equal height, edge to edge: a row is
     closed once its pictures add up to a full line (their width/height ratios
     sum to ROW_FULL), so a portrait and a landscape sit side by side and the
     row stays straight. A video, or a photo set to Big, takes a row to itself.
     A last row that is not full is kept narrower rather than stretched. */
  const ROW_FULL = 1.8, ROW_CLOSE = 1.8;

  function justify(media, title) {
    const rows = [];
    let row = [], sum = 0;
    function flush() {
      if (!row.length) return;
      rows.push({ row: row, sum: sum });
      row = []; sum = 0;
    }
    media.forEach(function (m) {
      if (m.type === 'video') {
        flush();
        rows.push(frameFor(m, false, title));            // its own full-width row
        return;
      }
      if (m.layout === 'tall') {                         // Big: alone, never taller than ~56rem
        flush();
        const b = frameFor(m, false, title);
        b.r = Math.max(0.3, Math.min(4, b.w / b.h));
        rows.push({ row: [b], sum: Math.min(ROW_FULL, b.r * 56 / 80 * ROW_FULL) });
        return;
      }
      const f = frameFor(m, false, title);
      f.r = Math.max(0.3, Math.min(4, f.w / f.h));
      row.push(f); sum += f.r;
      if (sum >= ROW_CLOSE) flush();
    });
    flush();
    return rows.map(function (x) {
      if (!x.row) return x;
      x.row.forEach(function (f) {
        const share = f.r / x.sum, cap = Math.min(1, x.sum / ROW_FULL);
        f.sizes = '(min-width: 1300px) ' + Math.round(1200 * cap * share) + 'px, ' + Math.round(100 * cap * share) + 'vw';
      });
      return { row: x.row, width: Math.min(100, Math.round(x.sum / ROW_FULL * 1000) / 10) };
    });
  }

  function fromProject(p, order) {
    const frames = justify(p.media || [], p.title);

    const credits = [['Décor', 'Opula Decor']];
    if (p.location) credits.push(['Venue', esc(p.location)]);
    if (p.occasion) credits.push(['Occasion', esc(p.occasion)]);
    (Array.isArray(p.credits) ? p.credits : []).forEach(function (c) {
      if (Array.isArray(c) && c[0] && c[1]) credits.push([esc(c[0]), esc(c[1])]);
    });

    let next = null;
    const slugs = (order || []).map(function (o) { return o.slug; });
    const at = slugs.indexOf(p.slug);
    if (slugs.length > 1 && at !== -1) {
      const n = order[(at + 1) % order.length];
      next = { key: n.slug, names: splitNames(n.title).map(esc) };
    }

    return {
      eyebrow: p.is_story ? 'Real Celebrations' : esc(p.category && p.category.name || 'Our work'),
      names: splitNames(p.title).map(esc),
      place: esc(p.location),
      intro: esc(p.description),
      credits: credits,
      frames: frames,
      next: next,
    };
  }

  /* ---- the page ----------------------------------------------------------- */

  function figure(f, cls, style) {
    if (f.type === 'video') {
      return '<figure class="' + cls + '"' + (style ? ' style="' + style + '"' : '') + '>'
           + '<video controls playsinline preload="metadata" width="' + f.w + '" height="' + f.h + '"'
           + ' poster="' + f.poster + '" aria-label="' + f.alt + '">'
           + '<source src="' + f.src + '"></video></figure>';
    }
    return '<figure class="' + cls + '"' + (style ? ' style="' + style + '"' : '') + '>'
         + '<img src="' + f.src + '"'
         + (f.srcset ? ' srcset="' + f.srcset + '" sizes="' + f.sizes + '"' : '')
         + ' width="' + f.w + '" height="' + f.h + '"'
         + ' loading="lazy" decoding="async" alt="' + f.alt + '">'
         + '</figure>';
  }

  function notFound() {
    // A bad or missing key should read as a wrong turn, not a blank page.
    root.innerHTML =
      '<section class="story-head">'
      + '<p class="story-eyebrow">Not found</p>'
      + '<h1 class="story-title">That celebration<em> is not here.</em></h1>'
      + '<p class="story-intro">The link may be out of date. Everything we have '
      + 'is on the gallery.</p>'
      + '<p class="story-nav"><a class="story-link" href="index.html#work">'
      + 'Back to the gallery</a></p>'
      + '</section>';
    document.title = 'Not found — Opula Decor';
  }

  function show(data) {
    if (!data) { notFound(); return; }

    const plain = function (s) { return String(s).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&'); };
    const nameText = data.names.map(plain);
    document.title = nameText.join(' × ') + ' — Opula Decor';
    const desc = document.querySelector('meta[name="description"]');
    if (desc) {
      desc.setAttribute('content',
        nameText.join(' and ') + (data.place ? ' in ' + plain(data.place) : '') + '. ' + plain(data.intro));
    }

    let html = '';

    // ---- the banner ---------------------------------------------------------
    html += '<section class="story-head">'
         +  '<p class="story-eyebrow">' + (data.eyebrow || 'Real Celebrations') + '</p>'
         +  '<h1 class="story-title">' + data.names[0]
         +  (data.names[1] ? '<em> &amp; </em>' + data.names[1] : '') + '</h1>'
         +  (data.place ? '<p class="story-place">' + data.place + '</p>' : '')
         +  (data.intro ? '<p class="story-intro">' + data.intro + '</p>' : '')
         +  '<dl class="story-credits">'
         +  data.credits.map(function (c) {
              return '<div><dt>' + c[0] + '</dt><dd>' + c[1] + '</dd></div>';
            }).join('')
         +  '</dl>'
         +  '</section>';

    // ---- the frames ---------------------------------------------------------
    html += '<section class="story-frames">';
    data.frames.forEach(function (f) {
      if (f.row) {
        html += '<div class="story-row" style="max-width:' + f.width + '%">'
             +  f.row.map(function (x) { return figure(x, 'story-frame', 'flex:' + x.r.toFixed(3) + ' 1 0%'); }).join('')
             +  '</div>';
      } else if (Array.isArray(f)) {
        html += '<div class="story-pair">'
             +  f.map(function (x) { return figure(x, 'story-frame'); }).join('')
             +  '</div>';
      } else {
        html += figure(f, 'story-frame story-frame-wide');
      }
    });
    html += '</section>';

    // ---- what comes next ----------------------------------------------------
    html += '<section class="story-end">';
    if (data.next) {
      html += '<p class="story-eyebrow">Next</p>'
           +  '<a class="story-next" href="story.html?s=' + encodeURIComponent(data.next.key) + '">'
           +  data.next.names[0] + (data.next.names[1] ? '<em> &amp; </em>' + data.next.names[1] : '')
           +  '<span class="story-next-arrow" aria-hidden="true">&#8594;</span></a>';
    }
    html += '<p class="story-nav"><a class="story-link" href="index.html#work">'
         +  'All celebrations</a></p>'
         +  '</section>';

    root.innerHTML = html;
    wire();
  }

  /* ---- behaviour ----------------------------------------------------------- */

  /* ---- full-screen viewer --------------------------------------------------
     Click a photograph to see it large; arrows, keyboard and swipe move
     between the photographs of this page, Esc closes. Built once, on demand. */
  function viewer() {
    let box = null, img, count, at = 0, list = [], opener = null, x0 = null;

    function big(src) {                           // a larger Cloudinary rendition
      return src.replace(/(\/upload\/[^\/]*,)w_\d+\//, '$1w_2400/');
    }
    function show(i) {
      at = (i + list.length) % list.length;
      const el = list[at];
      img.classList.remove('is-in');
      img.alt = el.alt || '';
      img.onload = function () { img.classList.add('is-in'); };
      // The picture already on the page appears at once; the larger rendition
      // is fetched behind it and swapped in when it has arrived.
      const here = at, now = el.currentSrc || el.src, hi = big(now);
      img.src = now;
      if (hi !== now) {
        const up = new Image();
        up.onload = function () { if (at === here) img.src = hi; };
        up.src = hi;
      }
      count.textContent = (at + 1) + ' / ' + list.length;
    }
    function key(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') show(at + 1);
      else if (e.key === 'ArrowLeft') show(at - 1);
      else if (e.key === 'Tab') { e.preventDefault(); box.querySelector('.lb-close').focus(); }   // keep focus inside
    }
    function close() {
      if (!box || box.hidden) return;
      box.hidden = true;
      document.documentElement.classList.remove('lb-open');
      document.removeEventListener('keydown', key);
      if (opener && opener.focus) opener.focus();
    }
    function build() {
      box = document.createElement('div');
      box.className = 'lb';
      box.hidden = true;
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', 'Photograph viewer');
      box.innerHTML = '<button class="lb-close" type="button" aria-label="Close">&times;</button>'
        + '<button class="lb-nav lb-prev" type="button" aria-label="Previous photograph">&#8592;</button>'
        + '<img class="lb-img" alt="">'
        + '<button class="lb-nav lb-next" type="button" aria-label="Next photograph">&#8594;</button>'
        + '<p class="lb-count" aria-live="polite"></p>';
      img = box.querySelector('.lb-img');
      count = box.querySelector('.lb-count');
      box.addEventListener('click', function (e) {
        if (e.target.closest('.lb-prev')) show(at - 1);
        else if (e.target.closest('.lb-next')) show(at + 1);
        else if (e.target !== img) close();          // backdrop or the close button
      });
      box.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
      box.addEventListener('touchend', function (e) {
        if (x0 == null) return;
        const dx = e.changedTouches[0].clientX - x0; x0 = null;
        if (Math.abs(dx) > 50) show(at + (dx < 0 ? 1 : -1));
      });
      document.body.appendChild(box);
    }
    return function open(el) {
      if (!box) build();
      list = [].slice.call(root.querySelectorAll('.story-frame img'));
      const i = list.indexOf(el);
      if (i < 0) return;
      opener = el;
      box.hidden = false;
      box.querySelectorAll('.lb-nav').forEach(function (b) { b.hidden = list.length < 2; });
      document.documentElement.classList.add('lb-open');
      document.addEventListener('keydown', key);
      show(i);
      box.querySelector('.lb-close').focus();
    };
  }

  function wire() {
    if (!wire.viewerDone) {
      wire.viewerDone = true;
      const open = viewer();
      root.addEventListener('click', function (e) {
        const el = e.target.closest && e.target.closest('.story-frame img');
        if (el) open(el);
      });
    }
    /* ---- the capsule over the footer's ink band ------------------------- */
    const pill = document.querySelector('.nav-pill');
    const ink = document.querySelector('.foot-dark');
    if (pill && ink && !wire.inkDone) {
      wire.inkDone = true;
      let inkLast = 0;
      function inkPass() {
        const r = ink.getBoundingClientRect();
        // The pill sits ~0.85rem down, so it crosses onto the dark band a
        // little before the band reaches the top of the viewport.
        pill.classList.toggle('on-ink', r.top < 64 && r.bottom > 0);
      }
      // Same reasoning as below: a clock, not a frame.
      function inkSchedule() {
        const now = Date.now();
        if (now - inkLast < 80) return;
        inkLast = now;
        inkPass();
      }
      window.addEventListener('scroll', inkSchedule, { passive: true });
      window.addEventListener('resize', inkSchedule);
      inkPass();
    }

    /* ---- frames rise as they arrive ------------------------------------------

       A scroll listener with getBoundingClientRect, not an IntersectionObserver.
       The observer is the more fashionable tool and it is the one that failed
       silently elsewhere on this site — it can be slow to deliver its first
       callback, or never deliver at all, in embedded and throttled views, and
       the whole reveal hangs off it. A rect read on a passive scroll listener
       cannot fail to arrive. */
    const frames = [].slice.call(root.querySelectorAll('.story-frame'));
    if (!frames.length) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      frames.forEach(function (f) { f.classList.add('is-in'); });
      return;
    }

    let last = 0;
    let waiting = frames.slice();

    function pass() {
      const limit = window.innerHeight * 0.88;
      waiting = waiting.filter(function (f) {
        if (f.getBoundingClientRect().top < limit) {
          f.classList.add('is-in');
          return false;             // settled; stop measuring it
        }
        return true;
      });
      if (!waiting.length) {
        window.removeEventListener('scroll', schedule);
        window.removeEventListener('resize', schedule);
      }
    }

    /* Throttled on a clock, not on requestAnimationFrame.

       rAF is the usual way to coalesce scroll work and it is the wrong one
       here: a view that is not compositing — a hidden tab, an embedded pane,
       a backgrounded window — stops delivering frames, and every queued pass
       dies with them. That is precisely the situation this listener exists to
       survive, so it must not depend on a frame ever arriving. A timestamp
       check costs nothing and always runs. */
    function schedule() {
      const now = Date.now();
      if (now - last < 80) return;
      last = now;
      pass();
    }

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    pass();
  }

  /* ---- start ------------------------------------------------------------------ */

  if (cms && cms.configured && key && M) {
    Promise.all([cms.fetchProject(key), cms.fetchStoryOrder()])
      .then(function (r) { show(r[0] ? fromProject(r[0], r[1]) : fromStatic()); })
      .catch(function () { show(fromStatic()); });
  } else {
    show(fromStatic());
  }

})();
