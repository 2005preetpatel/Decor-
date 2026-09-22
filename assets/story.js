/* ================================================================== story ==

   Builds a celebration page from the entry named by the `s` query parameter.

   No GSAP here on purpose. The home page needs it for the pinned hero; this
   page is a stack of photographs and a scroll listener, and pulling two CDN
   scripts in for a fade would be the tail wagging the dog.
   ========================================================================= */

(function story() {
  const key = new URLSearchParams(location.search).get('s');
  const data = key && STORIES[key];
  const root = document.getElementById('storyRoot');
  if (!root) return;

  // A bad or missing key should read as a wrong turn, not a blank page.
  if (!data) {
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
    return;
  }

  document.title = data.names.join(' × ') + ' — Opula Decor';
  const desc = document.querySelector('meta[name="description"]');
  if (desc) {
    desc.setAttribute('content',
      data.names.join(' and ') + ' in ' + data.place + '. ' + data.intro);
  }

  function img(f, cls) {
    return '<figure class="' + cls + '">'
         + '<img src="' + f.src + '" width="' + f.w + '" height="' + f.h + '"'
         + ' loading="lazy" decoding="async" alt="' + f.alt + '">'
         + '</figure>';
  }

  let html = '';

  // ---- the banner -------------------------------------------------------
  html += '<section class="story-head">'
       +  '<p class="story-eyebrow">Real Celebrations</p>'
       +  '<h1 class="story-title">' + data.names[0]
       +  '<em> &amp; </em>' + data.names[1] + '</h1>'
       +  '<p class="story-place">' + data.place + '</p>'
       +  '<p class="story-intro">' + data.intro + '</p>'
       +  '<dl class="story-credits">'
       +  data.credits.map(function (c) {
            return '<div><dt>' + c[0] + '</dt><dd>' + c[1] + '</dd></div>';
          }).join('')
       +  '</dl>'
       +  '</section>';

  // ---- the frames -------------------------------------------------------
  html += '<section class="story-frames">';
  data.frames.forEach(function (f) {
    if (Array.isArray(f)) {
      html += '<div class="story-pair">'
           +  f.map(function (x) { return img(x, 'story-frame'); }).join('')
           +  '</div>';
    } else {
      html += img(f, 'story-frame story-frame-wide');
    }
  });
  html += '</section>';

  // ---- what comes next --------------------------------------------------
  const at = STORY_ORDER.indexOf(key);
  const next = STORY_ORDER[(at + 1) % STORY_ORDER.length];
  const nextData = STORIES[next];

  html += '<section class="story-end">'
       +  '<p class="story-eyebrow">Next</p>'
       +  '<a class="story-next" href="story.html?s=' + next + '">'
       +  nextData.names[0] + '<em> &amp; </em>' + nextData.names[1]
       +  '<span class="story-next-arrow" aria-hidden="true">&#8594;</span></a>'
       +  '<p class="story-nav"><a class="story-link" href="index.html#work">'
       +  'All celebrations</a></p>'
       +  '</section>';

  root.innerHTML = html;

  /* ---- the capsule over the footer's ink band --------------------------- */
  const pill = document.querySelector('.nav-pill');
  const ink = document.querySelector('.foot-dark');
  if (pill && ink) {
    let inkLast = 0;
    function inkPass() {
      const r = ink.getBoundingClientRect();
      // The pill sits ~0.85rem down, so it crosses onto the dark band a
      // little before the band reaches the top of the viewport.
      pill.classList.toggle('on-ink', r.top < 64 && r.bottom > 0);
    }
    // Same reasoning as above: a clock, not a frame.
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
  /* ---- frames rise as they arrive --------------------------------------

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

})();
