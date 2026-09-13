// Cover art.
//
// Generated from the same numbers as the music, so artwork travels inside a
// share code without an image being sent.
//
// The first version drew one full-bleed noise field per cover. It was cheap
// and it was boring: every picture had the same composition, the same
// uniform density and no empty space, so after about ten you had seen the
// trick. Noise is not composition.
//
// So a cover is now built the way a picture is: a ground colour, one to
// three *masked* fields combined with blend modes, a crop that sometimes
// pushes far into the detail, geometry set against the organic parts, and a
// posterising pass that turns smooth gradients into something graphic. Large
// areas are deliberately left empty. Two covers of the same style can look
// nothing alike because the composition, crop and palette rotation differ.
//
// Cost is kept down by rendering the fields small and letting the upscale
// soften them; only the cheap passes run at full resolution.

import { Rng } from './rng.js';

const FIELD = 150; // fields render here, then scale up

const PALETTES = {
  ember: ['#160c10', '#4d1d2c', '#a8412f', '#e08b4f', '#f7dcae'],
  dusk: ['#12091a', '#3d2348', '#8c4a6b', '#d1707a', '#f3bfa4'],
  sand: ['#17120c', '#463522', '#96794a', '#d9bd84', '#f4e8c8'],
  tide: ['#04121a', '#0f3543', '#1f7080', '#52b5ae', '#b3ead3'],
  ice: ['#080f18', '#1a3550', '#3f7391', '#8cc0d6', '#e0f2fa'],
  moss: ['#0a1410', '#1d3826', '#47734b', '#8cb679', '#dbe8b4'],
  neon: ['#06040f', '#27095c', '#7b1fa2', '#ea3d94', '#ffd76b'],
  pastel: ['#191722', '#454065', '#8d86bd', '#cfb9e8', '#ffe9ef'],
  mono: ['#0b0e10', '#242b30', '#4e585e', '#909ba2', '#e2e9ed'],
  rust: ['#140d0a', '#3f2118', '#7d3f22', '#c4763a', '#edc98b'],
  deep: ['#05080f', '#111f3d', '#26417a', '#5b7fc4', '#c3d6f5'],
};
const WARM = ['ember', 'dusk', 'sand', 'rust'];
const COOL = ['tide', 'ice', 'moss', 'deep'];
const ODD = ['neon', 'pastel', 'mono'];

const STYLES = ['plasma', 'clouds', 'water', 'cells', 'waves', 'rings', 'strata', 'flow'];

const STYLE_BIAS = {
  dust: ['clouds', 'strata'],
  glade: ['waves', 'flow'],
  thaw: ['cells', 'strata'],
  haven: ['clouds', 'water'],
  bloom: ['rings', 'plasma'],
  vapor: ['clouds', 'flow'],
  halcyon: ['plasma', 'waves'],
  clockwork: ['cells', 'rings'],
  shatter: ['cells', 'plasma'],
  undertow: ['waves', 'water'],
  grove: ['cells', 'strata'],
  hollow: ['clouds', 'flow'],
  shrine: ['rings', 'water'],
};

// Compositions. This is the part that was missing: where the picture *is*,
// and where it deliberately is not.
const COMPOSITIONS = ['horizon', 'orb', 'stack', 'split', 'aperture', 'drift', 'shard', 'full'];

// ------------------------------------------------------------------ colour

function hexToRgb(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb([h, s, l]) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

// The key the loop is in rotates the palette. Twelve roots, twelve hues:
// cheap, and it means the same style in a different key does not look like
// the same picture again.
function rotate(stops, turns, satMul) {
  return stops.map((c) => {
    const [h, s, l] = rgbToHsl(hexToRgb(c));
    return hslToRgb([(h + turns) % 1, Math.max(0, Math.min(1, s * satMul)), l]);
  });
}

function sample(ramp, t) {
  const x = Math.max(0, Math.min(0.9999, t)) * (ramp.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = ramp[i];
  const b = ramp[i + 1];
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ];
}

// ------------------------------------------------------------------- noise

function makeNoise(rng, size = 64) {
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.f();
  const at = (x, y) => grid[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = smooth(x - xi);
    const ty = smooth(y - yi);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * tx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * tx;
    return a + (b - a) * ty;
  };
}

function fbm(noise, x, y, octaves, gain) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= 2;
  }
  return sum / norm;
}

