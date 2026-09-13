// Cover art.
//
// Generated from the loop itself, so a share code carries its artwork
// without carrying an image: whoever pastes the code gets the same picture
// because it is drawn from the same numbers as the music.
//
// The mapping is not decorative. Energy becomes turbulence, warmth picks the
// palette, lift sets brightness, and the dominant profile chooses the form,
// so a hurried bright loop and a still cold one cannot come out looking
// alike.

import { Rng } from './rng.js';

const PALETTES = {
  // warm end
  ember: ['#1a0f14', '#5e2333', '#b8523f', '#e08b4f', '#f2c48a'],
  dusk: ['#160f1e', '#432a4d', '#8c4a6b', '#d1707a', '#f0b49a'],
  sand: ['#1b160f', '#4d3d28', '#96794a', '#d4b47c', '#f0e0bc'],
  // cool end
  tide: ['#07161c', '#123c4a', '#1f7080', '#4cb0ac', '#a8e6cf'],
  ice: ['#0b1620', '#1e3a4f', '#3f7391', '#84b7cf', '#d6ecf5'],
  moss: ['#0d1710', '#223d2a', '#47734b', '#86b077', '#d3e3ab'],
  // saturated
  neon: ['#0a0616', '#2d1063', '#7b1fa2', '#e0338f', '#ffd166'],
  pastel: ['#1c1a24', '#4a4468', '#8b84b8', '#c9b6e4', '#ffe5ec'],
  mono: ['#0e1113', '#282f33', '#4e585e', '#8a969d', '#d8e0e4'],
};

const WARM = ['ember', 'dusk', 'sand'];
const COOL = ['tide', 'ice', 'moss'];
const ODD = ['neon', 'pastel', 'mono'];

const STYLES = ['plasma', 'clouds', 'water', 'cells', 'waves', 'rings'];

// Which form suits which profile. A blend leans toward its strongest.
const STYLE_BIAS = {
  dust: ['clouds', 'plasma'],
  glade: ['waves', 'rings'],
  thaw: ['cells', 'ice'],
  haven: ['clouds', 'water'],
  bloom: ['rings', 'plasma'],
  vapor: ['clouds', 'water'],
  halcyon: ['plasma', 'waves'],
  clockwork: ['cells', 'rings'],
  shatter: ['cells', 'plasma'],
  undertow: ['waves', 'water'],
};

function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

// Sample a five-stop ramp at t.
function ramp(stops, t) {
  const x = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = hex(stops[i]);
  const b = hex(stops[i + 1]);
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

// Value noise on a seeded lattice, with the usual smootherstep and a few
// octaves. Cheap, deterministic, and it does not need a library.
function makeNoise(rng, size = 64) {
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.f();
  const at = (x, y) => grid[((y % size) + size) % size * size + (((x % size) + size) % size)];
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

// Everything the artwork needs, derived once so the description and the
// drawing can never disagree.
export function coverParams(spec) {
  const rng = new Rng(((spec.seed >>> 0) ^ 0xa5c3d1) || 11);
  const feel = spec.feel || { lift: 0.5, energy: 0.5, warmth: 0.6 };
  const mix = spec.mix || { dust: 1 };
  const lead = Object.entries(mix).sort((a, b) => b[1] - a[1])[0][0];

  let family;
  if (rng.chance(0.24)) family = ODD;
  else family = feel.warmth > 0.55 ? WARM : COOL;
  const palette = family[Math.floor(rng.f() * family.length)];

  const biased = (STYLE_BIAS[lead] || STYLES).filter((s) => STYLES.includes(s));
  const style = rng.chance(0.7) && biased.length
    ? biased[Math.floor(rng.f() * biased.length)]
    : STYLES[Math.floor(rng.f() * STYLES.length)];

  return {
    style,
    palette,
    turbulence: 0.35 + feel.energy * 1.5,
    scale: 1.4 + rng.f() * 2.6 + feel.energy * 1.2,
    brightness: 0.3 + feel.lift * 0.55,
    contrast: 0.7 + feel.energy * 0.8,
    rotation: rng.f() * Math.PI,
    rng,
  };
}

export function describeCover(spec) {
  const p = coverParams(spec);
  return `${p.style} · ${p.palette}`;
}

// Draws at `size` px. Deterministic: same spec, same picture, on any device.
export function drawCover(canvas, spec, size = 320) {
  const p = coverParams(spec);
  const stops = PALETTES[p.palette] || PALETTES.mono;
  const noise = makeNoise(new Rng(((spec.seed >>> 0) ^ 0x51f0b3) || 7));

  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;

  const cos = Math.cos(p.rotation);
  const sin = Math.sin(p.rotation);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size - 0.5) * p.scale;
      const v = (y / size - 0.5) * p.scale;
      const rx = u * cos - v * sin;
      const ry = u * sin + v * cos;
      let t;

      switch (p.style) {
        case 'plasma': {
          const n = fbm(noise, rx * 2 + 8, ry * 2 + 8, 4, 0.55);
          t = 0.5 + 0.5 * Math.sin((rx + ry) * 2.2 + n * p.turbulence * 6);
          break;
        }
        case 'clouds':
          t = fbm(noise, rx * 1.5 + 3, ry * 1.5 + 3, 5, 0.52 + p.turbulence * 0.08);
          break;
        case 'water': {
          // Domain warping: sample the field through a displaced copy of
          // itself, which is what gives moving water its folded look.
          const wx = fbm(noise, rx + 1, ry + 5, 3, 0.5);
          const wy = fbm(noise, rx + 7, ry + 2, 3, 0.5);
          t = fbm(noise, rx + wx * p.turbulence * 2, ry + wy * p.turbulence * 2, 4, 0.55);
          break;
        }
        case 'cells': {
          // Cheap Worley: distance to the nearest of a jittered lattice.
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
          t = Math.min(1, (second - best) * (0.6 + p.turbulence * 0.5));
          break;
        }
        case 'waves': {
          const n = fbm(noise, rx * 1.2 + 12, ry * 1.2 + 12, 3, 0.5);
          t = 0.5 + 0.5 * Math.sin(ry * 5 + n * p.turbulence * 5);
          break;
        }
        default: { // rings
          const d = Math.sqrt(rx * rx + ry * ry);
          const n = fbm(noise, rx + 20, ry + 20, 3, 0.5);
          t = 0.5 + 0.5 * Math.sin(d * 9 - n * p.turbulence * 4);
          break;
        }
      }

      t = Math.pow(Math.max(0, Math.min(1, t)), 1 / p.contrast) * p.brightness + (1 - p.brightness) * 0.12;
      const [r, g, bl] = ramp(stops, t);
      const o = (y * size + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = bl;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return p;
}
