/* End-to-end check of the PUBLIC website against the mock backend:
   the gallery fills from the database, drafts stay hidden, videos and the
   story page work, and the site still behaves with the database down.

     node tests/mock-backend.mjs is NOT needed; this starts its own.
     (the site itself must be running:  node server.js  on :5176)            */

import fs from 'node:fs';
import { startMock } from './mock-backend.mjs';
import { launch, check, failures, sleep } from './cdp.mjs';

const SITE = process.env.SITE || 'http://localhost:5176';
const OUT = process.env.SHOTS || '.';

const mock = await startMock();
const { db } = mock;
const IMG = SITE + '/assets/hero-plate.jpg';
const VID = SITE + '/videos/palace-archway.mp4';

function addProject(slug, title, o = {}) {
  const p = {
    id: crypto.randomUUID(), slug, title, description: o.description || '', location: o.location || '', occasion: o.occasion || '',
    credits: o.credits || [], is_story: !!o.story, featured: !!o.featured, status: o.status || 'published',
    sort_order: o.sort ?? 0, category_id: o.cat ? db.categories.find((c) => c.slug === o.cat).id : null,
    created_at: new Date(Date.now() - (o.age || 0) * 1000).toISOString(), updated_at: new Date().toISOString(), cover_media_id: null,
  };
  db.projects.push(p);
  (o.media || ['image']).forEach((kind, i) => {
    const m = {
      id: crypto.randomUUID(), project_id: p.id, type: kind === 'video' ? 'video' : 'image', public_id: `opula/${slug}/m${i}`,
      url: kind === 'video' ? VID : IMG + '?n=' + slug + i, thumb_url: IMG + '?t=' + slug + i, width: 1600, height: 1067, duration: null,
      alt: '', layout: kind === 'half' ? 'half' : 'wide', sort_order: i, created_at: new Date().toISOString(),
    };
    db.media.push(m); if (i === 0) p.cover_media_id = m.id;
  });
  return p;
}

// One project in every category, so the bento row has nine cards and pins.
db.categories.forEach((c, i) => addProject('proj-' + c.slug, 'Project ' + (i + 1), { cat: c.slug, featured: i < 3, age: i, media: i === 6 ? ['video'] : ['image'] }));
addProject('aanya-dev', 'Aanya & Dev', {
  cat: 'mandap-stage', story: true, location: 'Udaipur', occasion: 'Wedding', description: 'A palace courtyard.',
  credits: [['Photography', 'Studio X']], media: ['image', 'half', 'half', 'video', 'image', 'half'], age: -10,
});
addProject('hidden-draft', 'Secret draft', { cat: 'bouquets', status: 'draft', story: true });
addProject('xss', '<img src=x onerror=window.__xss=1>', { cat: 'candlelight', story: true, location: '"><script>window.__xss=2</script>', age: -5 });

const page = await launch();
const configJs = `window.OPULA_CONFIG = { supabaseUrl: '${mock.url}', supabaseAnonKey: 'anon-key', cloudName: '', showDemoContent: true, maxImageMB: 10, maxVideoMB: 100 };`;
await page.replace('assets/config.js', configJs);

/* ------------------------------------------------------------------ home -- */
await page.goto(SITE + '/', 4500);
const home = await page.eval(`(() => {
  const slides = [...document.querySelectorAll('#edReel .ed-slide')];
  const cards = [...document.querySelectorAll('.ed-bento .bento-card')];
  const stories = [...document.querySelectorAll('.ed-stories .ed-three figure')];
  return {
    waiting: document.documentElement.classList.contains('cms-wait'),
    slides: slides.length, firstOn: slides[0] && slides[0].classList.contains('is-on'),
    cards: cards.length, names: cards.map(c => c.querySelector('.bento-name').textContent),
    index: cards.map(c => c.querySelector('.bento-index').textContent).join(','),
    videoCards: cards.filter(c => c.querySelector('video')).length,
    stories: stories.length, storyLinks: stories.map(f => f.querySelector('a').getAttribute('href')),
    storyCaptions: stories.map(f => f.querySelector('figcaption').textContent.replace(/\\s+/g,' ').trim()),
    pinned: ScrollTrigger.getAll().some(s => s.pin && s.trigger && s.trigger.classList.contains('ed-bento')),
    html: document.body.innerHTML.includes('Secret draft'),
    xss: window.__xss || 0,
    sampleStillThere: document.body.innerHTML.includes('images.unsplash.com/photo-1587271407850'),
  };
})()`);