function fieldValue(style, noise, rx, ry, L) {
  switch (style) {
    case 'plasma': {
      const n = fbm(noise, rx * 2 + 8, ry * 2 + 8, 4, 0.55);
      return 0.5 + 0.5 * Math.sin((rx + ry) * 2.2 + n * L.turbulence * 6);
    }
    case 'clouds':
      return fbm(noise, rx * 1.5 + 3, ry * 1.5 + 3, 5, 0.52 + L.turbulence * 0.06);
    case 'water': {
      const wx = fbm(noise, rx + 1, ry + 5, 3, 0.5);
      const wy = fbm(noise, rx + 7, ry + 2, 3, 0.5);
      return fbm(noise, rx + wx * L.turbulence * 2, ry + wy * L.turbulence * 2, 4, 0.55);
    }
    case 'cells': {
      let best = 9;
      let second = 9;
      const cx = Math.floor(rx * 3);
      const cy = Math.floor(ry * 3);
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const gx = cx + i;
          const gy = cy + j;
          const ox = noise(gx * 3.1 + 40, gy * 3.1 + 40);
          const oy = noise(gx * 3.1 + 90, gy * 3.1 + 90);
          const dx = (gx + ox) - rx * 3;
          const dy = (gy + oy) - ry * 3;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < best) { second = best; best = d; } else if (d < second) second = d;
        }
      }
      return Math.min(1, (second - best) * (0.6 + L.turbulence * 0.5));
    }
    case 'waves': {
      const n = fbm(noise, rx * 1.2 + 12, ry * 1.2 + 12, 3, 0.5);
      return 0.5 + 0.5 * Math.sin(ry * 5 + n * L.turbulence * 5);
    }
    case 'strata': {
      // Sedimentary banding. The number of bands comes from the bar count,
      // so the picture is divided the way the music is.
      const n = fbm(noise, rx * 0.8 + 30, ry * 0.8 + 30, 3, 0.5);
      const warped = ry + n * L.turbulence * 0.5;
      const band = Math.floor(warped * L.bands) / L.bands;
      return 0.5 + 0.5 * Math.sin(band * 11 + n * 2);
    }
    case 'flow': {
      // Follow the noise gradient: streamline-ish, reads as motion.
      const a = fbm(noise, rx + 11, ry + 11, 3, 0.5) * Math.PI * 4;
      return 0.5 + 0.5 * Math.sin(rx * 3 * Math.cos(a) + ry * 3 * Math.sin(a) + a);
    }
    default: {
      const d = Math.sqrt(rx * rx + ry * ry);
      const n = fbm(noise, rx + 20, ry + 20, 3, 0.5);
      return 0.5 + 0.5 * Math.sin(d * 9 - n * L.turbulence * 4);
    }
  }
}

// ------------------------------------------------------------------ params

