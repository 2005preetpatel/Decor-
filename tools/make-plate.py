#!/usr/bin/env python3
"""
make-plate.py — turn one photograph of a ballroom into the three files the
hero needs, so the room is a real photo and the doors still open.

    python tools/make-plate.py assets/hero-source.jpg --check
    python tools/make-plate.py assets/hero-source.jpg --rect 737,228,348,384

The problem this solves: a photograph has its doors closed and painted into
the pixels. Nothing is behind them, so nothing can be revealed. This cuts the
two leaves out as their own transparent PNGs and paints daylight into the hole
they leave, giving the hero a plate whose entrance genuinely stands open —
with the leaves hung back over it on real hinges.

Outputs, all into assets/ next to the source:

    hero-plate.jpg        the room, doorway open onto daylight
    hero-door-left.png    the left leaf
    hero-door-right.png   the right leaf

Run with --check first: it writes hero-plate-check.png with the rectangle
drawn on, so you can see whether you have the opening before you commit to it.

Requires Pillow (pip install pillow).
"""

import argparse
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageEnhance
except ImportError:
    sys.exit('Pillow is required:  pip install pillow')


# ------------------------------------------------------------------ grading --
#
# Baked into the files rather than done with CSS filters at runtime. A filter
# on the plate would be re-rasterised on every frame of the dolly — the hero
# magnifies it 2.4x — whereas a LUT costs nothing once it is in the pixels.
#
# The grade and the depth of field are applied to the plate AND to both leaf
# cut-outs, from the same curves. Grade one and not the others and the doors
# stop belonging to the room.

def _lut():
    """A warm filmic curve: champagne in the highlights, bronze in the
    shadows, and a gentle S through the midtones for cinematic contrast
    without crushing anything."""
    r, g, b = [], [], []
    for i in range(256):
        x = i / 255.0
        # Gentle S-curve, blended with identity so it stays soft.
        s_curve = x * x * (3 - 2 * x)
        v = x * 0.62 + s_curve * 0.38

        # Highlights lean champagne, shadows lean bronze. The weighting is
        # what keeps it warm without going orange: red lifts everywhere,
        # green only in the highlights, blue falls off at both ends.
        hi = v ** 2.1           # how "highlight" this value is
        lo = (1 - v) ** 2.1     # how "shadow" it is

        rv = v + 0.045 * hi + 0.028 * lo
        gv = v + 0.022 * hi - 0.004 * lo
        bv = v - 0.030 * hi - 0.055 * lo

        r.append(max(0, min(255, int(round(rv * 255)))))
        g.append(max(0, min(255, int(round(gv * 255)))))
        b.append(max(0, min(255, int(round(bv * 255)))))
    return r + g + b


_LUT = _lut()


def grade(img):
    out = img.convert('RGB').point(_LUT)
    # A whisker of saturation. Any more and the golds go brassy, which is the
    # difference between "warm" and "oversaturated".
    return ImageEnhance.Color(out).enhance(1.06)


def _screen(base, top):
    """Screen blend: brightens without the clipping an additive blend gives."""
    from PIL import ImageChops
    return ImageChops.screen(base, top)


def marble_lift(img):
    """Bring the floor reflections up.

    A screen-blended warm wash over the lower half only. The marble is the
    brightest surface in the room and should read that way, but lifting the
    whole frame would flatten the contrast the grade just built."""
    w, h = img.size
    mask = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse([-w * 0.15, int(h * 0.62), int(w * 1.15), int(h * 1.5)], fill=46)
    mask = mask.filter(ImageFilter.GaussianBlur(w * 0.05))
    warm = Image.new('RGB', (w, h), (255, 246, 224))
    return Image.composite(_screen(img, warm), img, mask)


def depth_of_field(img, strength):
    """Throw the foreground corners softly out of focus.

    The plate is one flat photograph, so there is no real focal plane to work
    with — but the tables and flowers in the bottom corners are the nearest
    things in shot, and softening them is what gives the frame its depth. The
    mask is generously blurred: a hard-edged focus falloff looks like a
    vignette, not like a lens."""
    w, h = img.size
    blurred = img.filter(ImageFilter.GaussianBlur(strength))
    m = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(m)
    # The two foreground table clusters, left and right.
    d.ellipse([-w * 0.34, int(h * 0.60), int(w * 0.40), int(h * 1.40)], fill=205)
    d.ellipse([int(w * 0.60), int(h * 0.60), int(w * 1.34), int(h * 1.40)], fill=205)
    # And the very bottom edge, closest of all.
    d.rectangle([0, int(h * 0.94), w, h], fill=150)
    m = m.filter(ImageFilter.GaussianBlur(w * 0.055))
    return Image.composite(blurred, img, m)


