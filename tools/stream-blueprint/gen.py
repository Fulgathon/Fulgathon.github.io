"""Generates src/components/StreamBlueprint.astro: a detailed line-art plan of
Iceman's League of Legends stream. Run: python3 gen.py <out.astro> <template.astro.txt> (seeded, so the output is stable)"""
import math, random, sys

R = random.Random(7)
C = (1000.0, 600.0)
D = (0.85, -0.527)   # along the mid lane (bottom-left -> top-right)
N = (0.527, 0.85)    # across the lane = along the river


def P(t, s):
    return (C[0] + t * N[0] + s * D[0], C[1] + t * N[1] + s * D[1])


def TS(x, y):
    vx, vy = x - C[0], y - C[1]
    return (vx * N[0] + vy * N[1], vx * D[0] + vy * D[1])


def f(v):
    return f"{v:.1f}".rstrip('0').rstrip('.')


def pts_path(pts, closed=False):
    s = "M" + " L".join(f"{f(x)} {f(y)}" for x, y in pts)
    return s + (" Z" if closed else "")


def smooth(pts, closed=False):
    n = len(pts)
    if n < 3:
        return pts_path(pts, closed)
    out = f"M{f(pts[0][0])} {f(pts[0][1])}"
    rng = range(n) if closed else range(n - 1)
    for i in rng:
        p0 = pts[(i - 1) % n] if closed else pts[max(i - 1, 0)]
        p1 = pts[i]
        p2 = pts[(i + 1) % n] if closed else pts[i + 1]
        p3 = pts[(i + 2) % n] if closed else pts[min(i + 2, n - 1)]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        out += f" C{f(c1[0])} {f(c1[1])} {f(c2[0])} {f(c2[1])} {f(p2[0])} {f(p2[1])}"
    return out + (" Z" if closed else "")


# Areas covered by solid panels (no need to draw ground under them).
PANELS = [(24, 726, 464, 1056), (650, 926, 1270, 1066), (1636, 796, 1906, 1066), (1600, 14, 1906, 54)]


def hidden(x, y, m=0):
    if x < -20 or x > 1940 or y < -20 or y > 1100:
        return True
    return any(a - m <= x <= c + m and b - m <= y <= d + m for a, b, c, d in PANELS)


# ---------- river ----------
def bankA(t):
    return -85 + 14 * math.sin(t / 95) + 6 * math.sin(t / 37)


def bankB(t):
    return 85 + 14 * math.sin(t / 95 + 1.3) + 6 * math.sin(t / 37 + 2.6)


def in_river(x, y, m=0):
    t, s = TS(x, y)
    return bankA(t) - m < s < bankB(t) + m


def river():
    out = []
    for fn in (bankA, bankB):
        pts = [P(t, fn(t)) for t in range(-820, 760, 20)]
        out.append(f'<path class="bank" d="{smooth(pts)}" />')
    # rocks along the banks, away from the lane crossing
    rocks = []
    for fn, side in ((bankA, -1), (bankB, 1)):
        t = -760
        while t < 700:
            t += R.uniform(55, 120)
            if abs(t) < 150:
                continue
            s = fn(t) + side * R.uniform(2, 10)
            cx, cy = P(t, s)
            if hidden(cx, cy, 10):
                continue
            r = R.uniform(5, 11)
            k = R.randint(5, 7)
            poly = [(cx + r * math.cos(2 * math.pi * i / k + R.uniform(-.3, .3)) * R.uniform(.8, 1.15),
                     cy + .62 * r * math.sin(2 * math.pi * i / k + R.uniform(-.3, .3)) * R.uniform(.8, 1.15)) for i in range(k)]
            rocks.append(pts_path(poly, True))
            if R.random() < .5:  # small companion pebble
                px, py = cx + side * R.uniform(8, 14), cy + R.uniform(-4, 4)
                rocks.append(f"M{f(px-3)} {f(py)} Q{f(px)} {f(py-3)} {f(px+3)} {f(py)} Q{f(px)} {f(py+2)} {f(px-3)} {f(py)} Z")
    out.append(f'<path class="rock" d="{" ".join(rocks)}" />')
    # reeds on the outer side of the banks
    reeds = []
    for fn, side in ((bankA, -1), (bankB, 1)):
        for t in R.sample(range(-700, 650, 10), 9):
            if abs(t) < 170:
                continue
            bx, by = P(t, fn(t) + side * 12)
            if hidden(bx, by, 20):
                continue
            for k in range(3):
                h = R.uniform(10, 18)
                lx = bx + k * 3 - 3
                lean = R.uniform(-4, 4)
                reeds.append(f"M{f(lx)} {f(by)} Q{f(lx+lean*.4)} {f(by-h*.6)} {f(lx+lean)} {f(by-h)}")
    out.append(f'<path class="reed" d="{" ".join(reeds)}" />')
    # flowing ripples inside the river
    rip = []
    for _ in range(26):
        t = R.uniform(-760, 700)
        a, b = bankA(t) + 18, bankB(t) - 18
        s = R.uniform(a, b)
        L = R.uniform(24, 56)
        p1, p2, pm = P(t - L / 2, s), P(t + L / 2, s), P(t, s + R.choice((-4, 4)))
        if hidden(*p1, 10):
            continue
        rip.append(f"M{f(p1[0])} {f(p1[1])} Q{f(pm[0])} {f(pm[1])} {f(p2[0])} {f(p2[1])}")
    out.append(f'<path class="ripple" d="{" ".join(rip)}" />')
    return "\n    ".join(out)