check('page is released (not stuck hidden)', home.waiting === false, home);
check('reel shows the featured projects only', home.slides === 3 && home.firstOn, home);
check('bento: one card per category, in category order', home.cards === 9 && home.names[0] === 'Mandap & Stage' && home.names[8] === 'Bouquets', home.names);
check('bento: numbered 01..09', home.index === '01,02,03,04,05,06,07,08,09', home.index);
check('bento: a video cover renders as a video card', home.videoCards === 1, home.videoCards);
check('bento still pins (9 cards need to slide)', home.pinned === true, home);
check('stories: only published "celebration" projects, linking to their page', home.stories === 2 && home.storyLinks.includes('story.html?s=aanya-dev'), home);
check('story caption keeps the existing look (names × place //)', /Aanya × Dev.*Udaipur/.test(home.storyCaptions.join('|')), home.storyCaptions);
check('a draft never appears anywhere', home.html === false);
check('script in a title / location is shown as text, never run', home.xss === 0, home.xss);
check('the built-in sample photos are gone once real content is there', home.sampleStillThere === false);

// the pinned row still slides after the swap
const st = await page.eval(`(() => { const s = ScrollTrigger.getAll().find(x => x.pin && x.trigger && x.trigger.classList.contains('ed-bento')); return { a: s.start, b: s.end }; })()`);
await page.scrollTo((st.a + st.b) / 2, 1800);
const mid = await page.eval(`({ x: Math.round(gsap.getProperty(document.querySelector('.bento-grid'), 'x')), pos: getComputedStyle(document.querySelector('.ed-bento')).position })`);
check('row slides right-to-left while pinned after the swap', mid.x < -300 && mid.pos === 'fixed', mid);
await page.shot(OUT + '/e2e-bento-mid.jpg', fs);

// the reel: a video slide plays only when it is the visible one
await page.scrollTo(0, 800);
const reelTop = await page.eval(`document.querySelector('.ed-reel').getBoundingClientRect().top + scrollY - 100`);
await page.scrollTo(reelTop, 800);
const reel0 = await page.eval(`(() => { const v = document.querySelector('#edReel video'); return { hasVideo: !!v, playing: v ? !v.paused : null }; })()`);
check('reel: still images only here (3 featured are photos)', reel0.hasVideo === false, reel0);

check('no JavaScript errors on the home page', page.logs.filter((l) => l.startsWith('EXCEPTION')).length === 0, page.logs);

/* ------------------------------------------------------------ story page -- */
await page.goto(SITE + '/story.html?s=aanya-dev', 3500);
const story = await page.eval(`(() => ({
  title: document.title, h1: document.querySelector('.story-title').textContent,
  place: (document.querySelector('.story-place') || {}).textContent,
  credits: [...document.querySelectorAll('.story-credits dt')].map(d => d.textContent + ':' + d.nextElementSibling.textContent),
  frames: document.querySelectorAll('.story-frame').length,
  pairs: document.querySelectorAll('.story-pair').length,
  videos: document.querySelectorAll('.story-frame video').length,
  videoControls: !!document.querySelector('.story-frame video[controls]'),
  nextHref: (document.querySelector('.story-next') || {}).getAttribute && document.querySelector('.story-next').getAttribute('href'),
}))()`);
check('story page: built from the database', /Aanya\s*&\s*Dev/.test(story.h1) && story.place === 'Udaipur', story);
check('story page: credits include venue, occasion and the extras', story.credits.includes('Venue:Udaipur') && story.credits.includes('Photography:Studio X'), story.credits);
check('story page: "half" photos pair up; a lone half stands alone (6 figures: wide, pair of 2, video, wide, lone half)', story.pairs === 1 && story.frames === 6, story);
check('story page: a video frame with controls', story.videos === 1 && story.videoControls, story);
check('story page: "Next" points at another published celebration', /story\.html\?s=/.test(story.nextHref || '') && !/aanya-dev/.test(story.nextHref), story.nextHref);