# The door opening in the reference photograph, as fractions of the frame.
# These are a starting guess, not a measurement of your image — run --check.
DEFAULT_RECT = (0.409, 0.261, 0.194, 0.439)


def parse_rect(text, size):
    """Accept pixels (737,228,348,384) or fractions (0.409,0.261,0.194,0.439)."""
    parts = [float(n) for n in text.split(',')]
    if len(parts) != 4:
        raise ValueError('--rect needs four numbers: x,y,w,h')
    w, h = size
    if all(p <= 1.0 for p in parts):          # fractions
        return (round(parts[0] * w), round(parts[1] * h),
                round(parts[2] * w), round(parts[3] * h))
    return tuple(round(p) for p in parts)     # pixels


def daylight(w, h):
    """What stands beyond the doorway: blown-out white at the centre falling
    to warm cream at the edges. Built small and scaled up, which is both fast
    and exactly the softness a real overexposed exterior has."""
    small = Image.new('RGB', (64, 64))
    px = small.load()
    for yy in range(64):
        for xx in range(64):
            dx, dy = (xx - 32) / 32.0, (yy - 42) / 42.0
            d = min(1.0, (dx * dx + dy * dy) ** 0.5)
            f = d * d
            px[xx, yy] = (int(255 - 26 * f), int(252 - 44 * f), int(238 - 84 * f))
    return small.resize((w, h), Image.BICUBIC)