# ---------- mid lane ----------
def lane_edge(sign, s):
    return sign * (120 + 4 * math.sin(s / 53) + 3 * math.sin(s / 17 + sign))


def lane():
    out = []
    for sign in (-1, 1):
        segs, cur = [], []
        for s in range(-1500, 1500, 12):
            x, y = P(lane_edge(sign, s), s)
            if in_river(x, y, 2) or hidden(x, y, 30):
                if len(cur) > 1:
                    segs.append(cur)
                cur = []
            else:
                cur.append((x, y))
        if len(cur) > 1:
            segs.append(cur)
        out.append(f'<path class="edge" d="{" ".join(smooth(c) for c in segs)}" />')
        # curb stones just inside the edge
        stones = []
        s = -1500
        while s < 1500:
            w = R.uniform(18, 30)
            s += w + R.uniform(3, 6)
            t0 = lane_edge(sign, s) - sign * 3
            t1 = t0 - sign * R.uniform(7, 10)
            cx, cy = P(t0, s)
            if in_river(cx, cy, 8) or hidden(cx, cy, 10) or R.random() < .1:
                continue
            j = lambda: R.uniform(-1.2, 1.2)
            q = [P(t0 + j(), s - w / 2 + j()), P(t0 + j(), s + w / 2 + j()), P(t1 + j(), s + w / 2 - 1 + j()), P(t1 + j(), s - w / 2 + 1 + j())]
            stones.append(pts_path(q, True))
        out.append(f'<path class="curb" d="{" ".join(stones)}" />')
    # paving: two worn longitudinal joints and staggered cross joints
    joints = []
    rows = [(-104, -36), (-36, 36), (36, 104)]
    for t in (-36, 36):
        s = -1500
        while s < 1500:
            L = R.uniform(60, 200)
            a, b = P(t, s), P(t, s + L)
            if not (in_river(*a, 6) or in_river(*b, 6) or hidden(*a, 6) or hidden(*b, 6)):
                joints.append(f"M{f(a[0])} {f(a[1])} L{f(b[0])} {f(b[1])}")
            s += L + R.uniform(20, 70)
    for ri, (ta, tb) in enumerate(rows):
        s = -1500 + ri * 23
        while s < 1500:
            s += R.uniform(58, 82)
            if R.random() < .45:
                continue
            a, b = P(ta + 5, s), P(tb - 5, s + R.uniform(-2, 2))
            if in_river(*a, 6) or in_river(*b, 6) or hidden(*a, 6) or hidden(*b, 6):
                continue
            joints.append(f"M{f(a[0])} {f(a[1])} L{f(b[0])} {f(b[1])}")
    out.append(f'<path class="pave" d="{" ".join(joints)}" />')
    # a few hairline cracks
    cracks = []
    for _ in range(9):
        t, s = R.uniform(-90, 90), R.uniform(-1100, 1100)
        x, y = P(t, s)
        if in_river(x, y, 20) or hidden(x, y, 20):
            continue
        pts = [(x, y)]
        for _ in range(4):
            x += R.uniform(4, 10) * R.choice((-1, 1))
            y += R.uniform(3, 7)
            pts.append((x, y))
        cracks.append(pts_path(pts))
    out.append(f'<path class="crack" d="{" ".join(cracks)}" />')
    return "\n    ".join(out)


# ---------- jungle walls (raised terrain with a hatched cliff face) ----------
def inside(poly, x, y):
    c = False
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def catmull(pts, per=10):
    out = []
    n = len(pts)
    for i in range(n):
        p0, p1, p2, p3 = pts[(i - 1) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        for k in range(per):
            u = k / per
            u2, u3 = u * u, u * u * u
            out.append(tuple(.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * u + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * u2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * u3) for j in (0, 1)))
    return out


