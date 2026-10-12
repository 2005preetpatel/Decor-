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
        src: esc(M.videoUrl(m, 1280)),
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

  function fromProject(p, order) {
    const frames = [];
    let pending = null;                       // a "half" waiting for its partner
    (p.media || []).forEach(function (m) {
      const half = m.layout === 'half' && m.type !== 'video';
      if (half) {
        if (pending) { frames.push([pending, frameFor(m, true, p.title)]); pending = null; }
        else pending = frameFor(m, true, p.title);
      } else {
        if (pending) { frames.push(pending); pending = null; }   // an unpaired half stands alone
        frames.push(frameFor(m, false, p.title));
      }
    });
    if (pending) frames.push(pending);

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
      names: splitNames(p.title).map(esc),
      place: esc(p.location),
      intro: esc(p.description),
      credits: credits,
      frames: frames,
      next: next,
    };
  }

  /* ---- the page ----------------------------------------------------------- */

  function figure(f, cls) {
    if (f.type === 'video') {
      return '<figure class="' + cls + '">'
           + '<video controls playsinline preload="metadata" width="' + f.w + '" height="' + f.h + '"'
           + ' poster="' + f.poster + '" aria-label="' + f.alt + '">'
           + '<source src="' + f.src + '"></video></figure>';
    }
    return '<figure class="' + cls + '">'
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
         +  '<p class="story-eyebrow">Real Celebrations</p>'
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
      if (Array.isArray(f)) {
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

  function wire() {
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