def open_the_doorway(img, rect, fill=None):
    """Replace the closed doors with daylight, and shade the reveal so the
    wall still reads as having thickness.

    `fill` is an optional image to put in the opening instead of the painted
    gradient — a second render of the same room with its doors open, so what
    stands beyond the entrance is the actual view rather than a wash."""
    x, y, w, h = rect
    plate = img.copy()
    plate.paste((fill.resize((w, h), Image.LANCZOS) if fill else daylight(w, h)), (x, y))

    # The jamb: dark under the lintel, dark down the right (the light comes
    # from the right, so the right reveal turns away from it), light down the
    # left. Drawn onto an overlay so it can be alpha-composited.
    jamb = max(4, round(w * 0.055))
    ov = Image.new('RGBA', plate.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    d.rectangle([x, y, x + w, y + jamb], fill=(74, 60, 38, 165))            # head
    d.rectangle([x + w - jamb, y, x + w, y + h], fill=(96, 78, 52, 130))    # right
    d.rectangle([x, y, x + jamb, y + h], fill=(255, 246, 224, 90))          # left
    ov = ov.filter(ImageFilter.GaussianBlur(max(1, jamb // 3)))
    plate = Image.alpha_composite(plate.convert('RGBA'), ov).convert('RGB')

    # Spill: the new light washes a little onto the floor at the threshold.
    spill = Image.new('RGBA', plate.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(spill)
    sd.ellipse([x - w * 0.30, y + h - h * 0.05,
                x + w + w * 0.30, y + h + h * 0.16],
               fill=(255, 244, 216, 58))
    # Generously blurred: a hard-edged oval on the marble reads as a rug.
    spill = spill.filter(ImageFilter.GaussianBlur(max(10, w // 5)))
    return Image.alpha_composite(plate.convert('RGBA'), spill).convert('RGB')


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('source', help='the ballroom photograph, doors closed')
    ap.add_argument('--rect', help='door opening as x,y,w,h — pixels or fractions')
    ap.add_argument('--check', action='store_true',
                    help='only write hero-plate-check.png with the rect drawn on')
    ap.add_argument('--out', help='output directory (default: alongside the source)')
    ap.add_argument('--fill-from', metavar='IMAGE',
                    help='second render of the same room with the doors OPEN; '
                         'what shows through the entrance is taken from it '
                         'instead of being painted')
    ap.add_argument('--fill-rect', metavar='X,Y,W,H',
                    help='the aperture within --fill-from (defaults to --rect)')
    ap.add_argument('--leaves-from', metavar='IMAGE',
                    help='take the two leaves from this image instead of the source')
    ap.add_argument('--leaves-rect', metavar='X,Y,W,H',
                    help='the closed doors within --leaves-from (defaults to --rect)')
    ap.add_argument('--grade', action='store_true',
                    help='bake the warm filmic grade into the plate and both '
                         'leaves, and lift the marble reflections')
    ap.add_argument('--dof', type=float, default=0, metavar='PX',
                    help='soften the foreground corners of the plate by this '
                         'blur radius (try 7); 0 disables')
    a = ap.parse_args()

    img = Image.open(a.source).convert('RGB')
    out = a.out or os.path.dirname(os.path.abspath(a.source))
    rect = parse_rect(a.rect, img.size) if a.rect else parse_rect(
        ','.join(str(v) for v in DEFAULT_RECT), img.size)
    x, y, w, h = rect

    if not (0 <= x < x + w <= img.width and 0 <= y < y + h <= img.height):
        sys.exit('rect %s falls outside the %dx%d image' % (rect, img.width, img.height))
    if w < 40 or h < 40:
        sys.exit('rect is too small to be a doorway: %s' % (rect,))

    if a.check:
        # Check every image the run will touch, each against its own rect —
        # a rect that is right for one render is only a guess for the next.
        targets = [(a.source, img, rect, 'hero-plate-check.png')]
        for path, rc, name in ((a.fill_from, a.fill_rect, 'hero-fill-check.png'),
                               (a.leaves_from, a.leaves_rect, 'hero-leaves-check.png')):
            if path:
                im2 = Image.open(path).convert('RGB')
                targets.append((path, im2,
                                parse_rect(rc, im2.size) if rc else rect, name))
        for path, im2, rc, name in targets:
            chk = im2.copy()
            d = ImageDraw.Draw(chk)
            rx, ry, rw, rh = rc
            d.rectangle([rx, ry, rx + rw, ry + rh], outline=(255, 0, 128), width=max(2, rw // 90))
            d.line([rx + rw // 2, ry, rx + rw // 2, ry + rh],
                   fill=(0, 200, 255), width=max(1, rw // 160))
            chk.save(os.path.join(out, name))
            print('wrote %s  (%s)  rect x=%d y=%d w=%d h=%d'
                  % (name, os.path.basename(path), rx, ry, rw, rh))
        p = os.path.join(out, 'hero-plate-check.png')
        print('wrote %s' % p)
        print('rect  x=%d y=%d w=%d h=%d' % rect)
        print('as fractions for data-door-rect: %.3f,%.3f,%.3f,%.3f'
              % (x / img.width, y / img.height, w / img.width, h / img.height))
        print('\nThe magenta box must sit on the opening — the hole in the wall,')
        print('not the architrave around it. The cyan line must land on the')
        print('centre stile where the two leaves meet. Re-run with --rect until')
        print('it does, then drop --check.')
        return

    # The two leaves, cut from whichever render actually shows them shut.
    if a.leaves_from:
        lim = Image.open(a.leaves_from).convert('RGB')
        lr = parse_rect(a.leaves_rect, lim.size) if a.leaves_rect else rect
    else:
        lim, lr = img, rect
    lx, ly, lw, lh = lr
    half = lw // 2
    leafL = lim.crop((lx, ly, lx + half, ly + lh))
    leafR = lim.crop((lx + half, ly, lx + lw, ly + lh))
    if a.grade:
        # Same curves as the plate, no marble lift and no defocus: the leaves
        # are mid-ground and they have no floor in them.
        leafL, leafR = grade(leafL), grade(leafR)
    leafL.save(os.path.join(out, 'hero-door-left.png'))
    leafR.save(os.path.join(out, 'hero-door-right.png'))

    # What stands beyond the entrance.
    fill = None
    if a.fill_from:
        fim = Image.open(a.fill_from).convert('RGB')
        fr = parse_rect(a.fill_rect, fim.size) if a.fill_rect else rect
        fill = fim.crop((fr[0], fr[1], fr[0] + fr[2], fr[1] + fr[3]))

    plate = open_the_doorway(img, rect, fill)
    if a.grade:
        plate = marble_lift(grade(plate))
    if a.dof:
        plate = depth_of_field(plate, a.dof)
    plate.save(os.path.join(out, 'hero-plate.jpg'), quality=92, subsampling=0)

    print('wrote hero-plate.jpg, hero-door-left.png, hero-door-right.png -> %s' % out)
    print('\nNow put this on the hero section in index.html:')
    print('  data-door-rect="%.3f,%.3f,%.3f,%.3f"'
          % (x / img.width, y / img.height, w / img.width, h / img.height))


if __name__ == '__main__':
    main()