def rocky(cx, cy, rx, ry, k=16, notch=(3, 9)):
    out = []
    for i in range(k):
        a = 2 * math.pi * i / k + R.uniform(-.12, .12)
        r = R.uniform(.82, 1.08)
        if i in notch:
            r *= .72
        out.append((cx + rx * r * math.cos(a), cy + ry * r * math.sin(a)))
    return out


def wall(ctrl, h=22):
    pts = catmull(ctrl, 5)
    n = len(pts)
    area = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))
    cw = area > 0  # clockwise in screen coords
    top = pts_path(pts, True)
    gx = sum(p[0] for p in pts) / n; gy = sum(p[1] for p in pts) / n
    rim = [(gx + (x - gx) * .86, gy + (y - gy) * .8) for x, y in pts]
    rim_d = " ".join(pts_path(rim[i:i + R.randint(4, 9)]) for i in range(0, n - 3, R.randint(7, 11)))
    base_runs, hatch, run = [], [], []
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        ex, ey = x2 - x1, y2 - y1
        L = math.hypot(ex, ey) or 1
        nx, ny = (ey / L, -ex / L) if cw else (-ey / L, ex / L)  # outward normal
        if ny > .25:
            run.append((x1, y1 + h))
            if i % 2 == 0:
                hh = h * R.uniform(.55, 1)
                hatch.append(f"M{f(x1)} {f(y1+2)} V{f(y1+hh)}")
        elif run:
            run.append((x1, y1 + h)); base_runs.append(run); run = []
    if run:
        base_runs.append(run)
    # details on the plateau: grass ticks and pebbles
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    det = []
    for _ in range(int((max(xs) - min(xs)) * (max(ys) - min(ys)) / 2600)):
        x, y = R.uniform(min(xs), max(xs)), R.uniform(min(ys), max(ys))
        if not inside(pts, x, y) or not inside(pts, x, y + 14) or not inside(pts, x - 10, y) or not inside(pts, x + 10, y):
            continue
        if R.random() < .7:
            det.append(f"M{f(x-4)} {f(y)} L{f(x-1)} {f(y-6)} M{f(x+1)} {f(y)} L{f(x+3)} {f(y-8)} M{f(x+4)} {f(y)} L{f(x+6)} {f(y-5)}")
        else:
            det.append(f"M{f(x-4)} {f(y)} Q{f(x)} {f(y-4)} {f(x+4)} {f(y)} Q{f(x)} {f(y+2)} {f(x-4)} {f(y)} Z")
    return (f'<g class="wall"><path class="cliff-base" d="{" ".join(pts_path(r) for r in base_runs)}" />'
            f'<path class="hatch" d="{" ".join(hatch)}" /><path class="plateau" d="{top}" /><path class="rim" d="{rim_d}" />'
            f'<path class="tuft" d="{" ".join(det)}" /></g>')


# ---------- brush: tall grass blades ----------
def brush(cx, cy, rx, ry):
    blades = []
    for _ in range(int(rx * 1.05)):
        while True:
            u, v = R.uniform(-1, 1), R.uniform(-1, 1)
            if u * u + v * v <= 1:
                break
        bx, by = cx + u * rx, cy + v * ry
        h = R.uniform(16, 32) * (1 - .25 * abs(u))
        lean = R.uniform(-8, 8) + u * 5
        blades.append((by, f"M{f(bx)} {f(by)} Q{f(bx+lean*.25)} {f(by-h*.6)} {f(bx+lean)} {f(by-h)}"))
    blades.sort()
    ground = f"M{f(cx-rx-6)} {f(cy+4)} Q{f(cx)} {f(cy+ry+14)} {f(cx+rx+6)} {f(cy+4)}"
    return f'<g class="brush"><path class="brush-ground" d="{ground}" /><path d="{" ".join(b for _, b in blades)}" /></g>'


# ---------- assemble ----------
WALLS = [rocky(1215, 85, 185, 105, 18, (4, 11)), rocky(1490, 680, 150, 85, 16, (2, 9)), rocky(468, 545, 140, 100, 16, (5, 12))]
BRUSHES = [(650, 615, 64, 18), (1340, 868, 70, 18), (1585, 482, 52, 15), (1210, 255, 56, 15)]

game = f"""
    <!-- ground: the river first, then the paved mid lane over it -->
    {river()}
    {lane()}
    <!-- raised jungle walls -->
    {"".join(wall(w) for w in WALLS)}
    <!-- brush -->
    {"".join(brush(*b) for b in BRUSHES)}
"""

src = open(sys.argv[2]).read()
out = src.replace("<!--GAME-->", game.strip())
open(sys.argv[1], "w").write(out)
print("bytes", len(out))