function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function coverParams(spec) {
  const seed = (spec.seed >>> 0) || 1;
  const rng = new Rng((seed ^ 0xa5c3d1) || 11);
  const feel = spec.feel || { lift: 0.5, energy: 0.5, warmth: 0.6 };
  const mix = spec.mix || { dust: 1 };
  const entries = Object.entries(mix).sort((a, b) => b[1] - a[1]);
  const lead = entries[0][0];

  // How many profiles are in the blend decides how many fields are layered,
  // so a pure loop gets a simpler picture than a four-way one.
  const layerCount = Math.max(1, Math.min(3, entries.filter(([, w]) => w > 0.12).length));

  // Coherence governs how unified the picture is, the same way it governs
  // how much the layers of the music agree.
  const coherence = spec.coherence ?? 0.6;
  const composition = rng.chance(0.1 + (1 - coherence) * 0.12)
    ? 'full'
    : COMPOSITIONS[Math.floor(rng.f() * (COMPOSITIONS.length - 1))];
  // A lone layer needs enough of the frame to be a picture at all.
  const soloSafe = ['horizon', 'split', 'stack', 'drift', 'orb', 'full'];
  const finalComposition = (layerCount === 1 && !soloSafe.includes(composition))
    ? 'drift'
    : composition;

  let family;
  if (rng.chance(0.26)) family = ODD;
  else family = feel.warmth > 0.55 ? WARM : COOL;

  const layers = [];
  for (let i = 0; i < layerCount; i++) {
    const bias = (STYLE_BIAS[entries[Math.min(i, entries.length - 1)][0]] || STYLES)
      .filter((s) => STYLES.includes(s));
    const style = rng.chance(0.72) && bias.length
      ? bias[Math.floor(rng.f() * bias.length)]
      : STYLES[Math.floor(rng.f() * STYLES.length)];
    layers.push({
      style,
      palette: family[Math.floor(rng.f() * family.length)],
      turbulence: 0.35 + feel.energy * 1.5,
      scale: 1.2 + rng.f() * 2.4 + feel.energy * 1.1,
      rotation: rng.f() * Math.PI,
      // Swing shears the field. A loop that leans rhythmically leans here.
      shear: (spec.swing || 0) * rng.range(-1.4, 1.4),
      bands: Math.max(2, Math.min(14, spec.bars || 4)),
      blend: i === 0 ? 'source-over' : rng.pick(['screen', 'overlay', 'multiply', 'lighten']),
      alpha: i === 0 ? 1 : rng.range(0.35, 0.85),
      // Cropping stops every cover reading at the same distance. Capped,
      // though: zooming four times into smooth noise lands in a featureless
      // patch, and the result is a flat square of colour.
      zoom: rng.chance(0.42) ? rng.range(1.35, 2.4) : 1,
      panX: rng.f(),
      panY: rng.f(),
    });
  }

  return {
    seed,
    composition: finalComposition,
    layers,
    // Key rotates the palette; twelve roots, twelve different colourways.
    hueTurn: ((spec.root || 0) / 12) * 0.7 + rng.range(-0.04, 0.04),
    saturation: 0.55 + feel.energy * 0.75,
    groundStop: rng.chance(0.5) ? 0 : 1,
    brightness: 0.45 + feel.lift * 0.42,
    contrast: 0.7 + feel.energy * 0.8,
    // Fewer levels reads as print rather than render. Stillness posterises
    // hardest, which suits the quiet profiles.
    posterize: rng.chance(0.55) ? Math.round(3 + feel.energy * 9 + rng.f() * 3) : 0,
    grain: 0.02 + (1 - feel.warmth) * 0.07,
    vignette: rng.range(0.1, 0.55),
    // Meter decides rotational order: threes in 6/8, fives in 5/4.
    symmetry: spec.stepsPerBar === 12 ? 3 : spec.stepsPerBar === 20 ? 5 : 4,
    geometry: rng.chance(0.55),
    invert: rng.chance(0.14),
    rng,
  };
}

// Albums get their own artwork, built from the loops inside them, so it
// changes when the album does and travels in the album code.
export function albumCoverSpec(title, specs) {
  const seeds = specs.map((s) => s.seed >>> 0).join(',');
  const seed = hash32(`${title}|${seeds}`);
  const feel = { lift: 0, energy: 0, warmth: 0 };
  const mix = {};
  for (const s of specs) {
    const f = s.feel || { lift: 0.5, energy: 0.5, warmth: 0.6 };
    feel.lift += f.lift / specs.length;
    feel.energy += f.energy / specs.length;
    feel.warmth += f.warmth / specs.length;
    for (const [k, w] of Object.entries(s.mix || { dust: 1 })) {
      mix[k] = (mix[k] || 0) + w / specs.length;
    }
  }
  return {
    seed,
    feel,
    mix,
    root: seed % 12,
    bars: 4 + (seed % 9),
    stepsPerBar: 16,
    swing: ((seed >> 8) % 100) / 400,
    coherence: 0.4 + ((seed >> 16) % 100) / 250,
  };
}

