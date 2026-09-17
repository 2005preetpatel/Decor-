/* ============================================================================
   hero-scene.js — builds "The Hall" and drives its scroll cinematic.

   The room is drawn, not photographed. One SVG carries three of the four
   layers (architecture, lighting, decor) in a single one-point-perspective
   projection: viewBox 1600x1000, vanishing point at (800, 478), back wall
   plane from x 430..1170 and y 170..672. Every wall, column, window and tile
   is derived from those numbers, so nothing is mirrored, cropped or pasted —
   the left and right halves of the room carry different content (gilt mirror
   and panelling on the left, the window bank on the right) even though the
   architecture itself is symmetrical, exactly as the reference room is.

   The fourth layer — the entrance — is HTML, because a real rotateY hinge
   needs a real perspective/preserve-3d chain. Its opening is cut into the
   back wall by the architecture layer (architrave, jamb reveal, threshold);
   the leaves only supply the two moving panels.

   Vertical budget: the SVG is `slice`-cropped, so on a wide viewport roughly
   y 45..955 of the viewBox survives. The cornice therefore sits at y 170 —
   low enough that a real band of coffered ceiling stays in frame and the
   chandeliers have somewhere to hang from.

   Scroll timeline (fractions of the pinned scrub):
     0.00–0.20  hold. chandeliers dim, camera still
     0.20–0.35  chandeliers and sconces come up to full
     0.35–0.70  dolly-in to scale 1.06, doorway stays centred
     0.70–0.90  both leaves swing out on their hinges, ±95°
     0.90–1.00  daylight floods in, sheet expands, fade to white
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------ geometry -- */

  const VBW = 1600, VBH = 1000;
  const VP  = { x: 800, y: 478 };          // vanishing point
  const BX0 = 430, BX1 = 1170;             // back wall, left/right
  const BY0 = 170, BY1 = 672;              // back wall, cornice/floor line
  const FX0 = -320, FX1 = 1920;            // where the side walls exit frame
  const FY0 = -60,  FY1 = 1150;            // where ceiling/floor exit frame
  const DX0 = 648, DX1 = 952;              // door opening
  const DY0 = 330, DY1 = 672;

  const lerp = (a, b, t) => a + (b - a) * t;
  const r2   = n => Math.round(n * 100) / 100;

  // A side wall is parameterised by u: 0 at the back wall, 1 at the frame
  // edge. Straight lines stay straight under projection, so plain lerps on
  // the three defining edges give correct perspective.
  const wallL = u => ({ x: lerp(BX0, FX0, u), top: lerp(BY0, FY0, u), bot: lerp(BY1, FY1, u) });
  const wallR = u => ({ x: lerp(BX1, FX1, u), top: lerp(BY0, FY0, u), bot: lerp(BY1, FY1, u) });
  const wallY = (w, f) => lerp(w.top, w.bot, f);

  // u = 1 is where a side wall would leave a 16:10 frame. Narrow viewports
  // crop a taller box out of the same drawing, so the walls, ceiling and
  // floor are carried on past that along their own rays — extending the
  // parameter, never changing the geometry, so the desktop framing is
  // pixel-identical and the bays keep the u values they were placed at.
  const UMAX = 1.78;
  const LEND = wallL(UMAX), REND = wallR(UMAX);

  // Floor helpers: half-width of the room at a given screen y, and where a
  // point on the back floor edge lands at the bottom of frame.
  const floorHalf  = y => ((BX1 - BX0) / 2) * (y - VP.y) / (BY1 - VP.y);
  const FLOOR_K    = (LEND.bot - VP.y) / (BY1 - VP.y);
  const floorFront = bx => VP.x + (bx - VP.x) * FLOOR_K;

  const poly = (pts, attr) =>
    `<polygon points="${pts.map(p => r2(p[0]) + ',' + r2(p[1])).join(' ')}" ${attr}/>`;
  const line = (x1, y1, x2, y2, attr) =>
    `<line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}" ${attr}/>`;
  const rect = (x, y, w, h, attr) =>
    `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" ${attr}/>`;
  const circ = (cx, cy, r, attr) =>
    `<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(r)}" ${attr}/>`;
  const ell = (cx, cy, rx, ry, attr) =>
    `<ellipse cx="${r2(cx)}" cy="${r2(cy)}" rx="${r2(rx)}" ry="${r2(ry)}" ${attr}/>`;

  // Deterministic jitter — florals and crystals need variety, but the room
  // must redraw identically every time it is built.
  let seed = 20260910;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  /* ---------------------------------------------------------------- defs -- */

  /* ------------------------------------------------------------ materials --
     Everything the room is made of lives here: the pigments, the metal, the
     stone, and the light. The shapes below only ever reference these, so the
     whole hall can be re-graded from one block.

       ivory      #f8f3ea      champagne gold #d4af37
       soft cream #f4e8d3      marble white   #f7f7f5
     ------------------------------------------------------------------------ */

  function defs() {
    return `<defs>
      <linearGradient id="gCeil" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fdfaf4"/><stop offset=".6" stop-color="#f6f0e3"/>
        <stop offset="1" stop-color="#eadfc8"/>
      </linearGradient>
      <linearGradient id="gBack" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#faf5ec"/><stop offset=".45" stop-color="#f4ead8"/>
        <stop offset="1" stop-color="#e6d9c0"/>
      </linearGradient>
      <!-- The two side walls are the same paint under different light: the
           left is in shade, the right is washed by the windows. -->
      <linearGradient id="gWallL" x1="1" y1="0" x2="0" y2="0">
        <stop offset="0" stop-color="#e7dcc7"/><stop offset=".5" stop-color="#d0c1a4"/>
        <stop offset="1" stop-color="#b6a687"/>
      </linearGradient>
      <linearGradient id="gWallR" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#f7f0e2"/><stop offset=".45" stop-color="#fdf9f1"/>
        <stop offset="1" stop-color="#fffefb"/>
      </linearGradient>
      <!-- Calacatta: cool white near the camera, warming into the depth of
           the room where the chandeliers reach it. -->
      <linearGradient id="gFloor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#cdc3ad"/><stop offset=".13" stop-color="#dad1bd"/>
        <stop offset=".42" stop-color="#e5decd"/><stop offset="1" stop-color="#eeeade"/>
      </linearGradient>
      <!-- Antique brushed gold: two bright rolls with a dark rub between, not
           a flat yellow. This is what makes the mouldings read as metal. -->
      <linearGradient id="gGold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fdf4d8"/><stop offset=".2" stop-color="#efd9a0"/>
        <stop offset=".44" stop-color="#d4af37"/><stop offset=".64" stop-color="#9d7a26"/>
        <stop offset=".84" stop-color="#c9a444"/><stop offset="1" stop-color="#f4e3ae"/>
      </linearGradient>
      <linearGradient id="gGoldV" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#a8842b"/><stop offset=".3" stop-color="#e7cd8c"/>
        <stop offset=".55" stop-color="#d4af37"/><stop offset="1" stop-color="#8f6f22"/>
      </linearGradient>
      <!-- Column: a marble cylinder. The hot roll sits left of centre because
           the key light comes from the right and wraps. -->
      <linearGradient id="gCol" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#cdc3b2"/><stop offset=".14" stop-color="#f5f1e8"/>
        <stop offset=".3" stop-color="#fdfcf9"/><stop offset=".62" stop-color="#f0ebe0"/>
        <stop offset=".86" stop-color="#d5c9b4"/><stop offset="1" stop-color="#b7a98f"/>
      </linearGradient>
      <linearGradient id="gCloth" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".4" stop-color="#fbf8f2"/>
        <stop offset="1" stop-color="#e2d9c8"/>
      </linearGradient>
      <!-- Late sun: the glass is blown out at the top and honey at the sill. -->
      <linearGradient id="gWin" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".38" stop-color="#fffaec"/>
        <stop offset=".72" stop-color="#ffedc6"/><stop offset="1" stop-color="#f6d89b"/>
      </linearGradient>
      <!-- 2800K. Warm, never yellow-green. -->
      <radialGradient id="gGlow">
        <stop offset="0" stop-color="#fff0d0" stop-opacity=".95"/>
        <stop offset=".42" stop-color="#ffdfa6" stop-opacity=".42"/>
        <stop offset="1" stop-color="#ffd28d" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="gCrystal" cx=".32" cy=".28" r=".82">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".38" stop-color="#fff6dd"/>
        <stop offset=".72" stop-color="#f2dda6"/><stop offset="1" stop-color="#cfae68"/>
      </radialGradient>
      <linearGradient id="gVoid" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#5f5039"/><stop offset="1" stop-color="#3d3223"/>
      </linearGradient>
      <linearGradient id="gDrape" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#f6efe1"/><stop offset=".45" stop-color="#e8dcc4"/>
        <stop offset="1" stop-color="#c9b795"/>
      </linearGradient>

      <filter id="fSoft" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="9"/>
      </filter>
      <filter id="fHaze" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="22"/>
      </filter>
      <!-- Bloom is reserved for the crystal. Blooming the whole frame is what
           makes a render look like a filter instead of a photograph. -->
      <filter id="fBloom" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="13"/>
      </filter>
      <!-- Reflections are smeared along the polish, not blurred evenly. -->
      <filter id="fWet" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="2.5 6"/>
      </filter>
      <!-- Plaster tooth. One pass over the whole frame at very low alpha —
           enough to break the vector flatness, not enough to read as noise. -->
      <pattern id="pPlaster" width="7" height="7" patternUnits="userSpaceOnUse">
        <circle cx="1.5" cy="2" r=".6" fill="#8a7a5e" opacity=".055"/>
        <circle cx="5" cy="5.4" r=".5" fill="#ffffff" opacity=".07"/>
        <circle cx="4.2" cy="1.3" r=".38" fill="#8a7a5e" opacity=".04"/>
        <circle cx="1.1" cy="5.9" r=".32" fill="#ffffff" opacity=".05"/>
      </pattern>

      <!-- The floor stops mirroring as it runs away from the camera. -->
      <linearGradient id="gReflFade" gradientUnits="userSpaceOnUse"
        x1="0" y1="${BY1}" x2="0" y2="${BY1 + 470}">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".9"/>
        <stop offset=".38" stop-color="#ffffff" stop-opacity=".42"/>
        <stop offset=".72" stop-color="#ffffff" stop-opacity=".14"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
      <clipPath id="cBack">
        <rect x="${BX0}" y="${BY0}" width="${BX1 - BX0}" height="${BY1 - BY0}"/>
      </clipPath>
      <mask id="mRefl">
        <rect x="-1200" y="${BY1}" width="4000" height="900" fill="url(#gReflFade)"/>
      </mask>
    </defs>`;
  }

  /* ------------------------------------------------- LAYER 1 architecture -- */

  function ceiling() {
    // Backdrop first: on a tall crop the plaster has to run past where the
    // ceiling plane itself ends.
    let s = rect(-1200, -1200, 4000, 1600, 'fill="url(#gCeil)"');
    s += poly([[BX0, BY0], [BX1, BY0], [REND.x, REND.top], [LEND.x, LEND.top]], 'fill="url(#gCeil)"');

    // Coffers: the beams running back-to-front converge on the vanishing
    // point, the cross-beams sit on the ceiling plane at closing intervals.
    const gold = 'stroke="rgba(200,166,76,.3)" stroke-width="2" fill="none"';
    const kCeil = (LEND.top - VP.y) / (BY0 - VP.y);
    for (let i = 0; i <= 6; i++) {
      const bx = lerp(BX0, BX1, i / 6);
      s += line(bx, BY0, VP.x + (bx - VP.x) * kCeil, LEND.top, gold);
    }
    [128, 84, 36, -14].forEach(y => {
      const hw = ((BX1 - BX0) / 2) * (y - VP.y) / (BY0 - VP.y);
      s += line(VP.x - hw, y, VP.x + hw, y, gold);
    });

    // Plaster rosettes down the centre bay.
    [[800, 122, 26], [800, 58, 19]].forEach(([x, y, r]) => {
      s += circ(x, y, r, 'fill="none" stroke="rgba(200,166,76,.26)" stroke-width="2"');
      s += circ(x, y, r * 0.52, 'fill="none" stroke="rgba(200,166,76,.18)" stroke-width="1.5"');
    });
    // The shadow the cornice throws back up onto the plaster.
    s += rect(BX0, BY0 - 12, BX1 - BX0, 12, 'fill="rgba(112,90,50,.12)"');
    // Ceilings are never evenly lit: it falls away from the window wall and
    // darkens into the coves.
    s += poly([[BX0, BY0], [BX1, BY0], [REND.x, REND.top], [LEND.x, LEND.top]],
      'fill="rgba(108,92,62,.1)"');
    s += ell(1180, 40, 620, 340, 'fill="#fff6e2" opacity=".28" filter="url(#fHaze)"');
    return `<g id="hall-ceiling">${s}</g>`;
  }

  function backWall() {
    let s = rect(BX0, BY0, BX1 - BX0, BY1 - BY0, 'fill="url(#gBack)"');
    // The corners fall away — a flat wall reads as paper.
    s += rect(BX0, BY0, 90, BY1 - BY0, 'fill="rgba(120,98,58,.10)"');
    s += rect(BX1 - 90, BY0, 90, BY1 - BY0, 'fill="rgba(120,98,58,.07)"');

    // Entablature: architrave band, dentil course, cornice shelf.
    s += rect(BX0, BY0, BX1 - BX0, 26, 'fill="#f8f1e1"');
    s += rect(BX0, BY0 + 26, BX1 - BX0, 9, 'fill="url(#gGold)" opacity=".9"');
    for (let x = BX0 + 8; x < BX1 - 12; x += 22) {
      s += rect(x, BY0 + 37, 11, 13, 'fill="#ece1c8" stroke="rgba(198,162,66,.35)" stroke-width="1"');
    }
    s += rect(BX0, BY0 + 52, BX1 - BX0, 7, 'fill="#fbf5e9" stroke="rgba(198,162,66,.32)" stroke-width="1"');

    // Recessed panels flanking the doorway, double-lined in gold leaf.
    const panel = (x, y, w, h) =>
      rect(x, y, w, h, 'fill="rgba(255,251,241,.6)" stroke="rgba(198,162,66,.6)" stroke-width="2"') +
      // the reveal: dark on the top and left, catching light on the bottom
      rect(x + 3, y + 3, w - 6, 5, 'fill="rgba(122,102,66,.16)"') +
      rect(x + 3, y + 3, 5, h - 6, 'fill="rgba(122,102,66,.12)"') +
      rect(x + 3, y + h - 8, w - 6, 5, 'fill="rgba(255,255,255,.5)"') +
      rect(x + 9, y + 9, w - 18, h - 18, 'fill="none" stroke="rgba(198,162,66,.38)" stroke-width="1.4"');
    [452, 1016].forEach(x => {
      s += panel(x, 300, 132, 320);
      s += panel(x, 240, 132, 48);
    });

    // Window light standing on the plaster either side of the entrance.
    const sunPatch = (x0, wid, y0, h, lean, shift, op) => {
      const q = [[x0, y0], [x0 + wid, y0 - lean],
                 [x0 + wid - shift, y0 - lean + h], [x0 - shift, y0 + h]];
      let g = poly(q, `fill="#fff3d6" opacity="${op}" filter="url(#fSoft)"`);
      g += poly(q, `fill="#fffaea" opacity="${op * .6}"`);
      // Mullion bars across the patch, in the plane of the wall.
      for (let i = 1; i < 3; i++) {
        const t = i / 3;
        g += line(lerp(q[0][0], q[1][0], t), lerp(q[0][1], q[1][1], t),
                  lerp(q[3][0], q[2][0], t), lerp(q[3][1], q[2][1], t),
                  'stroke="rgba(150,126,84,.2)" stroke-width="7" filter="url(#fSoft)"');
      }
      return g;
    };
    s += `<g clip-path="url(#cBack)">`
       + sunPatch(1006, 168, 300, 340, 62, 120, .8)
       + sunPatch(452, 158, 336, 320, 54, 104, .5)
       + `</g>`;

    // Occlusion in the two back corners — the join no lighting model gives
    // you for free and the eye misses immediately.
    s += rect(BX0, BY0, 34, BY1 - BY0, 'fill="rgba(116,98,66,.2)" filter="url(#fSoft)"');
    s += rect(BX1 - 34, BY0, 34, BY1 - BY0, 'fill="rgba(116,98,66,.13)" filter="url(#fSoft)"');

    // Skirting where the plaster meets the marble.
    s += rect(BX0, BY1 - 22, BX1 - BX0, 22, 'fill="#ddd0b2" stroke="rgba(198,162,66,.28)" stroke-width="1"');
    return `<g id="hall-backwall">${s}</g>`;
  }

  // The opening itself: cut, framed, and given real wall thickness. This is
  // part of the wall — the HTML leaves hang inside it, they do not replace it.
  function doorway() {
    const jamb = 16;
    let s = '';
    // Architrave: outer moulding, inner fillet, then the entablature block
    // carried over the head on its own dentil course.
    s += rect(DX0 - 46, DY0 - 60, (DX1 - DX0) + 92, (DY1 - DY0) + 60,
      'fill="#f8f1e2" stroke="rgba(190,153,58,.55)" stroke-width="2"');
    s += rect(DX0 - 30, DY0 - 44, (DX1 - DX0) + 60, (DY1 - DY0) + 44,
      'fill="#fcf7ec" stroke="rgba(198,162,66,.45)" stroke-width="1.6"');
    s += rect(DX0 - 62, DY0 - 92, (DX1 - DX0) + 124, 36,
      'fill="#faf3e5" stroke="rgba(190,153,58,.5)" stroke-width="2"');
    s += rect(DX0 - 62, DY0 - 60, (DX1 - DX0) + 124, 8, 'fill="url(#gGold)" opacity=".85"');
    for (let x = DX0 - 52; x < DX1 + 46; x += 26) {
      s += rect(x, DY0 - 84, 12, 20, 'fill="rgba(255,251,241,.75)" stroke="rgba(198,162,66,.32)" stroke-width="1"');
    }

    // The void, and the reveal that proves the wall has depth: the left jamb
    // catches the window light, the right jamb falls into shadow.
    s += rect(DX0, DY0, DX1 - DX0, DY1 - DY0, 'fill="url(#gVoid)"');
    s += poly([[DX0, DY0], [DX0 + jamb, DY0 + jamb], [DX0 + jamb, DY1], [DX0, DY1]],
      'fill="#eee0c2" opacity=".92"');
    s += poly([[DX1, DY0], [DX1 - jamb, DY0 + jamb], [DX1 - jamb, DY1], [DX1, DY1]],
      'fill="#a48e69" opacity=".92"');
    s += poly([[DX0, DY0], [DX1, DY0], [DX1 - jamb, DY0 + jamb], [DX0 + jamb, DY0 + jamb]],
      'fill="#8d7a59" opacity=".92"');
    // Brass threshold on the floor line.
    s += rect(DX0 - 4, DY1 - 7, (DX1 - DX0) + 8, 7, 'fill="url(#gGold)" opacity=".95"');
    return `<g id="hall-doorway-frame">${s}</g>`;
  }

  // Bays: the piers carry the columns, the panels and glazing sit between
  // them. Both walls share the rhythm; only what fills the bays differs.
  const PIERS = [.055, .345, .655];
  const BAYS  = [[.13, .27], [.42, .57], [.74, .96]];

  function sideWalls() {
    let s = '';
    const L0 = wallL(0), L1 = LEND, R0 = wallR(0), R1 = REND;
    s += poly([[L0.x, L0.top], [L0.x, L0.bot], [L1.x, L1.bot], [L1.x, L1.top]], 'fill="url(#gWallL)"');
    s += poly([[R0.x, R0.top], [R0.x, R0.bot], [R1.x, R1.bot], [R1.x, R1.top]], 'fill="url(#gWallR)"');

    const quad = (fn, u0, u1, f0, f1, attr) => {
      const a = fn(u0), b = fn(u1);
      return poly([[a.x, wallY(a, f0)], [b.x, wallY(b, f0)], [b.x, wallY(b, f1)], [a.x, wallY(a, f1)]], attr);
    };

    // Cornice and skirting run the length of both walls.
    [[wallL, '#f4ecd6', '#d3c5a5'], [wallR, '#fbf5e8', '#e7dcc4']].forEach(([fn, top, bot]) => {
      s += quad(fn, 0, UMAX, 0, .055, `fill="${top}"`);
      s += quad(fn, 0, UMAX, .055, .075, 'fill="url(#gGold)" opacity=".8"');
      s += quad(fn, 0, UMAX, .965, 1, `fill="${bot}"`);
    });

    /* --- left wall: a gilt mirror in the first bay, panelling beyond --- */
    s += quad(wallL, BAYS[0][0], BAYS[0][1], .13, .60,
      'fill="#cdbb98" stroke="rgba(190,153,58,.65)" stroke-width="5"');
    s += quad(wallL, BAYS[0][0] + .015, BAYS[0][1] - .015, .155, .575, 'fill="#e2dac9"');
    // A faint return of the room inside the glass.
    s += quad(wallL, BAYS[0][0] + .03, BAYS[0][1] - .04, .22, .5, 'fill="#f2ece0" opacity=".7"');
    [BAYS[1], BAYS[2]].forEach(([u0, u1]) => {
      s += quad(wallL, u0, u1, .17, .60, 'fill="rgba(255,250,238,.34)" stroke="rgba(190,153,58,.34)" stroke-width="2.5"');
      s += quad(wallL, u0 + .015, u1 - .015, .195, .575, 'fill="none" stroke="rgba(190,153,58,.2)" stroke-width="1.6"');
    });

    /* --- right wall: the window bank the whole room is lit by --- */
    BAYS.forEach(([u0, u1]) => {
      s += quad(wallR, u0 - .02, u1 + .02, .10, .80, 'fill="#f3e8d0" stroke="rgba(190,153,58,.45)" stroke-width="3"');
      s += quad(wallR, u0 - .05, u1 + .05, .05, .9, 'fill="#fff4dc" opacity=".55" filter="url(#fHaze)"');
      s += quad(wallR, u0, u1, .13, .77, 'fill="url(#gWin)"');
      s += quad(wallR, u0, u1, .13, .5, 'fill="#ffffff" opacity=".55"');
      // Mullions: three lights across, five rows down.
      for (let i = 1; i < 3; i++) {
        const w = wallR(lerp(u0, u1, i / 3));
        s += line(w.x, wallY(w, .13), w.x, wallY(w, .77), 'stroke="rgba(202,170,108,.8)" stroke-width="2.6"');
      }
      for (let j = 1; j < 5; j++) {
        const f = lerp(.13, .77, j / 5), a = wallR(u0), b = wallR(u1);
        s += line(a.x, wallY(a, f), b.x, wallY(b, f), 'stroke="rgba(202,170,108,.65)" stroke-width="2.2"');
      }
      // Drapery falling either side of the reveal.
      s += quad(wallR, u0 - .06, u0 - .012, .08, .95, 'fill="url(#gDrape)" opacity=".9"');
      s += quad(wallR, u1 + .012, u1 + .06, .08, .95, 'fill="url(#gDrape)" opacity=".9"');
    });

    return `<g id="hall-sidewalls">${s}</g>`;
  }

  /* ------------------------------------------------------- LAYER 1: stone --

     The floor does three jobs a flat fill cannot: it carries stone (veining
     that foreshortens with the tiles), it carries the room (a mirrored,
     smeared copy of everything standing on it), and it carries the light
     (sun patches thrown from the right-hand windows, with the mullion bars
     drawn across them). Between them they are most of what separates
     polished marble from a beige rectangle.
     ------------------------------------------------------------------------ */

  // A point on the floor plane, given a cross-room position (-1..1 spans the
  // room's width at the back wall) and a screen depth.
  const onFloor = (u, y) => [VP.x + u * floorHalf(y), y];

  // One Calacatta vein: a random walk in floor space, emitted segment by
  // segment so its width can grow as it comes toward the camera. A single
  // path with one stroke-width would read as a drawn line, not as stone.
  function vein(u0, tint, w0, steps, drift) {
    let out = '', u = u0, y = BY1 + 3;
    for (let i = 0; i < steps; i++) {
      const y2 = BY1 + (LEND.bot - BY1) * Math.pow((i + 1) / steps, 1.7);
      const u2 = u + (rnd() - .5) * drift;
      const um = (u + u2) / 2 + (rnd() - .5) * drift * .6;
      const ym = (y + y2) / 2;
      const a = onFloor(u, y), m = onFloor(um, ym), b = onFloor(u2, y2);
      const w = w0 * (y2 - VP.y) / (BY1 - VP.y);
      out += `<path d="M${r2(a[0])} ${r2(a[1])} Q ${r2(m[0])} ${r2(m[1])} ${r2(b[0])} ${r2(b[1])}"`
           + ` fill="none" stroke="${tint}" stroke-width="${r2(w)}" stroke-linecap="round"/>`;
      u = u2; y = y2;
    }
    return out;
  }

  function marble() {
    let s = '';
    // Broad cloudy shading first — the grey drift the veins sit in.
    for (let i = 0; i < 7; i++) {
      const y = BY1 + 60 + rnd() * 700;
      const x = onFloor(-1 + rnd() * 2, y)[0];
      s += ell(x, y, 150 + rnd() * 220, 40 + rnd() * 70,
        'fill="#b9b2a4" opacity=".055" filter="url(#fHaze)"');
    }
    // Then the veining: a few bold grey runs, more fine gold-taupe branches.
    // Real Calacatta drifts; it does not meander. Amplitude stays low and the
    // count stays high — that ratio is the difference between stone and a
    // squiggle.
    for (let i = 0; i < 7; i++)  s += vein(-1.62 + i * .48, 'rgba(140,132,118,.15)', 2.1, 9, .16);
    for (let i = 0; i < 22; i++) s += vein(-1.72 + i * .16, 'rgba(172,146,94,.10)', 0.9, 10, .11);
    for (let i = 0; i < 16; i++) s += vein(-1.58 + i * .21, 'rgba(118,110,96,.07)', 0.5, 11, .08);
    return s;
  }

  // What the polish gives back. Simplified silhouettes rather than true
  // copies: a reflection at this gloss is a smear, and a smear only needs the
  // right mass in the right place.
  function reflections() {
    let r = '';
    // The doorway: frame, then the two closed leaves, then the brass sill.
    r += rect(DX0 - 46, DY0 - 60, (DX1 - DX0) + 92, (DY1 - DY0) + 60, 'fill="#f4ebd8" opacity=".85"');
    r += rect(DX0 + 8, DY0 + 16, (DX1 - DX0) / 2 - 12, (DY1 - DY0) - 16, 'fill="#f9f2e4"');
    r += rect(DX0 + (DX1 - DX0) / 2 + 4, DY0 + 16, (DX1 - DX0) / 2 - 12, (DY1 - DY0) - 16, 'fill="#f6eede"');
    r += rect(DX0 - 4, DY1 - 8, (DX1 - DX0) + 8, 8, 'fill="#d4af37" opacity=".8"');
    // Pedestals and their urns.
    [566, 1034].forEach(function (x) {
      r += rect(x - 30, 568, 60, 104, 'fill="#fbf7ee"');
      r += ell(x, 528, 46, 40, 'fill="#f7f4ec" opacity=".8"');
    });
    // Greenery banked against the skirting.
    [478, 1122].forEach(function (x) { r += ell(x, 660, 54, 22, 'fill="#8d9d76" opacity=".7"'); });
    // Column bases either side.
    PIERS.forEach(function (u) {
      const w = 54 * (1 + 1.65 * u);
      [wallL(u), wallR(u)].forEach(function (wl, i) {
        const cx = i ? wl.x - w * .55 : wl.x + w * .55;
        r += rect(cx - w * .62, wl.bot - w * .3, w * 1.24, w * .3, 'fill="#eee7d8"');
      });
    });
    // The window bank, thrown back as long bright runs down the right side.
    BAYS.forEach(function (bay) {
      const a = wallR(bay[0]), b = wallR(bay[1]);
      r += poly([[a.x, a.bot], [b.x, b.bot], [b.x, b.bot - 300], [a.x, a.bot - 260]],
        'fill="#fff3d6" opacity=".45"');
    });
    // The skirting line, which is what anchors all of the above to the wall.
    r += rect(BX0, BY1 - 22, BX1 - BX0, 22, 'fill="#e8dcc2"');

    return '<g mask="url(#mRefl)" opacity=".8">'
         + `<g transform="matrix(1,0,0,-1,0,${2 * BY1})" filter="url(#fWet)">${r}</g></g>`;
  }

  // Sunset through the right-hand windows: a bright quad per bay, thrown left
  // and toward the camera, with the mullion bars shadowed across it.
  function sunPatches() {
    let s = '';
    BAYS.forEach(function (bay, k) {
      const a = wallR(bay[0]), b = wallR(bay[1]);
      const reach = 900 + k * 260, drop = 210 + k * 70;
      const p = [[a.x, a.bot], [b.x, b.bot],
                 [b.x - reach * 1.06, Math.min(b.bot + drop * 1.15, LEND.bot)],
                 [a.x - reach, Math.min(a.bot + drop, LEND.bot)]];
      s += poly(p, 'fill="#ffeec4" opacity=".55" filter="url(#fSoft)"');
      s += poly(p, 'fill="#fffaeb" opacity=".38"');
      s += poly(p, 'fill="#ffffff" opacity=".2" filter="url(#fSoft)"');
      // Mullion bars, interpolated across the patch so they lie in the plane
      // of the floor rather than across the screen.
      for (let i = 1; i < 3; i++) {
        const t = i / 3;
        s += line(lerp(p[0][0], p[1][0], t), lerp(p[0][1], p[1][1], t),
                  lerp(p[3][0], p[2][0], t), lerp(p[3][1], p[2][1], t),
                  'stroke="rgba(150,126,84,.16)" stroke-width="9" filter="url(#fSoft)"');
      }
    });
    return s;
  }

  // Long shadows raking away from the key light. Everything standing on the
  // marble throws one to the left, because the sun is on the right.
  function castShadows() {
    let s = '';
    const cast = function (cx, by, w, reach, drop) {
      const y2 = Math.min(by + drop, LEND.bot);
      return poly([[cx - w / 2, by], [cx + w / 2, by],
                   [cx + w / 2 - reach, y2], [cx - w / 2 - reach, y2]],
        'fill="rgba(126,106,74,.14)" filter="url(#fSoft)"');
    };
    PIERS.forEach(function (u) {
      const w = 54 * (1 + 1.65 * u);
      const R = wallR(u), L = wallL(u);
      s += cast(R.x - w * .55, R.bot + 30, w * 1.3, 300 + u * 620, 110 + u * 190);
      s += cast(L.x + w * .55, L.bot + 30, w * 1.3, 120 + u * 240, 60 + u * 120);
    });
    [566, 1034].forEach(function (x) { s += cast(x, 672, 66, 150, 66); });
    // Ambient shade over the shadow side of the room. Without it the left of
    // the floor is as bright as the sunlit right and the key light dies.
    s += poly([[LEND.x, LEND.bot], [VP.x - 60, LEND.bot], [BX0 + 250, BY1], [BX0, BY1]],
      'fill="rgba(122,106,78,.13)" filter="url(#fHaze)"');
    return s;
  }

  function floor() {
    let s = poly([[BX0, BY1], [BX1, BY1], [REND.x, REND.bot], [LEND.x, LEND.bot]],
      'fill="url(#gFloor)"');

    s += marble();

    // Shade wash: the ambient level of the room. The sun patches below are
    // then genuinely brighter than the floor they fall on.
    s += poly([[BX0, BY1], [BX1, BY1], [REND.x, REND.bot], [LEND.x, LEND.bot]],
      'fill="rgba(112,96,68,.15)"');

    // Tile grid: receding joints run to the vanishing point, transverse joints
    // tighten toward the back wall. Hairline — a polished slab floor has
    // almost no grout to see.
    const joint = 'stroke="rgba(150,138,116,.16)" stroke-width="1.3"';
    for (let i = 0; i <= 10; i++) {
      const bx = lerp(BX0, BX1, i / 10);
      s += line(bx, BY1, floorFront(bx), LEND.bot, joint);
    }
    [700, 740, 788, 846, 916, 1000, 1100, 1260, 1460].forEach(function (y) {
      const hw = floorHalf(y);
      s += line(VP.x - hw, y, VP.x + hw, y, joint);
    });

    // The dark inlay — the geometric border the reference floor carries.
    const inlay = 'stroke="rgba(96,84,66,.4)" stroke-width="3.2" fill="none"';
    [BX0 + 110, BX1 - 110].forEach(function (bx) {
      s += line(bx, BY1, floorFront(bx), LEND.bot, inlay);
    });
    [788, 1000].forEach(function (y) {
      const hw = floorHalf(y) * .78;
      s += line(VP.x - hw, y, VP.x + hw, y, inlay);
    });
    // Centre lozenge, on the axis of the doorway.
    s += poly([[800, 822], [1012, 912], [800, 1002], [588, 912]], inlay);

    s += reflections();
    s += sunPatches();
    s += castShadows();

    // Ambient occlusion at the wall junction, then the specular sheet the
    // chandeliers lay across the polish.
    s += rect(BX0, BY1, BX1 - BX0, 18, 'fill="rgba(104,88,60,.22)" filter="url(#fSoft)"');
    s += ell(800, 1010, 600, 120, 'fill="#ffffff" opacity=".16" filter="url(#fHaze)"');
    return `<g id="hall-floor">${s}</g>`;
  }

  // Corinthian column: fluted shaft under an acanthus bell and abacus.
  function column(cx, topY, botY, w) {
    const hw = w / 2, capH = w * 0.9, baseH = w * 0.42;
    const sTop = topY + capH, sBot = botY - baseH;
    let s = '';
    s += rect(cx - hw, sTop, w, sBot - sTop, 'fill="url(#gCol)"');
    // Flutes: a shadow line with a lit lip beside it. One flat line per flute
    // gives you a striped cylinder, not a carved one.
    for (let i = 1; i < 6; i++) {
      const x = cx - hw + (w * i / 6);
      s += line(x, sTop, x, sBot, 'stroke="rgba(150,126,88,.3)" stroke-width="1.8"');
      s += line(x + w * .045, sTop, x + w * .045, sBot, 'stroke="rgba(255,255,255,.4)" stroke-width="1.2"');
    }
    // Occlusion where the shaft meets its capital and its base.
    s += rect(cx - hw, sTop, w, w * .16, 'fill="rgba(112,94,62,.16)" filter="url(#fSoft)"');
    s += rect(cx - hw, sBot - w * .18, w, w * .18, 'fill="rgba(112,94,62,.14)" filter="url(#fSoft)"');
    // Capital: bell, acanthus ribs, volute scrolls, abacus slab.
    s += `<path d="M${r2(cx - hw)} ${r2(sTop)} C ${r2(cx - hw * 1.12)} ${r2(topY + capH * .45)}, ${r2(cx - hw * 1.28)} ${r2(topY + capH * .3)}, ${r2(cx - hw * 1.34)} ${r2(topY + capH * .18)} L ${r2(cx + hw * 1.34)} ${r2(topY + capH * .18)} C ${r2(cx + hw * 1.28)} ${r2(topY + capH * .3)}, ${r2(cx + hw * 1.12)} ${r2(topY + capH * .45)}, ${r2(cx + hw)} ${r2(sTop)} Z" fill="url(#gGold)" opacity=".94"/>`;
    for (let i = -1; i <= 1; i++) {
      s += `<path d="M${r2(cx + i * hw * .62)} ${r2(sTop)} q ${r2(hw * .18)} ${r2(-capH * .34)} 0 ${r2(-capH * .58)}" fill="none" stroke="rgba(142,108,34,.55)" stroke-width="2"/>`;
    }
    s += circ(cx - hw * 1.06, topY + capH * .3, hw * .17, 'fill="none" stroke="rgba(142,108,34,.6)" stroke-width="2.4"');
    s += circ(cx + hw * 1.06, topY + capH * .3, hw * .17, 'fill="none" stroke="rgba(142,108,34,.6)" stroke-width="2.4"');
    s += rect(cx - hw * 1.42, topY + capH * .02, w * 1.42, capH * .17,
      'fill="#f9f2e2" stroke="rgba(190,153,58,.5)" stroke-width="1.6"');
    // Base: torus over plinth.
    s += ell(cx, sBot + baseH * .34, hw * 1.16, baseH * .34,
      'fill="#efe5d0" stroke="rgba(190,153,58,.35)" stroke-width="1.4"');
    s += rect(cx - hw * 1.24, sBot + baseH * .6, w * 1.24, baseH * .4,
      'fill="#e5d8bd" stroke="rgba(190,153,58,.32)" stroke-width="1.4"');
    return s;
  }

  function columns() {
    let s = '';
    PIERS.forEach(u => {
      const w = 54 * (1 + 1.65 * u);
      const L = wallL(u), R = wallR(u);
      s += column(L.x + w * .55, L.top + 4, L.bot + 34, w);
      s += column(R.x - w * .55, R.top + 4, R.bot + 34, w);
    });
    return `<g id="hall-columns">${s}</g>`;
  }

  /* ----------------------------------------------------- LAYER 2 lighting -- */

  // One chandelier generator, used at two scales and two depths. The crystal
  // is tiers of small spheres on rings — that beading is what reads as cut
  // glass at a distance, where a blurred blob would not.
  function chandelier(cx, cy, s) {
    let g = '', glass = '';
    const arms = 14;
    g += line(cx, cy - 90 * s, cx, cy + 44 * s, `stroke="rgba(190,153,58,.75)" stroke-width="${r2(3 * s)}"`);
    g += ell(cx, cy + 46 * s, 26 * s, 9 * s, 'fill="url(#gGold)"');
    g += ell(cx, cy + 145 * s, 196 * s, 148 * s, 'fill="url(#gGlow)" opacity=".55" filter="url(#fHaze)"');
    g += ell(cx, cy + 100 * s, 150 * s, 30 * s, `fill="none" stroke="url(#gGold)" stroke-width="${r2(5 * s)}"`);
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2;
      const x = cx + Math.cos(a) * 150 * s, y = cy + 100 * s + Math.sin(a) * 30 * s;
      g += rect(x - 4 * s, y - 34 * s, 8 * s, 34 * s, 'fill="#fbf3e2"');
      g += ell(x, y - 40 * s, 5 * s, 9 * s, 'fill="#fff3d0"');
      g += ell(x, y - 40 * s, 15 * s, 22 * s, 'fill="url(#gGlow)" opacity=".6"');
    }
    [[118, 168, 26], [146, 150, 24], [176, 122, 20], [206, 90, 16], [232, 56, 12]]
      .forEach(([dy, rx, n]) => {
        const ry = rx * 0.2;
        g += ell(cx, cy + dy * s, rx * s, ry * s,
          `fill="none" stroke="rgba(208,174,88,.5)" stroke-width="${r2(1.6 * s)}"`);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const x = cx + Math.cos(a) * rx * s, y = cy + dy * s + Math.sin(a) * ry * s;
          const c = circ(x, y, (4.6 + rnd() * 1.8) * s, 'fill="url(#gCrystal)"')
                  + circ(x, y + 9 * s, (3.2 + rnd() * 1.2) * s, 'fill="url(#gCrystal)" opacity=".88"');
          g += c;
          glass += c;
          // A single hot pinprick per drop — cut glass is specular before it
          // is anything else.
          if (rnd() > .55) g += circ(x - 1.4 * s, y - 1.6 * s, 1.5 * s, 'fill="#ffffff"');
        }
      });
    // Beaded swags between the arms.
    for (let i = 0; i < arms; i++) {
      const a0 = (i / arms) * Math.PI * 2, a1 = ((i + 1) / arms) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * 150 * s, y0 = cy + 100 * s + Math.sin(a0) * 30 * s;
      const x1 = cx + Math.cos(a1) * 150 * s, y1 = cy + 100 * s + Math.sin(a1) * 30 * s;
      g += `<path d="M${r2(x0)} ${r2(y0)} Q ${r2((x0 + x1) / 2)} ${r2((y0 + y1) / 2 + 30 * s)} ${r2(x1)} ${r2(y1)}" fill="none" stroke="rgba(250,232,182,.9)" stroke-width="${r2(2.6 * s)}" stroke-dasharray="${r2(2.6 * s)} ${r2(3.4 * s)}" stroke-linecap="round"/>`;
    }
    g += `<path d="M${r2(cx - 13 * s)} ${r2(cy + 236 * s)} Q ${r2(cx)} ${r2(cy + 284 * s)} ${r2(cx + 13 * s)} ${r2(cy + 236 * s)} Z" fill="url(#gCrystal)"/>`;
    g += `<g filter="url(#fBloom)" opacity=".75" style="mix-blend-mode:screen">${glass}</g>`;
    return g;
  }

  function sconce(x, y, s) {
    let g = '';
    g += ell(x, y - 6 * s, 46 * s, 54 * s, 'fill="url(#gGlow)" opacity=".7"');
    g += `<path d="M${r2(x)} ${r2(y + 22 * s)} q ${r2(-14 * s)} ${r2(-18 * s)} ${r2(-20 * s)} ${r2(-34 * s)}" fill="none" stroke="url(#gGold)" stroke-width="${r2(3 * s)}"/>`;
    g += `<path d="M${r2(x)} ${r2(y + 22 * s)} q ${r2(14 * s)} ${r2(-18 * s)} ${r2(20 * s)} ${r2(-34 * s)}" fill="none" stroke="url(#gGold)" stroke-width="${r2(3 * s)}"/>`;
    g += rect(x - 3 * s, y + 8 * s, 6 * s, 28 * s, 'fill="url(#gGold)"');
    [-20, 20].forEach(dx => {
      g += rect(x + dx * s - 3 * s, y - 22 * s, 6 * s, 24 * s, 'fill="#fbf3e2"');
      g += ell(x + dx * s, y - 27 * s, 4 * s, 8 * s, 'fill="#fff2cc"');
    });
    return g;
  }

  function lighting(flames) {
    let s = '';

    // Sun raking off the right-hand windows onto the marble. Soft-edged
    // parallelograms, not hard beams — this is late afternoon, not a spot.
    BAYS.slice(0, 2).forEach(([u0, u1]) => {
      const a = wallR(u0), b = wallR(u1);
      // The shaft in the air, which stops well short of the floor — the
      // light *on* the marble is drawn by the floor pass, with mullion bars,
      // and a second soft copy over it only washes that out.
      s += poly([[a.x, wallY(a, .2)], [b.x, wallY(b, .2)],
                 [b.x - 520, 980], [a.x - 660, 980]],
        'fill="#fff0cd" opacity=".13" filter="url(#fHaze)"');
      // The window's own bloom, spilling past its reveal.
      s += ell((a.x + b.x) / 2, (wallY(a, .45) + wallY(b, .45)) / 2, (b.x - a.x) * .8, 150,
        'fill="url(#gGlow)" opacity=".34" filter="url(#fHaze)"');
    });

    // Warm bounce off the polished floor under the chandeliers.
    s += ell(800, 940, 430, 110, 'fill="url(#gGlow)" opacity=".2" filter="url(#fHaze)"');

    // The far chandelier first, so the near one hangs in front of it.
    s += chandelier(800, 200, .34);
    s += chandelier(800, -30, 1.05);

    // Sconces: two on the back wall flanking the doorway, then one on each
    // pier down the side walls.
    s += sconce(556, 450, 1);
    s += sconce(1044, 450, 1);
    PIERS.slice(1).forEach(u => {
      const l = wallL(u), r = wallR(u);
      s += sconce(l.x + 30, wallY(l, .32), .9 + u);
      s += sconce(r.x - 30, wallY(r, .32), .9 + u);
    });

    // Every candle flame on the tables, collected while the decor was drawn.
    flames.forEach(([x, y, sc]) => {
      s += ell(x, y, 21 * sc, 25 * sc, 'fill="url(#gGlow)" opacity=".75"');
      s += ell(x, y, 3.4 * sc, 7 * sc, 'fill="#fff4d4"');
    });

    return `<g id="hall-lights">${s}</g>`;
  }

  /* -------------------------------------------------------- LAYER 3 decor -- */

  function floral(cx, cy, s) {
    let g = '';
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2, d = (0.55 + rnd() * 0.55) * s * 46;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * .62;
      g += ell(x, y, 11 * s, 5 * s,
        `fill="#8d9d76" opacity=".85" transform="rotate(${r2(rnd() * 360)} ${r2(x)} ${r2(y)})"`);
    }
    // The underside of the arrangement, which is where a cluster of blooms
    // gets its volume from.
    g += ell(cx, cy + s * 20, s * 40, s * 22, 'fill="rgba(112,98,72,.22)" filter="url(#fSoft)"');

    const whites = ['#ffffff', '#fdfaf3', '#f2ebda', '#e6dcc6', '#fbf6ea'];
    for (let i = 0; i < 20; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * s * 40;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * .68;
      const r = (5.5 + rnd() * 6) * s;
      // Blooms low in the cluster sit in its shadow.
      const lit = (y - cy) / (s * 40);
      g += circ(x, y, r, `fill="${whites[i % whites.length]}"`);
      if (lit > .1) g += circ(x, y, r, `fill="rgba(116,100,72,${r2(.06 + lit * .12)})"`);
      g += circ(x - r * .24, y - r * .26, r * .42, 'fill="#ffffff" opacity=".9"');
    }
    return g;
  }

  function chiavari(cx, groundY, s) {
    const w = 46 * s, h = 92 * s, seatY = groundY - 44 * s;
    const gold = `stroke="url(#gGold)" stroke-width="${r2(3.4 * s)}" fill="none" stroke-linecap="round"`;
    let g = '';
    g += ell(cx, groundY + 3 * s, w * .62, 6 * s, 'fill="rgba(96,80,52,.2)" filter="url(#fSoft)"');
    // The legs splay very slightly — dead-parallel legs read as a sprite.
    g += line(cx - w / 2, seatY, cx - w / 2 - 3 * s, groundY, gold);
    g += line(cx + w / 2, seatY, cx + w / 2 + 3 * s, groundY, gold);
    g += line(cx - w / 2 + 8 * s, seatY + 4 * s, cx - w / 2 + 5 * s, groundY - 8 * s, gold);
    g += line(cx + w / 2 - 8 * s, seatY + 4 * s, cx + w / 2 - 5 * s, groundY - 8 * s, gold);
    g += line(cx - w / 2 - 2 * s, groundY - 18 * s, cx + w / 2 + 2 * s, groundY - 18 * s, gold);
    // Cushion.
    g += rect(cx - w / 2 - 2 * s, seatY - 9 * s, w + 4 * s, 12 * s,
      `fill="#fbf7ed" stroke="rgba(198,162,66,.55)" stroke-width="${r2(1.6 * s)}" rx="${r2(3 * s)}"`);
    // Back: two stiles, three bamboo rails, crest rail on top.
    const backTop = seatY - h * .62;
    g += line(cx - w / 2 + 2 * s, seatY - 6 * s, cx - w / 2 + 4 * s, backTop, gold);
    g += line(cx + w / 2 - 2 * s, seatY - 6 * s, cx + w / 2 - 4 * s, backTop, gold);
    for (let i = 1; i <= 3; i++) {
      const y = lerp(seatY - 10 * s, backTop + 6 * s, i / 4);
      g += line(cx - w / 2 + 3 * s, y, cx + w / 2 - 3 * s, y, gold);
    }
    g += line(cx - w / 2 + 4 * s, backTop, cx + w / 2 - 4 * s, backTop, gold);
    return g;
  }

  function goblet(cx, baseY, s) {
    const a = `stroke="rgba(255,255,255,.8)" stroke-width="${r2(1.6 * s)}" fill="rgba(255,255,255,.2)"`;
    return `<path d="M${r2(cx - 7 * s)} ${r2(baseY - 34 * s)} q ${r2(7 * s)} ${r2(20 * s)} 0 ${r2(22 * s)} q ${r2(-7 * s)} ${r2(-2 * s)} 0 ${r2(-22 * s)} Z" ${a}/>` +
      line(cx, baseY - 12 * s, cx, baseY - 2 * s, `stroke="rgba(255,255,255,.65)" stroke-width="${r2(1.4 * s)}"`) +
      ell(cx, baseY, 6 * s, 2.2 * s, 'fill="rgba(255,255,255,.4)"');
  }

  // A dressed banquet round: linen to the floor, centrepiece, candles, covers.
  function table(cx, cy, rx, ry, drop, s, flames) {
    let g = '';
    g += ell(cx, cy + drop, rx * 1.05, ry * .95, 'fill="rgba(96,80,52,.22)" filter="url(#fSoft)"');
    g += `<path d="M${r2(cx - rx)} ${r2(cy)} L ${r2(cx - rx * .94)} ${r2(cy + drop)} Q ${r2(cx)} ${r2(cy + drop + ry * 1.15)} ${r2(cx + rx * .94)} ${r2(cy + drop)} L ${r2(cx + rx)} ${r2(cy)} Z" fill="url(#gCloth)"/>`;
    for (let i = -3; i <= 3; i++) {
      const x = cx + (rx * .78) * (i / 3.4);
      g += `<path d="M${r2(x)} ${r2(cy + ry * .5)} Q ${r2(x + 8 * s)} ${r2(cy + drop * .6)} ${r2(x)} ${r2(cy + drop + ry * .5)}" fill="none" stroke="rgba(140,122,90,.16)" stroke-width="${r2(4 * s)}"/>`;
    }
    // Form on the skirt: shade away from the windows, warmth toward them.
    g += ell(cx - rx * .42, cy + drop * .42, rx * .6, drop * .55,
      'fill="rgba(118,100,70,.16)" filter="url(#fSoft)"');
    g += ell(cx + rx * .5, cy + drop * .34, rx * .42, drop * .46,
      'fill="#fff1d2" opacity=".34" filter="url(#fSoft)"');

    g += ell(cx, cy, rx, ry, 'fill="#fffdf8"');
    // The tabletop is not a disc of one colour either — it falls off toward
    // the far rim where the cloth turns away from the light.
    g += ell(cx, cy - ry * .3, rx * .92, ry * .6,
      'fill="rgba(126,108,78,.1)" filter="url(#fSoft)"');
    g += ell(cx, cy, rx, ry, 'fill="none" stroke="rgba(150,130,96,.25)" stroke-width="1.6"');

    // Centrepiece: tall floral in a glass vase.
    g += `<path d="M${r2(cx - 15 * s)} ${r2(cy - ry * .1)} l ${r2(4 * s)} ${r2(-58 * s)} h ${r2(22 * s)} l ${r2(4 * s)} ${r2(58 * s)} Z" fill="rgba(255,255,255,.4)" stroke="rgba(255,255,255,.65)" stroke-width="${r2(1.6 * s)}"/>`;
    g += floral(cx, cy - ry * .1 - 80 * s, s * 1.3);

    // Covers around the near rim: plate, glass, then the candles.
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (0.08 + 0.84 * (i / (n - 1)));
      const px = cx - Math.cos(a) * rx * .74, py = cy + Math.sin(a) * ry * .74;
      g += ell(px, py, 15 * s, 5.5 * s, 'fill="#ffffff" stroke="rgba(202,170,108,.55)" stroke-width="1.2"');
      g += goblet(px + 15 * s, py - 4 * s, s);
    }
    [[-.46, .28], [.46, .28], [0, .55]].forEach(([fx, fy], i) => {
      const px = cx + rx * fx, py = cy + ry * fy;
      const hgt = (26 + i * 8) * s;
      g += rect(px - 6 * s, py - hgt, 12 * s, hgt, 'fill="#fdfaf2" stroke="rgba(202,170,108,.45)" stroke-width="1.2"');
      flames.push([px, py - hgt - 5 * s, s]);
    });
    return g;
  }

  // One dressed round plus its chairs, drawn in depth order: the chairs on
  // the far side go down first so the linen occludes them, the near ones
  // after so their backs cross the cloth.
  function setting(cx, cy, rx, ry, drop, s, flames) {
    // Ground contact, not decoration: the far pair stands just beyond the
    // table's back rim, the near pair just in front of where the linen meets
    // the floor. Anything between the two would be standing on the cloth.
    const far  = [[cx - rx * .5, cy - ry * 1.1], [cx + rx * .5, cy - ry * 1.1]];
    const hem  = cy + drop + ry * .5;
    const near = [[cx - rx * .62, hem - ry * .18], [cx + rx * .62, hem - ry * .18], [cx, hem]];
    let g = far.map(([x, y]) => chiavari(x, y, s * .82)).join('');
    g += table(cx, cy, rx, ry, drop, s, flames);
    g += near.map(([x, y]) => chiavari(x, y, s * .95)).join('');
    return g;
  }

  function decor(flames) {
    let s = '';

    // Back wall: urns on pedestals flanking the entrance, low greenery banked
    // against the skirting either side.
    [566, 1034].forEach(x => {
      s += rect(x - 30, 568, 60, 104, 'fill="#f9f3e7" stroke="rgba(198,162,66,.4)" stroke-width="1.6"');
      s += rect(x - 38, 560, 76, 12, 'fill="#fcf7ec" stroke="rgba(198,162,66,.34)" stroke-width="1.4"');
      s += ell(x, 552, 30, 12, 'fill="#f5edda" stroke="rgba(198,162,66,.34)" stroke-width="1.4"');
      s += floral(x, 524, 1.05);
    });
    [[478, 666], [1122, 666]].forEach(([x, y]) => {
      s += ell(x, y, 54, 20, 'fill="#8d9d76" opacity=".9"');
      s += floral(x, y - 14, .62);
    });

    // Four dressed rounds: two mid-room, two running out of the bottom
    // corners of frame the way the reference photograph does.
    // Drop is tied to the ellipse's minor axis (~2.3x) — that ratio is what
    // sets how tall the table reads at its distance. Guess at it and the
    // linen either floats or pools.
    s += setting(258, 744, 132, 34, 78, .72, flames);
    s += setting(1344, 737, 128, 33, 76, .70, flames);
    s += setting(-26, 908, 300, 70, 172, 1.36, flames);
    s += setting(1630, 894, 296, 69, 174, 1.32, flames);

    return `<g id="hall-decor">${s}</g>`;
  }

  /* ------------------------------------------------------------ assembly -- */

  function buildSvg() {
    seed = 20260910;
    const flames = [];
    const decorMarkup = decor(flames);   // collects flame positions as it draws
    return `<svg class="hall-svg" viewBox="0 0 ${VBW} ${VBH}"
        preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      ${defs()}
      ${ceiling()}
      ${backWall()}
      ${sideWalls()}
      ${doorway()}
      ${floor()}
      ${columns()}
      <!-- Plaster and stone tooth. Sits over everything built and under
           everything lit, so the light is never grainy. -->
      <rect x="-1200" y="-1200" width="4000" height="3400" fill="url(#pPlaster)" opacity=".6"/>
      ${lighting(flames)}
      ${decorMarkup}
    </svg>`;
  }

  function buildDoors() {
    // Two leaves, each with face, back, thickness slab, sunk panels, hinges
    // and a brass handle. Everything is a percentage of the leaf, so the same
    // markup fits whatever pixel box the mapping hands it.
    const leaf = side => `
      <div class="door-leaf door-${side}">
        <div class="door-face">
          <div class="door-panel" style="left:14%; right:14%; top:6%; height:52%;"></div>
          <div class="door-panel" style="left:14%; right:14%; top:63%; height:30%;"></div>
          <div class="door-handle" style="${side === 'left' ? 'right:7%' : 'left:7%'}; top:57%; height:9%;"></div>
          <div class="door-hinge" style="${side === 'left' ? 'left:0' : 'right:0'}; top:11%; height:6%;"></div>
          <div class="door-hinge" style="${side === 'left' ? 'left:0' : 'right:0'}; top:47%; height:6%;"></div>
          <div class="door-hinge" style="${side === 'left' ? 'left:0' : 'right:0'}; top:83%; height:6%;"></div>
        </div>
        <div class="door-back"></div>
        <div class="door-edge"></div>
        <div class="door-hinge-edge"><i></i><i></i><i></i></div>
      </div>`;
    // Order is depth order: daylight at the back, then the garden's own light,
    // then the reveal's shadow, then the leaves in front of all of it.
    return '<div class="doorway-void"></div>'
         + '<div class="garden-glow"></div>'
         + '<div class="doorway-shadow"></div>'
         + leaf('left') + leaf('right');
  }

  /* ----------------------------------------------------------- photo mode --

     The drawn hall is the fallback, not the destination. Drop three files
     into assets/ and the hero swaps to a rendered plate, keeping the door
     rig exactly as it is:

       hero-plate.jpg        the room, photographed, doorway standing OPEN
                             with daylight beyond it (the doors are removed)
       hero-door-left.png    the left leaf, cut out, transparent background
       hero-door-right.png   the right leaf, likewise

     The plate supplies every surface; the two PNGs are hung in the same
     .door-leaf elements that already swing on rotateY, so the cinematic is
     untouched. See assets/hero-plate.prompt.md for the generation prompts
     and the crop procedure.
     ---------------------------------------------------------------------- */

  const PLATE_SRC = {
    room:  'assets/hero-plate.jpg',
    left:  'assets/hero-door-left.png',
    right: 'assets/hero-door-right.png',
  };

  let photo = false, plateW = 0, plateH = 0;

  function probe(src) {
    return new Promise(function (res) {
      const i = new Image();
      i.onload = function () { res(i); };
      i.onerror = function () { res(null); };
      i.src = src;
    });
  }

  /* ------------------------------------------------------------- mounting -- */

  const hero = document.getElementById('hero');
  if (!hero) return;

  const camera = hero.querySelector('.hall-camera');
  camera.insertAdjacentHTML('afterbegin', buildSvg());

  const svgEl = hero.querySelector('.hall-svg');
  const doorwayEl = hero.querySelector('.doorway');

  // Where the opening sits in the plate, as fractions of its width and
  // height. Defaults to where it sits in the drawing; override in the markup
  // with data-door-rect="x,y,w,h" once you have measured your own render.
  const dn = (hero.dataset.doorRect || '').split(',').map(Number);
  const DOOR_N = (dn.length === 4 && dn.every(function (n) { return !isNaN(n); }))
    ? { x: dn[0], y: dn[1], w: dn[2], h: dn[3] }
    : { x: (DX0 + 16) / VBW, y: (DY0 + 16) / VBH,
        w: (DX1 - DX0 - 32) / VBW, h: (DY1 - DY0 - 16) / VBH };
  doorwayEl.innerHTML = buildDoors();
  const sheet = hero.querySelector('.light-sheet');

  // Which slice of the drawing the frame shows. `slice` always fills, so on a
  // narrow viewport a 16:10 box would crop to the doorway alone and throw the
  // room away — the taller boxes below trade width for the columns, cornice
  // and floor the shot is actually about. Every box stays centred on x 800,
  // the doorway's axis, so the entrance never drifts off centre.
  function view() {
    const a = hero.clientWidth / Math.max(hero.clientHeight, 1);
    if (a >= 1.45) return { x: 0,   y: 0,    w: 1600, h: 1000 };
    if (a >= 1.05) return { x: 90,  y: -110, w: 1420, h: 1150 };
    if (a >= 0.78) return { x: 190, y: -230, w: 1220, h: 1420 };
    return               { x: 260, y: -320, w: 1080, h: 1580 };
  }

  // Map a viewBox rect to pixels using the same transform `xMidYMid slice`
  // applies, so the HTML leaves sit exactly inside the SVG architrave at any
  // aspect ratio.
  // Must match `perspective` on .cinema-hero. The dolly is a translateZ
  // toward that camera rather than a scale on the plate: magnification then
  // comes from the lens, which is why the doorway grows faster than the walls
  // beside it instead of the whole frame inflating uniformly.
  const PERSP = 1600;
  /* The two knobs for the whole cinematic.

     DOOR_FILL — how much of the frame's height the doorway fills at the end
     of the drift. The reference clip holds the room wide the whole way
     through, so this is deliberately modest: at 0.62 you can still read the
     columns, the tables and both chandeliers while the doors are moving.
     Raise it toward 0.75 to walk right up to the entrance instead.

     DOOR_IN / DOOR_OUT — when the leaves start and finish, as fractions of
     the pinned scroll. The clip has them shut for the first quarter, then
     swinging for roughly the next half, which is the proportion here. */
  const DOOR_FILL = 0.62;
  const DOOR_IN = 0.24, DOOR_OUT = 0.78;

  let dollyZ = 0;

  let lastW = 0, lastH = 0;
  function place() {
    const w = hero.clientWidth, h = hero.clientHeight;
    if (!w || !h) return;
    // The hero can go from zero-height to full height well after load (a
    // hidden tab, a collapsed pane, a device-rotation). ScrollTrigger measured
    // its scroll distance off the old box, so re-measure with it.
    const resized = Math.abs(w - lastW) > 1 || Math.abs(h - lastH) > 1;
    lastW = w; lastH = h;
    if (resized && window.ScrollTrigger) ScrollTrigger.refresh();

    // One cover-fit mapping, two possible source spaces: the SVG's viewBox,
    // or the plate's own pixels. Everything downstream is identical, which is
    // why swapping to a render costs nothing in the door rig.
    let src, door;
    if (photo) {
      src = { x: 0, y: 0, w: plateW, h: plateH };
      door = { x: DOOR_N.x * plateW, y: DOOR_N.y * plateH,
               w: DOOR_N.w * plateW, h: DOOR_N.h * plateH };
    } else {
      src = view();
      svgEl.setAttribute('viewBox', `${src.x} ${src.y} ${src.w} ${src.h}`);
      door = { x: DX0 + 16, y: DY0 + 16, w: DX1 - DX0 - 32, h: DY1 - DY0 - 16 };
    }

    const s = Math.max(w / src.w, h / src.h);
    const ox = (w - src.w * s) / 2 - src.x * s;
    const oy = (h - src.h * s) / 2 - src.y * s;

    const dx = ox + door.x * s, dy = oy + door.y * s;
    const dw = door.w * s, dh = door.h * s;
    doorwayEl.style.left = dx + 'px';
    doorwayEl.style.top = dy + 'px';
    doorwayEl.style.width = dw + 'px';
    doorwayEl.style.height = dh + 'px';

    // Thickness, in the leaf's own terms: a 12cm stile on a 90cm leaf.
    doorwayEl.style.setProperty('--door-thick', (dw / 2) * 0.133 + 'px');

    // How far to walk. Solve the perspective magnification for the Z that
    // makes the opening fill DOOR_FILL of the frame, rather than guessing a
    // scale factor that only happens to look right at one aspect ratio.
    const mag = Math.min(2.4, Math.max(1, (h * DOOR_FILL) / dh));
    dollyZ = PERSP * (1 - 1 / mag);

    // The light sheet grows out of the middle of the opening.
    const size = dw * 1.4;
    sheet.style.width = size + 'px';
    sheet.style.height = size + 'px';
    sheet.style.left = (dx + dw / 2 - size / 2) + 'px';
    sheet.style.top = (dy + dh / 2 - size / 2) + 'px';
  }

  place();
  window.addEventListener('resize', place);
  if (window.ResizeObserver) new ResizeObserver(place).observe(hero);

  // The hero's 100vh box is not resolved at end-of-body time (the Tailwind
  // CDN is still installing its stylesheet), and a ScrollTrigger pin created
  // against a zero-height section locks that zero in permanently — the room
  // vanishes and the spacer balloons. So: wait for a real box, then measure,
  // then pin.
  function whenSized(fn) {
    let tries = 0;
    (function tick() {
      if (hero.clientHeight > 0 && document.readyState === 'complete') return fn();
      if (++tries > 240) {
        // Four seconds of frames and still no box. Stop spinning and wait for
        // one to arrive instead — a background tab pauses rAF entirely, and
        // building the pin against a zero-height hero is the one outcome
        // worse than building it late.
        if (window.ResizeObserver) {
          const ro = new ResizeObserver(function () {
            if (hero.clientHeight > 0) { ro.disconnect(); fn(); }
          });
          ro.observe(hero);
        } else {
          setTimeout(tick, 250);
        }
        return;
      }
      requestAnimationFrame(tick);
    })();
  }

  /* ------------------------------------------------------------- timeline -- */

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nav = document.querySelector('.nav-cinematic');
  const pill = nav && nav.querySelector('.nav-pill');
  // setTimeout rather than requestAnimationFrame: rAF does not fire while the
  // tab is hidden, and a navbar that only appears once you look at the page
  // is worse than one that is simply there.
  if (nav) setTimeout(() => nav.classList.add('is-in'), 60);

  // Hang the render, if it is there.
  function enterPhotoMode(img) {
    photo = true;
    plateW = img.naturalWidth;
    plateH = img.naturalHeight;
    hero.classList.add('photo-mode');
    camera.insertAdjacentHTML('afterbegin',
      `<img class="hall-plate" src="${PLATE_SRC.room}" alt="" aria-hidden="true">`
      + '<div class="plate-dim"></div>');
    // The leaves keep their frame, their hinges and their thickness; only the
    // face they carry changes.
    hero.querySelectorAll('.door-left .door-face, .door-left .door-back')
      .forEach(function (el) { el.style.backgroundImage = `url("${PLATE_SRC.left}")`; });
    hero.querySelectorAll('.door-right .door-face, .door-right .door-back')
      .forEach(function (el) { el.style.backgroundImage = `url("${PLATE_SRC.right}")`; });
    place();
  }

  Promise.all([probe(PLATE_SRC.room), probe(PLATE_SRC.left), probe(PLATE_SRC.right)])
    .then(function (imgs) {
      // All three or none — half a swap is worse than no swap.
      if (imgs[0] && imgs[1] && imgs[2]) enterPhotoMode(imgs[0]);
    })
    .then(start, start);

  function start() {
  whenSized(function () {
    place();

    if (reduced || !window.gsap || !window.ScrollTrigger) {
      // No scrub: show the room lit, doors shut, nav available.
      const lights = hero.querySelector('#hall-lights');
      if (lights) lights.style.opacity = '1';
      const dim = hero.querySelector('.plate-dim');
      if (dim) dim.style.opacity = '0';
      if (nav) nav.style.opacity = '1';
      return;
    }

    gsap.registerPlugin(ScrollTrigger);

    // Single tweens off a known base state — nothing here reads its own
    // current value, so scrubbing backwards cannot compound the dolly.
    gsap.set('.hall-camera', { z: 0, scale: 1, transformOrigin: '50% 47%' });
    gsap.set('.door-left', { rotateY: 0 });
    gsap.set('.door-right', { rotateY: 0 });

    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: '#hero',
        start: 'top top',
        // Resolved in pixels rather than '+=420%', which measures against the
        // pinned element and compounds if that element is ever mis-sized.
        end: () => '+=' + Math.max(window.innerHeight, hero.clientHeight, 600) * 3.2,
        scrub: 1.1,
        pin: true,
        pinSpacing: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        // Ivory glass over the hall, smoked glass over the dark sections
        // below — one pill, two coats.
        onLeave: () => pill && pill.classList.add('on-dark'),
        onEnterBack: () => pill && pill.classList.remove('on-dark'),
      },
    });

    /* ------------------------------------------------------------ stages --

       Matched to the reference clip, which is built round the swing rather
       than round a zoom:

         the drift    0.00-1.00   one continuous, unhurried move forward. It
                                  never crops the room — the whole hall stays
                                  in frame from first scroll to last, exactly
                                  as the clip does.
         the doors    0.10-0.72   shut for the first tenth, then a long slow
                                  swing inward on their hinges. This is the
                                  event; the drift is only underneath it.
         the outside  0.12-0.74   the garden arriving through the widening
                                  gap, and the sunlight spreading with it.

       The drift is one tween across the whole scrub, so there is no seam
       where a second camera move takes over — and it is `ease: none`, because
       a real dolly holds its speed. fromTo with an explicit start, and a
       function for the end value, so a resize re-solves it and scrubbing
       backwards cannot compound it. */

    tl.fromTo('.hall-camera', { z: 0 },
      { z: () => dollyZ, duration: 1, ease: 'none' }, 0);

    // The crystal comes up early and then holds — no flicker later while the
    // doors are the thing being watched.
    if (photo) tl.to('.plate-dim', { opacity: 0, duration: 0.3, ease: 'power1.in' }, 0.02);
    else tl.to('#hall-lights', { opacity: .88, duration: 0.3, ease: 'power1.in' }, 0.02);
    tl.to('.hall-caption', { opacity: 0, duration: 0.1 }, 0.04);

    /* The swing. 118 degrees, which is past square on purpose.

       Measured off the reference clip: when its doors are open, each leaf
       sits *beside* the opening rather than inside it, about 0.6 of its shut
       width, with a bright painted face turned toward camera. That only
       happens past 90 — the leaf has folded back toward the interior wall and
       what you are looking at is its other side. Anywhere near 90 is the dead
       zone where the leaf is edge-on and reads as a sliver of thickness,
       which is exactly what it looked like before this.

       power2.inOut gives them their weight at both ends of the arc. */
    const swing = DOOR_OUT - DOOR_IN;
    tl.to('.door-left', { rotateY: -118, duration: swing, ease: 'power2.inOut' }, DOOR_IN);
    tl.to('.door-right', { rotateY: 118, duration: swing, ease: 'power2.inOut' }, DOOR_IN);

    // The outside, arriving with the gap rather than after it.
    tl.fromTo('.garden-glow', { opacity: 0 },
      { opacity: 1, duration: swing * .92, ease: 'power1.in' }, DOOR_IN + .02);

    // Sunlight widening across the marble as the opening widens.
    tl.fromTo('.floor-bloom', { opacity: 0, scale: 0.5 },
      { opacity: 1, scale: 1.22, duration: swing, ease: 'power1.out' }, DOOR_IN + .02);

    // Drawn mode has no photographed garden to reveal, so the painted
    // daylight stands in for it. In photo mode it would cover the real one.
    if (!photo) tl.to('.doorway-void', { opacity: 1, duration: swing * .8 }, DOOR_IN + .02);

    ScrollTrigger.refresh();
  });
  }
})();
