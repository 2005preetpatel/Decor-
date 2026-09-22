/* ============================================================== story data ==

   One entry per celebration. `story.html` reads the `s` query parameter and
   builds itself from whichever entry it names, so adding a fourth story is a
   matter of adding a fourth object here and a fourth card on the home page —
   no new HTML file.

   `frames` is read in order. A plain object is one full-width frame; a nested
   array of two is a pair sharing a row. The reference layout is mostly single
   column, and the occasional pair is what stops a long scroll of identical
   full-bleed frames reading as a contact sheet.

   The photographs are the same library the home page draws on, ordered
   differently per story — placeholders until the real shoot goes in. Every
   name, place and credit here is a placeholder too.
   ========================================================================= */

const IMG = 'https://images.unsplash.com/photo-';

/* The nine already on the site. Named so a story reads as a sequence rather
   than a wall of URLs. */
const PIC = {
  bouquet:  { id: '1519741497674-611481863552', alt: 'A dark, dramatic bridal bouquet of magnolia and foliage' },
  drapery:  { id: '1560128411-79892dd93bf8',    alt: 'Candlelit drapery at dusk' },
  mandap:   { id: '1587271407850-8d438ca9fdf2', alt: 'A mandap stage dressed in florals and drapery' },
  balloons: { id: '1741969494307-55394e3e4071', alt: 'A balloon installation in blush and gold' },
  wall:     { id: '1751257547111-9641cb540f4d', alt: 'A floral wall backdrop behind a dressed table' },
  table:    { id: '1751257567128-a90534b263e6', alt: 'A candlelit reception tablescape' },
  stage:    { id: '1751257741300-23ac727692d0', alt: 'A stage lit from above in warm light' },
  ceiling:  { id: '1756383537862-fb709221c504', alt: 'Reception drapery lit from within' },
  cake:     { id: '1774290687229-a725965554c6', alt: 'A dressed celebration table' },
};

function frame(key, w, h) {
  const p = PIC[key];
  return {
    src: IMG + p.id + '?auto=format&fit=crop&q=80&w=' + w + '&h=' + h,
    alt: p.alt,
    w: w,
    h: h,
  };
}

// Full width frames are requested tall; paired frames are requested narrower
// so the browser is not decoding a 1800px file to paint a 600px box.
const WIDE = [1800, 1200];
const TALL = [1600, 1900];
const HALF = [900, 1100];

const STORIES = {
  'aanya-dev': {
    names: ['Aanya', 'Dev'],
    place: 'Udaipur',
    credits: [
      ['Décor', 'Opula Decor'],
      ['Venue', 'Udaipur'],
      ['Occasion', 'Wedding &amp; Reception'],
    ],
    intro: 'A palace courtyard, a thousand candles, and a canopy that took '
         + 'four days to hang. The brief was one word: warm.',
    frames: [
      frame('mandap', WIDE[0], WIDE[1]),
      [frame('wall', HALF[0], HALF[1]), frame('bouquet', HALF[0], HALF[1])],
      frame('table', WIDE[0], WIDE[1]),
      frame('drapery', TALL[0], TALL[1]),
      [frame('stage', HALF[0], HALF[1]), frame('ceiling', HALF[0], HALF[1])],
      frame('cake', WIDE[0], WIDE[1]),
    ],
  },

  'ishita-rohan': {
    names: ['Ishita', 'Rohan'],
    place: 'Jaipur',
    credits: [
      ['Décor', 'Opula Decor'],
      ['Venue', 'Jaipur'],
      ['Occasion', 'Wedding'],
    ],
    intro: 'Long tables, low light, and nothing on them that was not going to '
         + 'be touched, poured or eaten by the end of the night.',
    frames: [
      frame('table', WIDE[0], WIDE[1]),
      frame('ceiling', TALL[0], TALL[1]),
      [frame('drapery', HALF[0], HALF[1]), frame('bouquet', HALF[0], HALF[1])],
      frame('mandap', WIDE[0], WIDE[1]),
      [frame('stage', HALF[0], HALF[1]), frame('wall', HALF[0], HALF[1])],
      frame('cake', WIDE[0], WIDE[1]),
    ],
  },

  'meera-arjun': {
    names: ['Meera', 'Arjun'],
    place: 'Goa',
    credits: [
      ['Décor', 'Opula Decor'],
      ['Venue', 'Goa'],
      ['Occasion', 'Wedding &amp; Sangeet'],
    ],
    intro: 'Sea air is unkind to florals, so the whole scheme was built around '
         + 'what would still look alive at midnight.',
    frames: [
      frame('wall', WIDE[0], WIDE[1]),
      [frame('ceiling', HALF[0], HALF[1]), frame('table', HALF[0], HALF[1])],
      frame('bouquet', TALL[0], TALL[1]),
      frame('mandap', WIDE[0], WIDE[1]),
      [frame('balloons', HALF[0], HALF[1]), frame('cake', HALF[0], HALF[1])],
      frame('drapery', WIDE[0], WIDE[1]),
    ],
  },
};

const STORY_ORDER = ['aanya-dev', 'ishita-rohan', 'meera-arjun'];