export function describeCover(spec) {
  const p = coverParams(spec);
  return `${p.composition} · ${p.layers.map((l) => l.style).join('+')} · ${p.layers[0].palette}`;
}

// ----------------------------------------------------------------- drawing

function offscreen(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  c.width = w;
  c.height = h;
  return c;
}

function renderFieldOnce(layer, ramp, p, scaleMul, contrastMul) {
  const c = offscreen(FIELD, FIELD);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(FIELD, FIELD);
  const data = img.data;
  const noise = makeNoise(new Rng((p.seed ^ hash32(layer.style)) >>> 0 || 7));
  const cos = Math.cos(layer.rotation);
  const sin = Math.sin(layer.rotation);
  const scale = layer.scale * scaleMul;
  const contrast = p.contrast * contrastMul;

  // Only the visible crop matters for whether the picture has any incident
  // in it, so measure the range over that window rather than the whole tile.
  const z = layer.zoom;
  const cw = FIELD / z;
  const cx0 = (FIELD - cw) * layer.panX;
  const cy0 = (FIELD - cw) * layer.panY;
  let lo = 1;
  let hi = 0;

  for (let y = 0; y < FIELD; y++) {
    for (let x = 0; x < FIELD; x++) {
      let u = (x / FIELD - 0.5) * scale;
      let v = (y / FIELD - 0.5) * scale;
      u += v * layer.shear;
      const rx = u * cos - v * sin;
      const ry = u * sin + v * cos;
      let t = fieldValue(layer.style, noise, rx, ry, layer);
      t = Math.pow(Math.max(0, Math.min(1, t)), 1 / contrast);
      t = t * p.brightness + (1 - p.brightness) * 0.14;
      if (p.posterize) t = Math.round(t * p.posterize) / p.posterize;
      if (x >= cx0 && x < cx0 + cw && y >= cy0 && y < cy0 + cw) {
        if (t < lo) lo = t;
        if (t > hi) hi = t;
      }
      const [r, g, b] = sample(ramp, t);
      const o = (y * FIELD + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, span: hi - lo };
}

// A smooth field seen through a tight crop can be genuinely featureless --
// no amount of levelling afterwards invents detail that was never rendered.
// So measure what the crop will actually show and, if it is flat, pull back
// to a wider scale where there is something to see.
function renderField(layer, ramp, p) {
  let out = renderFieldOnce(layer, ramp, p, 1, 1);
  if (out.span < 0.14) out = renderFieldOnce(layer, ramp, p, 2.6, 1.35);
  if (out.span < 0.1) out = renderFieldOnce(layer, ramp, p, 5.5, 1.7);
  return out.canvas;
}

// Cut the field to a shape, leaving the rest of the canvas empty. This is
// where the negative space comes from.
function applyMask(canvas, p, index) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const s = FIELD;
  const r = p.rng;
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = '#fff';

  const soft = (shape) => {
    const g = ctx.createRadialGradient(shape.x, shape.y, 0, shape.x, shape.y, shape.r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.62, 'rgba(255,255,255,0.92)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  };

  // Layer zero establishes the image, so it never gets one of the sparse
  // shapes; those are for the layers stacked on top of it. A single-layer
  // cover masked down to a small shard is just an empty square.
  const sparse = ['orb', 'aperture', 'shard'];
  const comp = (index === 0 && sparse.includes(p.composition) && p.layers.length > 1)
    ? 'full'
    : p.composition;

  switch (comp) {
    case 'horizon': {
      const y = s * (0.3 + r.f() * 0.4);
      const h = s * (0.12 + r.f() * 0.3);
      ctx.fillRect(0, index % 2 ? 0 : y - h / 2, s, index % 2 ? y - h / 2 : h);
      break;
    }
    case 'orb':
      soft({ x: s * (0.25 + r.f() * 0.5), y: s * (0.25 + r.f() * 0.5), r: s * (0.22 + r.f() * 0.22) });
      break;
    case 'stack': {
      const n = 2 + Math.floor(r.f() * 3);
      for (let i = index % 2; i < n; i += 2) {
        ctx.fillRect(0, (i / n) * s, s, (s / n) * (0.5 + r.f() * 0.5));
      }
      break;
    }
    case 'split': {
      ctx.beginPath();
      const a = r.f() * Math.PI;
      const cx = s / 2;
      const cy = s / 2;
      const dx = Math.cos(a) * s;
      const dy = Math.sin(a) * s;
      ctx.moveTo(cx - dx, cy - dy);
      ctx.lineTo(cx + dx, cy + dy);
      ctx.lineTo(cx + dx - dy * 2, cy + dy + dx * 2);
      ctx.lineTo(cx - dx - dy * 2, cy - dy + dx * 2);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'aperture': {
      const cx = s * (0.35 + r.f() * 0.3);
      const cy = s * (0.35 + r.f() * 0.3);
      const outer = s * (0.3 + r.f() * 0.2);
      ctx.beginPath();
      ctx.arc(cx, cy, outer, 0, Math.PI * 2);
      ctx.arc(cx, cy, outer * (0.35 + r.f() * 0.3), 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      break;
    }
    case 'drift':
      soft({ x: s * (0.2 + r.f() * 0.6), y: s * (0.2 + r.f() * 0.6), r: s * (0.45 + r.f() * 0.35) });
      break;
    case 'shard': {
      const n = 2 + Math.floor(r.f() * 3);
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        const cx = r.f() * s;
        const cy = r.f() * s;
        const rad = s * (0.18 + r.f() * 0.3);
        const sides = 3 + Math.floor(r.f() * 3);
        for (let k = 0; k <= sides; k++) {
          const a = (k / sides) * Math.PI * 2 + r.f();
          const px = cx + Math.cos(a) * rad;
          const py = cy + Math.sin(a) * rad;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    default:
      ctx.fillRect(0, 0, s, s);
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawGeometry(ctx, p, size, ramp) {
  if (!p.geometry) return;
  const r = p.rng;
  const ink = sample(ramp, r.chance(0.5) ? 0.96 : 0.06);
  ctx.save();
  ctx.globalAlpha = 0.22 + r.f() * 0.4;
  ctx.strokeStyle = `rgb(${ink[0] | 0},${ink[1] | 0},${ink[2] | 0})`;
  ctx.lineWidth = Math.max(1, size * (0.002 + r.f() * 0.008));

  // Grid used to come up as often as everything else and it reads as a
  // ruler laid over the picture rather than part of it.
  const kind = r.weighted([['arcs', 3], ['rays', 2.2], ['rule', 2.2], ['grid', 1]]);
  if (kind === 'arcs') {
    const cx = size * (0.2 + r.f() * 0.6);
    const cy = size * (0.2 + r.f() * 0.6);
    const n = 2 + Math.floor(r.f() * 4);
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, size * (0.1 + i * (0.06 + r.f() * 0.06)), r.f() * 6.28, r.f() * 6.28 + 1 + r.f() * 3);
      ctx.stroke();
    }
  } else if (kind === 'rays') {
    // Rotational order comes from the metre.
    const cx = size / 2;
    const cy = size / 2;
    const n = p.symmetry * (1 + Math.floor(r.f() * 3));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * size * 0.12, cy + Math.sin(a) * size * 0.12);
      ctx.lineTo(cx + Math.cos(a) * size * 0.62, cy + Math.sin(a) * size * 0.62);
      ctx.stroke();
    }
  } else if (kind === 'rule') {
    const n = 1 + Math.floor(r.f() * 3);
    for (let i = 0; i < n; i++) {
      const y = size * (0.15 + r.f() * 0.7);
      ctx.beginPath();
      ctx.moveTo(size * r.range(-0.1, 0.3), y);
      ctx.lineTo(size * r.range(0.7, 1.1), y + size * r.range(-0.05, 0.05));
      ctx.stroke();
    }
  } else {
    const n = p.symmetry;
    for (let i = 1; i < n; i++) {
      ctx.beginPath();
      ctx.moveTo((i / n) * size, 0);
      ctx.lineTo((i / n) * size, size);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function post(ctx, p, size) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const r = new Rng((p.seed ^ 0x9e37) >>> 0 || 5);
  const half = size / 2;

  // Auto-levels.
  //
  // Masking and blending can land a cover almost entirely in one narrow
  // band of tone, and the result is not restrained, it is blank. Stretching
  // to the 2nd and 98th percentiles guarantees every cover carries real
  // tonal range. Only part of the way, and with a capped gain, so a
  // deliberately dark quiet picture stays dark and quiet rather than being
  // blasted into a poster.
  const hist = new Uint32Array(64);
  for (let i = 0; i < d.length; i += 4) {
    const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
    hist[Math.min(63, lum / 4 | 0)]++;
  }
  const total = (d.length / 4);
  let acc = 0;
  let lo = 0;
  let hi = 255;
  for (let i = 0; i < 64; i++) {
    acc += hist[i];
    if (acc >= total * 0.02) { lo = i * 4; break; }
  }
  acc = 0;
  for (let i = 63; i >= 0; i--) {
    acc += hist[i];
    if (acc >= total * 0.02) { hi = i * 4 + 4; break; }
  }
  const span = Math.max(1, hi - lo);
  const gain = Math.min(3.2, 235 / span);
  // A picture that came out genuinely flat gets the full stretch; one that
  // already has range gets a light touch, so deliberate restraint survives.
  const strength = span < 55 ? 1 : span < 110 ? 0.8 : 0.55;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const v = 1 - p.vignette * Math.min(1, (dx * dx + dy * dy) * 0.75);
      const n = (r.f() - 0.5) * 255 * p.grain;
      for (let k = 0; k < 3; k++) {
        const raw = d[o + k];
        const stretched = (raw - lo) * gain + 10;
        let val = raw + (stretched - raw) * strength;
        // Vignette, then grain. Grain last so it survives the darkening and
        // keeps flat areas from looking like unpainted canvas.
        val = val * v + n;
        if (p.invert) val = 255 - val;
        d[o + k] = val < 0 ? 0 : val > 255 ? 255 : val;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function drawCover(canvas, spec, size = 320) {
  const p = coverParams(spec);
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const baseRamp = rotate(PALETTES[p.layers[0].palette] || PALETTES.mono, p.hueTurn, p.saturation);
  // Where a mask leaves the frame bare, the ground is the picture. A flat
  // fill there reads as an unfinished canvas, so it gets a gradient across
  // two stops of the same palette: still empty, but empty with tone in it,
  // which is how negative space works in a painting.
  const gA = sample(baseRamp, p.groundStop ? 0.9 : 0.04);
  const gB = sample(baseRamp, p.groundStop ? 0.58 : 0.26);
  const angle = p.rng.f() * Math.PI * 2;
  const grad = ctx.createLinearGradient(
    size / 2 - Math.cos(angle) * size * 0.7, size / 2 - Math.sin(angle) * size * 0.7,
    size / 2 + Math.cos(angle) * size * 0.7, size / 2 + Math.sin(angle) * size * 0.7
  );
  grad.addColorStop(0, `rgb(${gA[0] | 0},${gA[1] | 0},${gA[2] | 0})`);
  grad.addColorStop(1, `rgb(${gB[0] | 0},${gB[1] | 0},${gB[2] | 0})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  p.layers.forEach((layer, i) => {
    const ramp = rotate(PALETTES[layer.palette] || PALETTES.mono, p.hueTurn, p.saturation);
    const field = renderField(layer, ramp, p);
    applyMask(field, p, i);
    ctx.globalCompositeOperation = layer.blend;
    ctx.globalAlpha = layer.alpha;
    const z = layer.zoom;
    const sw = FIELD / z;
    const sh = FIELD / z;
    const sx = (FIELD - sw) * layer.panX;
    const sy = (FIELD - sh) * layer.panY;
    ctx.drawImage(field, sx, sy, sw, sh, 0, 0, size, size);
  });
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  drawGeometry(ctx, p, size, baseRamp);
  post(ctx, p, size);
  return p;
}
