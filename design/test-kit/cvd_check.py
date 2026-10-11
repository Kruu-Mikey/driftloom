"""Color helpers: OKLCH <-> sRGB, WCAG contrast, CVD simulation (Machado 2009, severity 1)."""
import math

def s2l(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def l2s(c):
    c = 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
    return c * 255

def lum(rgb):
    r, g, b = (s2l(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def cr(a, b):
    x, y = lum(a), lum(b)
    return (max(x, y) + 0.05) / (min(x, y) + 0.05)

def oklch_to_lin(L, C, h):
    a, b = C * math.cos(math.radians(h)), C * math.sin(math.radians(h))
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    return (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)

def in_gamut(lin):
    return all(-1e-6 <= v <= 1 + 1e-6 for v in lin)

def oklch_to_rgb(L, C, h):
    lin = oklch_to_lin(L, C, h)
    if not in_gamut(lin):
        return None
    return tuple(round(min(255, max(0, l2s(v)))) for v in lin)

def rgb_to_oklab(rgb):
    r, g, b = (s2l(v) for v in rgb)
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = (math.copysign(abs(v) ** (1 / 3), v) for v in (l, m, s))
    return (0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
            1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
            0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_)

def rgb_to_oklch(rgb):
    L, a, b = rgb_to_oklab(rgb)
    return L, math.hypot(a, b), math.degrees(math.atan2(b, a)) % 360

def de(a, b):
    A, B = rgb_to_oklab(a), rgb_to_oklab(b)
    return math.dist(A, B) * 100

MACHADO = {
    'protan': ((0.152286, 1.052583, -0.204868), (0.114503, 0.786281, 0.099216), (-0.003882, -0.048116, 1.051998)),
    'deutan': ((0.367322, 0.860646, -0.227968), (0.280085, 0.672501, 0.047413), (-0.011820, 0.042940, 0.968881)),
    'tritan': ((1.255528, -0.076749, -0.178779), (-0.078411, 0.930809, 0.147602), (0.004733, 0.691367, 0.303900)),
}

def cvd(rgb, kind):
    if kind == 'gray':
        y = l2s(lum(rgb))
        return (round(y),) * 3
    lin = [s2l(v) for v in rgb]
    M = MACHADO[kind]
    out = [sum(M[i][j] * lin[j] for j in range(3)) for i in range(3)]
    return tuple(round(min(255, max(0, l2s(min(1, max(0, v)))))) for v in out)

def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

def rgbhex(c):
    return '#%02x%02x%02x' % tuple(c)

def best(h, bg, target, prefer_light=0.25):
    """Most chromatic in-gamut color at hue h whose contrast vs every bg >= target."""
    bgs = bg if isinstance(bg[0], (tuple, list)) else [bg]
    top = None
    for Li in range(200, 900):
        L = Li / 1000
        lo, hi = 0.0, 0.4
        if oklch_to_rgb(L, 0, h) is None:
            continue
        for _ in range(30):
            mid = (lo + hi) / 2
            if oklch_to_rgb(L, mid, h) is None:
                hi = mid
            else:
                lo = mid
        rgb = oklch_to_rgb(L, lo, h)
        if min(cr(rgb, b) for b in bgs) < target:
            continue
        score = lo + prefer_light * L
        if top is None or score > top[0]:
            top = (score, L, lo, rgb)
    return top


if __name__ == '__main__':
    # Usage: python3 cvd_check.py mockup.html out/nontext_allon.json
    import sys, json, re
    html = open(sys.argv[1], encoding='utf-8').read()
    meas = json.load(open(sys.argv[2]))
    for t in ('t-dawn', 't-ember', 't-tidal', 't-olive'):
        i = html.index('  .%s {\n    --glass-bg' % t)
        m = re.compile(r'--n1: (#[0-9a-f]{6}); --n2: (#[0-9a-f]{6}); --n3: (#[0-9a-f]{6}); --n4: (#[0-9a-f]{6}); --n5: (#[0-9a-f]{6});').search(html, i)
        cs = [hexrgb(c) for c in m.groups()]
        bgs = [tuple(l['bg']) for l in meas[t]['layers']]
        out = []
        for k in ('normal', 'protan', 'deutan', 'tritan', 'gray'):
            f = (lambda x: x) if k == 'normal' else (lambda x, k=k: cvd(x, k))
            adj = min(de(f(cs[j]), f(cs[j + 1])) for j in range(4))
            crm = min(cr(f(c), f(b)) for c, b in zip(cs, bgs))
            out.append('%s adj %.1f min3:1 %.2f' % (k, adj, crm))
        print(t.ljust(8), 'meanC %.3f |' % (sum(rgb_to_oklch(c)[1] for c in cs) / 5), ' | '.join(out))
