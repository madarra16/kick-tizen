"""Build the app's wide icon from Kick's official wordmark, pixel-aligned so it stays sharp.

The KICK wordmark (ic_kick_logo.svg from the Android TV app) is pixel art on a 28x9 grid.
This reads which cells are filled, then writes a banner SVG where every block is a whole
number of pixels (same proportions as the official TV banner: wordmark ~80% wide, centred,
on #101010) and renders it to PNG with rsvg-convert.

Usage: python3 make_banner.py <ic_kick_logo.svg> <out.svg> <out.png> [width height block]
"""

import re
import subprocess
import sys

COLS, ROWS = 28, 9
BG, FG = "#101010", "#53fc18"


def cells(logo_svg):
    """Filled grid cells of the wordmark, by testing each cell centre against the path."""
    src = open(logo_svg).read()
    vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', src).group(1).split()]
    d = re.search(r' d="([^"]+)"', src).group(1)
    polys, cur, cmd, x, y = [], [], None, 0.0, 0.0
    for tok in re.findall(r"[MLHVZ]|-?\d*\.?\d+", d):
        if tok.isalpha():
            cmd = tok
            if cmd == "Z" and cur:
                polys.append(cur)
                cur = []
            continue
        v = float(tok)
        if cmd == "M":
            cmd, x = "M2", v  # M takes x then y
            continue
        if cmd == "M2":
            y = v
            cur = [(x, y)]
            cmd = "L"
            continue
        if cmd == "H":
            x = v
        elif cmd == "V":
            y = v
        cur.append((x, y))
    if cur:
        polys.append(cur)

    def inside(px, py):  # even-odd rule over all sub-paths
        hit = False
        for poly in polys:
            for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
                if (y1 > py) != (y2 > py) and px < x1 + (py - y1) * (x2 - x1) / (y2 - y1):
                    hit = not hit
        return hit

    uw, uh = vb[2] / COLS, vb[3] / ROWS
    return [[inside((c + 0.5) * uw, (r + 0.5) * uh) for c in range(COLS)] for r in range(ROWS)]


def banner(grid, width, height, block):
    lw, lh = COLS * block, ROWS * block
    ox, oy = (width - lw) // 2 // 2 * 2, (height - lh) // 2 // 2 * 2  # even offsets: sharp at half size too
    rects = []
    for r, row in enumerate(grid):
        c = 0
        while c < COLS:
            if row[c]:
                start = c
                while c < COLS and row[c]:
                    c += 1
                rects.append('<rect x="%d" y="%d" width="%d" height="%d"/>' % (ox + start * block, oy + r * block, (c - start) * block, block))
            else:
                c += 1
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" shape-rendering="crispEdges">'
            '<rect width="%d" height="%d" fill="%s"/><g fill="%s">%s</g></svg>\n') % (width, height, width, height, width, height, BG, FG, "".join(rects))


if __name__ == "__main__":
    logo, out_svg, out_png = sys.argv[1:4]
    width, height, block = (int(v) for v in (sys.argv[4:7] or (490, 276, 14)))
    grid = cells(logo)
    for row in grid:
        print("".join("#" if v else "." for v in row))
    open(out_svg, "w").write(banner(grid, width, height, block))
    subprocess.run(["rsvg-convert", out_svg, "-o", out_png], check=True)
    print("wrote", out_svg, "and", out_png, "(%dx%d, %d px blocks)" % (width, height, block))
