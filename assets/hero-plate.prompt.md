# Hero plate — putting a real photograph behind the door

The hero ships with a drawn hall as its fallback. Put three files in `assets/`
and it swaps itself to a photograph — and the doors still open, because the
leaves stay separate DOM elements on real hinges.

| File | What it is |
|---|---|
| `hero-plate.jpg` | The room. Doorway standing **open**, daylight beyond it. |
| `hero-door-left.png` | The left leaf alone. |
| `hero-door-right.png` | The right leaf alone. |

All three or none — `hero-scene.js` will not half-swap. Until they exist the
console shows three 404s on load: that is the probe looking for them, and the
page carries on without them by design.

---

## Fastest route: use the photograph you already have

If you have a render or photo of the ballroom with its **doors closed**, you
do not need to generate anything else. `tools/make-plate.py` cuts the two
leaves out of it and paints daylight into the hole they leave.

```bash
pip install pillow
```

**1. Save your photograph** as `assets/hero-source.jpg`.

**2. Find the door opening.** The `--check` pass draws the rectangle on a copy
so you can see whether you have it:

```bash
python tools/make-plate.py assets/hero-source.jpg --check
```

Open `assets/hero-plate-check.png`. The magenta box must sit on the **opening**
— the hole in the wall, not the architrave around it. The cyan line must land
on the centre stile where the two leaves meet. If it is off, pass your own
rectangle (pixels or fractions, either works) and look again:

```bash
python tools/make-plate.py assets/hero-source.jpg --check --rect 737,228,348,384
```

**3. Cut it.** Drop `--check` and it writes the three files:

```bash
python tools/make-plate.py assets/hero-source.jpg --rect 737,228,348,384
```

**4. Register it.** The script prints a `data-door-rect` line. Put it on the
hero section in `index.html`:

```html
<section id="hero" class="cinema-hero" data-door-rect="0.409,0.261,0.194,0.439">
```

**5. Reload**, then scroll to about 80% and check the leaves swing clear of
the jamb and cover it exactly when shut. Nudge the rect and reload if not.

### Best case: two renders of the same room

If you have the room twice from one seed — once with the doors **closed**,
once with them **open** — you can have the actual view beyond the entrance
instead of a painted wash. The leaves come from the closed frame, the daylight
comes from the aperture in the open one:

```bash
python tools/make-plate.py assets/hero-source-closed.png --rect 638,361,234,340 --fill-from assets/hero-source-open.png --fill-rect 652,360,198,338
```

Two rects, because they are two separate generations and the aperture in the
open frame is never exactly where the doors were in the closed one. `--check`
draws both at once so you can line them up before committing:

```bash
python tools/make-plate.py assets/hero-source-closed.png --check --rect 638,361,234,340 --fill-from assets/hero-source-open.png --fill-rect 652,360,198,338
```

That writes `hero-plate-check.png` and `hero-fill-check.png`. On the closed
frame the magenta box goes on the doors; on the open one it goes on the hole
they left, tight enough to miss the swung leaves either side. The crop is
scaled to fit the opening, so a slightly narrow aperture is fine.

**This is what the current plate was built from** — those are the real numbers
for the two 1536x1024 renders in `assets/`.

`--leaves-from` / `--leaves-rect` do the same thing in reverse, if the frame
with the best-looking doors is not the one you want as the room.

### What the script does to the doorway

It replaces the closed doors with blown-out white falling to warm cream, then
shades the reveal so the wall still reads as thick: dark under the lintel,
dark down the right jamb (the light comes from the right, so that side turns
away from it), light down the left. A soft wash spills onto the floor at the
threshold.

One thing it cannot fix: if your photograph shows the **closed doors
reflected** in the marble, that reflection stays in the plate and will be
wrong once the doors open. Paint it out in any editor if it bothers you — it
is under the leaves for the first 70% of the scroll either way.

---

## Why the plate has no doors in it

The doors have to open. If they are baked into the plate there is nothing
behind them and nothing to rotate. So the plate carries the entrance already
standing open, and the two leaves are hung back over it as separate images.
When the timeline rotates them out on `rotateY`, what they uncover is real.

---

## Slower route: generate the room from scratch

If you want a new render rather than one you have, generate the room **with
the doors closed**, then run it through `make-plate.py` exactly as above. One
image in, three out.

> Ultra-photorealistic editorial interior photograph of a neoclassical luxury
> wedding ballroom, shot on a cinema camera with a 24mm architectural lens at
> eye level, perfectly symmetrical one-point perspective, vanishing point dead
> centre, no distortion, no fisheye, no rotation.
>
> A grand centred double door on the back wall, closed — cream painted wood
> panels with champagne gold trim, two sunk panels per leaf (tall above, short
> below), long brass lever handles meeting at the centre stile, brass hinges on
> the outer stiles, set into a thick stone architrave with visible wall depth
> around the opening. The door belongs to the building; it is not applied to it.
>
> Fluted Corinthian columns with gilded capitals down both side walls, three
> bays per side, glossy painted finish, rounded highlights from the sunlight
> and soft shadow wrapping each shaft. Warm ivory plaster walls with real
> subtle imperfections, recessed panels, champagne gold mouldings with
> metallic reflections. Tall multi-pane grid windows fill the right-hand wall
> floor to ceiling with cream drapery. A gilt-framed picture and panelling on
> the left wall, which is in shade.
>
> Golden-hour sunlight enters from the right windows only — soft, warm, no
> overexposure — throwing long hard-edged patches of light, mullion bars and
> all, across the floor and onto the plaster left of the entrance.
>
> A large crystal chandelier hangs top centre, warm 2800K, every crystal
> catching the light with real glass refraction and specular sparkle; a second,
> dimmer chandelier hangs deeper in the room behind it. Brass wall sconces with
> lit candles flank the entrance.
>
> Polished white Calacatta marble floor, mirror-glossy, soft grey veining and a
> dark geometric inlay border, reflecting the chandelier, the windows, the
> chairs and the floral pedestals softly and realistically.
>
> Round banquet tables at the far left and far right of frame, cropped by the
> frame edges, leaving a wide open marble aisle down the centre. Floor-length
> white linen, gold Chiavari chairs with metallic frames and white cushions,
> white hydrangeas and roses in glossy ceramic pedestal vases with natural
> muted green foliage and soft shadows beneath, lit pillar candles, crystal
> glassware.
>
> Warm ivory #F8F3EA walls, champagne gold #D4AF37 trim, white marble with soft
> grey veins, honey-gold sunlight, warm soft brown shadows, pure white flowers.
> Elegant, soft, expensive. Nothing flat; everything with real depth.
>
> **Negative:** illustration, vector art, SVG, flat beige, cartoon, line art,
> matte painting, minimal graphic style, CGI plastic, simplified chandelier,
> glowing blobs, fisheye, tilted horizon, asymmetry, yellow or orange walls,
> overexposure, people, text, watermark.

### Composition to aim for

The blueprint's geometry, as fractions of the frame. No generator hits these
exactly — `data-door-rect` is how you correct for the miss.

| | |
|---|---|
| Doorway opening | x **0.405 → 0.595**, y **0.330 → 0.672** |
| Back wall | x 0.269 → 0.731, y 0.170 → 0.672 |
| Vanishing point | (0.500, 0.478) |
| Floor line at back wall | y 0.672 |
| Window wall | right |
| Key light | right, low, warm |

---

## Removing it

Delete or rename the three files. The drawn hall comes back, unchanged.