await page.goto(SITE + '/story.html?s=hidden-draft', 2500);
const nf = await page.eval(`document.querySelector('.story-title').textContent`);
check('a draft project\'s page says "not here" (cannot be opened by link)', /not here/.test(nf), nf);

await page.goto(SITE + '/story.html?s=xss', 2500);
const xss2 = await page.eval(`({ x: window.__xss || 0, h1: document.querySelector('.story-title').textContent })`);
check('story page escapes titles and locations', xss2.x === 0 && /<img/.test(xss2.h1), xss2);

// the sample stories still open when the database does not know the slug
await page.goto(SITE + '/story.html?s=ishita-rohan', 2500);
const fallbackStory = await page.eval(`document.querySelector('.story-title').textContent`);
check('built-in sample story still opens', /Ishita/.test(fallbackStory), fallbackStory);

/* ------------- few categories + a lone video slide (and re-init from cache) --- */
// The browser still holds the 9-card version from the visits above; the fresh
// answer has only two categories, so the pinned row has to be torn down cleanly.
const keep = new Set(['proj-tablescapes', 'aanya-dev']);
db.projects = db.projects.filter((p) => keep.has(p.slug));
const kept = new Set(db.projects.map((p) => p.id));
db.media = db.media.filter((m) => kept.has(m.project_id));
const aanyaP = db.projects.find((p) => p.slug === 'aanya-dev');
aanyaP.cover_media_id = db.media.find((m) => m.project_id === aanyaP.id && m.type === 'video').id;
db.projects.forEach((p) => { p.featured = p.slug === 'aanya-dev'; });
const haveVideoFile = fs.existsSync(new URL('../videos/palace-archway.mp4', import.meta.url));

await page.goto(SITE + '/', 5000);
const few = await page.eval(`(() => ({
  slides: [...document.querySelectorAll('#edReel .ed-slide')].map(s => s.tagName),
  arrowsHidden: [...document.querySelectorAll('.ed-reel .ed-arrow')].every(a => a.hidden),
  playing: (() => { const v = document.querySelector('#edReel video'); return v ? !v.paused && v.currentTime > 0 : null; })(),
  cards: document.querySelectorAll('.ed-bento .bento-card').length,
  fit: document.querySelector('.ed-bento').classList.contains('is-fit'),
  pinned: ScrollTrigger.getAll().filter(s => s.pin).map(s => s.trigger && s.trigger.className),
  bentoLeft: Math.round(document.querySelector('.bento-card').getBoundingClientRect().left),
  capOpacity: getComputedStyle(document.querySelector('.bento-cap')).opacity,
  noOverflow: document.documentElement.scrollWidth <= innerWidth,
}))()`);
check('reel with one featured video: one slide, a video, arrows hidden', few.slides.length === 1 && few.slides[0] === 'VIDEO' && few.arrowsHidden, few);
if (haveVideoFile) check('…and the lone video actually plays', few.playing === true, few); else console.log('skip …the lone video plays (videos/palace-archway.mp4 not on this machine)');
check('two categories: two cards, shown as a fitted row', few.cards === 2 && few.fit === true, few);
check('…and the old pinned row was torn down (only the hero still pins)', few.pinned.length === 1 && /cinema-hero/.test(few.pinned[0]), few.pinned);
check('…cards are settled (caption visible) and nothing overflows sideways', few.capOpacity === '1' && few.noOverflow, few);

/* ----------------------------------------------- database unreachable ----- */
await mock.close();
await page.goto(SITE + '/', 5000);
const down = await page.eval(`(() => ({
  waiting: document.documentElement.classList.contains('cms-wait'),
  slides: document.querySelectorAll('#edReel .ed-slide').length,
  cards: document.querySelectorAll('.ed-bento .bento-card').length,
  sample: document.body.innerHTML.includes('images.unsplash.com'),
}))()`);
check('database down: the page is not left hidden', down.waiting === false, down);
check('database down: the page still shows content', down.cards >= 1 && down.slides >= 1, down);

check('no JavaScript errors on the story pages', page.logs.filter((l) => l.startsWith('EXCEPTION')).length === 0, page.logs);

await page.close();
console.log(failures() ? `\n${failures()} check(s) FAILED` : '\nAll checks passed');
process.exit(failures() ? 1 : 0);
