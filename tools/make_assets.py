"""Derive site assets from brand/ (run manually: python -I tools/make_assets.py).
Source of truth: brand/LOGO UTECH PNG...png (RGBA, 2000x2000, colortype 6).
That file holds 3,496,699 pure-black pixels with alpha 0, so every resize goes
through premultiplied alpha (RGBa) to avoid dark fringes."""
import json, sys
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
ROOT = __file__.replace("\\", "/").rsplit("/tools/", 1)[0]
src = Image.open(ROOT + "/brand/LOGO UTECH PNG...png").convert("RGBA")
a = np.array(src)
alpha = a[..., 3]
ys, xs = np.where(alpha > 8)
x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
print("content bbox", x0, y0, x1, y1)
side = max(x1 - x0, y1 - y0)
pad = int(side * 0.06)
side += pad * 2
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
box = (cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side)
crop = src.crop(box)

def premul_resize(im, n):
    return im.convert("RGBa").resize((n, n), Image.LANCZOS).convert("RGBA")

for n in (512, 192, 128):
    premul_resize(crop, n).save(f"{ROOT}/src/assets/logo-{n}.png", optimize=True)
    print("wrote logo", n)

# ---- extreme samples for the palette (real pixels) ----
op = a[alpha == 255]
yy, xx = np.where(alpha == 255)
rgb = op[:, :3].astype(int)
def pick(score, name):
    i = int(np.argmax(score)); r, g, b = rgb[i]
    print(name, "#%02x%02x%02x" % (r, g, b), "at", (int(xx[i]), int(yy[i])))
pick(rgb[:, 1] + rgb[:, 2] - 2 * rgb[:, 0], "cyan-extreme")
pick(rgb[:, 0] + rgb[:, 2] - 2 * rgb[:, 1], "violet-extreme")

# ---- trace favicon from real pixel grid ----
from collections import deque
m = alpha > 127
H, W = m.shape
lab = np.zeros((H, W), np.int32); n = 0
step = 2  # label on a 2px lattice for speed, polygons still taken from full-res mask
sm = m[::step, ::step]
sh, sw = sm.shape
sl = np.zeros(sm.shape, np.int32)
for sy in range(sh):
    for sx in range(sw):
        if sm[sy, sx] and not sl[sy, sx]:
            n += 1; q = deque([(sy, sx)]); sl[sy, sx] = n
            while q:
                y, x = q.popleft()
                for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
                    ny, nx = y+dy, x+dx
                    if 0 <= ny < sh and 0 <= nx < sw and sm[ny, nx] and not sl[ny, nx]:
                        sl[ny, nx] = n; q.append((ny, nx))
sizes = np.bincount(sl.ravel())[1:]
keep = [i + 1 for i, s in enumerate(sizes) if s > 500]
print("components", len(keep))

def boundary(mask):
    # ordered boundary by Moore-neighbour tracing on a 2px lattice
    ys, xs = np.where(mask)
    start = (ys.min(), xs[ys == ys.min()].min())
    dirs = [(0,1),(1,1),(1,0),(1,-1),(0,-1),(-1,-1),(-1,0),(-1,1)]
    pts = [start]; cur = start; d = 7
    for _ in range(200000):
        for k in range(8):
            nd = (d + 6 + k) % 8
            ny, nx = cur[0] + dirs[nd][0], cur[1] + dirs[nd][1]
            if 0 <= ny < mask.shape[0] and 0 <= nx < mask.shape[1] and mask[ny, nx]:
                cur = (ny, nx); d = nd; break
        else:
            break
        if cur == start and len(pts) > 2: break
        pts.append(cur)
    return pts

def rdp(p, eps):
    if len(p) < 3: return p
    a_, b_ = np.array(p[0], float), np.array(p[-1], float)
    ab = b_ - a_; L = np.hypot(*ab) or 1e-9
    d = [abs(ab[0]*(q[1]-a_[1]) - ab[1]*(q[0]-a_[0])) / L for q in p]
    i = int(np.argmax(d))
    if d[i] > eps:
        return rdp(p[:i+1], eps)[:-1] + rdp(p[i:], eps)
    return [p[0], p[-1]]

shapes = []
for lbl in keep:
    mk = sl == lbl
    pts = boundary(mk)
    pts = [(x * step, y * step) for y, x in pts]
    # split closed loop at two far points so RDP behaves on a closed curve
    arr = np.array(pts, float)
    far = int(np.argmax(((arr - arr[0]) ** 2).sum(1)))
    poly = rdp([tuple(p) for p in pts[:far+1]], 5.0)[:-1] + rdp([tuple(p) for p in pts[far:]] + [tuple(pts[0])], 5.0)[:-1]
    cxm = float(np.mean([p[0] for p in poly])); cym = float(np.mean([p[1] for p in poly]))
    ys_, xs_ = np.where(mk)
    # role by real colour: mean RGB of the component's pixels
    sub = a[ys_ * step, xs_ * step][:, :3].mean(0)
    role = "light" if sub.min() > 180 else "gradient"
    shapes.append({"role": role, "poly": [[int(x), int(y)] for x, y in poly], "cx": cxm, "cy": cym})
    print("shape", role, len(poly), "pts, centroid", round(cxm), round(cym))

# map to 32x32 viewBox with 2px margin using the same square crop box
bx0, by0, bs = box[0], box[1], box[2] - box[0]
def tx(p): return [round(2 + (p[0] - bx0) * 28 / bs, 2), round(2 + (p[1] - by0) * 28 / bs, 2)]
out = {"viewBox": "0 0 32 32", "source": "brand/LOGO UTECH PNG...png alpha>127 mask, Moore trace on 2px lattice, RDP eps 5px, mapped from crop box %s" % (list(map(int, box)),),
       "shapes": [{"role": s["role"], "points": [tx(p) for p in s["poly"]]} for s in shapes]}
json.dump(out, open(ROOT + "/tools/favicon-trace.json", "w"), indent=1)
print("favicon trace written")
