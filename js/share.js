// Share codes.
//
// A loop is not audio, it is a recipe: a handful of seeds and parameters.
// So sharing one does not need a server, an upload or a file -- it needs the
// recipe written down. MIDI is the wrong tool for this. MIDI carries the
// notes, which means the recipient gets a frozen transcript they cannot
// re-roll, drift, or edit. A code carries the loop itself.
//
// The encoding is explicit rather than "just the seed". A seed-only code
// would be tiny, but it would mean whatever the generator happened to make
// of it *that week*: change a weighting and every code in circulation
// quietly becomes a different piece of music. Writing the parameters down
// costs about seventy bytes and makes a code mean one thing forever.
//
// Crockford Base32 because codes get read aloud, written down and typed.
// It drops I, L, O and U, so there is no 1/l or 0/O confusion, and it is
// case-insensitive.

import { SCALES } from './theory.js';
import { CHARACTERS, resolveKey } from './characters.js';
import { MOODS } from './generator.js';
import { seedName } from './rng.js';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DECODE_MAP = (() => {
  const m = {};
  for (let i = 0; i < ALPHABET.length; i++) m[ALPHABET[i]] = i;
  // Crockford's forgiving aliases.
  m.I = 1; m.L = 1; m.O = 0; m.U = 0;
  return m;
})();

export const FORMAT = 2;

// Frozen orderings. These must never be reordered or codes already written
// down stop meaning what they meant; append only.
const SCALE_IDS = [
  'dorian', 'aeolian', 'ionian', 'mixolydian', 'lydian', 'phrygian',
  'harmonicMinor', 'minorPent', 'majorPent', 'kumoi', 'hirajoshi', 'insen',
  'wholeTone', 'lydianDominant', 'phrygianDominant', 'dorianSharp4',
  'yo', 'ritusen', 'akebono',
];
const PROFILE_IDS = [
  'dust', 'glade', 'thaw', 'haven', 'bloom', 'vapor',
  'halcyon', 'clockwork', 'shatter', 'undertow',
];
const MOOD_IDS = [
  'joyful', 'happy', 'enthusiastic', 'refreshing',
  'soothing', 'peaceful', 'comforting', 'reflective',
];
const LAYERS = ['drums', 'bass', 'chords', 'melody', 'texture'];

// ------------------------------------------------------------- bit plumbing

class Writer {
  constructor() { this.bytes = []; }
  u8(v) { this.bytes.push(v & 0xff); return this; }
  u16(v) { this.u8(v >> 8); this.u8(v); return this; }
  u32(v) { this.u16(v >>> 16); this.u16(v & 0xffff); return this; }
  // A 0..1 value at 1/255 resolution, which is finer than anyone can hear.
  unit(v) { return this.u8(Math.round(Math.max(0, Math.min(1, v)) * 255)); }
  str(s, max = 40) {
    const enc = new TextEncoder().encode((s || '').slice(0, max));
    this.u8(enc.length);
    for (const b of enc) this.u8(b);
    return this;
  }
}

class Reader {
  constructor(bytes) { this.b = bytes; this.i = 0; }
  u8() { return this.b[this.i++]; }
  u16() { return (this.u8() << 8) | this.u8(); }
  u32() { return ((this.u16() << 16) >>> 0) + this.u16(); }
  // No rounding here. The writer stores round(v * 255); dividing straight
  // back by 255 reproduces the generator's quantised value exactly, and
  // trimming to three decimals would undo that for the sake of tidiness.
  unit() { return this.u8() / 255; }
  str() {
    const n = this.u8();
    const slice = this.b.slice(this.i, this.i + n);
    this.i += n;
    return new TextDecoder().decode(slice);
  }
  get done() { return this.i >= this.b.length; }
}

// ---------------------------------------------------------------- spec <-> bytes

function writeSpec(w, spec) {
  // The generated name falls out of the seed, so it only costs bytes when
  // the user has renamed the loop.
  const generated = seedName(spec.seed >>> 0);
  if (spec.name && spec.name !== generated) {
    w.u8(1);
    w.str(spec.name, 40);
  } else {
    w.u8(0);
  }
  w.u8(Math.max(32, Math.min(190, spec.bpm || 74)) - 32);
  w.u8(spec.root || 0);
  const scaleIdx = SCALE_IDS.indexOf(spec.scale);
  w.u8(scaleIdx < 0 ? 0 : scaleIdx);
  w.u8(Math.min(255, spec.bars || 4));
  w.u8(spec.stepsPerBar || 16);
  w.unit(spec.swing || 0);
  w.unit(spec.coherence ?? 0.6);

  for (const layer of LAYERS) w.u32((spec.layerSeeds && spec.layerSeeds[layer]) || 0);
  w.u32(spec.seed >>> 0);

  const mix = spec.mix || {};
  const mixKeys = Object.keys(mix).filter((k) => PROFILE_IDS.indexOf(resolveKey(k)) >= 0);
  w.u8(mixKeys.length);
  for (const k of mixKeys) {
    w.u8(PROFILE_IDS.indexOf(resolveKey(k)));
    w.unit(mix[k]);
  }

  const feelMix = spec.feelMix || {};
  const moodKeys = Object.keys(feelMix).filter((k) => MOOD_IDS.indexOf(k) >= 0);
  w.u8(moodKeys.length);
  for (const k of moodKeys) {
    w.u8(MOOD_IDS.indexOf(k));
    w.unit(feelMix[k]);
  }

  const feel = spec.feel || { lift: 0.5, energy: 0.5, warmth: 0.6 };
  w.unit(feel.lift).unit(feel.energy).unit(feel.warmth);

  const tone = spec.tone || {};
  w.unit(tone.warmth ?? 0.6).unit(tone.space ?? 0.5).unit(tone.wobble ?? 0.3);

  let muteBits = 0;
  LAYERS.forEach((l, i) => { if (spec.mutes && spec.mutes[l]) muteBits |= 1 << i; });
  w.u8(muteBits);

  let forceBits = 0;
  LAYERS.forEach((l, i) => { if (spec.forceLayers && spec.forceLayers[l]) forceBits |= 1 << i; });
  w.u8(forceBits);

  if (spec.cycles) {
    w.u8(1);
    for (const layer of LAYERS) w.u16(spec.cycles[layer] || 0);
  } else {
    w.u8(0);
  }
  // Format 2: track length, so a shared album keeps its pacing.
  w.u8(Math.max(0, Math.min(255, spec.playFor || 0)));
}

function readSpec(r) {
  const spec = {};
  const hasName = r.u8();
  const customName = hasName ? r.str() : null;
  spec.bpm = r.u8() + 32;
  spec.root = r.u8();
  spec.scale = SCALE_IDS[r.u8()] || 'dorian';
  spec.bars = r.u8();
  spec.stepsPerBar = r.u8();
  spec.swing = r.unit();
  spec.coherence = r.unit();

  spec.layerSeeds = {};
  for (const layer of LAYERS) spec.layerSeeds[layer] = r.u32();
  spec.seed = r.u32();
  spec.name = customName || seedName(spec.seed >>> 0);

  spec.mix = {};
  const mixCount = r.u8();
  for (let i = 0; i < mixCount; i++) {
    const key = PROFILE_IDS[r.u8()] || 'dust';
    spec.mix[key] = r.unit();
  }
  if (!Object.keys(spec.mix).length) spec.mix = { dust: 1 };

  spec.feelMix = {};
  const moodCount = r.u8();
  for (let i = 0; i < moodCount; i++) {
    const key = MOOD_IDS[r.u8()] || 'peaceful';
    spec.feelMix[key] = r.unit();
  }

  spec.feel = { lift: r.unit(), energy: r.unit(), warmth: r.unit() };
  spec.mood = spec.feel.lift;
  spec.tone = { warmth: r.unit(), space: r.unit(), wobble: r.unit() };

  const muteBits = r.u8();
  spec.mutes = {};
  LAYERS.forEach((l, i) => { spec.mutes[l] = !!(muteBits & (1 << i)); });

  const forceBits = r.u8();
  if (forceBits) {
    spec.forceLayers = {};
    LAYERS.forEach((l, i) => { if (forceBits & (1 << i)) spec.forceLayers[l] = true; });
  }

  if (r.u8()) {
    spec.cycles = {};
    for (const layer of LAYERS) {
      const v = r.u16();
      spec.cycles[layer] = v || null;
    }
  }
  // Format 1 codes simply end here; they get the default.
  spec.playFor = r.done ? null : (r.u8() || null);
  return spec;
}

// ------------------------------------------------------------------ base32

function toBase32(bytes) {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

function fromBase32(text) {
  const clean = text.toUpperCase().replace(/[^0-9A-Z]/g, '');
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = DECODE_MAP[ch];
    if (v === undefined) throw new Error('bad character in code');
    buffer = (buffer << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(bytes);
}

// Fletcher-16: catches transpositions, which a plain sum does not, and
// transposing two characters is exactly what happens when a code is copied
// out by hand.
function checksum(bytes) {
  let a = 0;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 255;
    b = (b + a) % 255;
  }
  return ((b << 8) | a) & 0xffff;
}

function wrap(prefix, bytes) {
  const sum = checksum(bytes);
  const all = Uint8Array.from([...bytes, (sum >> 8) & 0xff, sum & 0xff]);
  const body = toBase32(all);
  const grouped = body.match(/.{1,5}/g).join('-');
  return `${prefix}${grouped}`;
}

function unwrap(prefix, code) {
  const text = String(code || '').trim().toUpperCase();
  const head = text.startsWith(prefix) ? text.slice(prefix.length) : text;
  const bytes = fromBase32(head);
  if (bytes.length < 3) throw new Error('code is too short');
  const payload = bytes.slice(0, bytes.length - 2);
  const given = (bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1];
  if (checksum(payload) !== given) throw new Error('that code has a typo in it');
  return payload;
}

// ------------------------------------------------------------------- public

export const SONG_PREFIX = 'DL1-';
export const ALBUM_PREFIX = 'DLA1-';

export function encodeSong(spec) {
  const w = new Writer();
  w.u8(FORMAT);
  writeSpec(w, spec);
  return wrap(SONG_PREFIX, Uint8Array.from(w.bytes));
}

export function decodeSong(code) {
  const bytes = unwrap(SONG_PREFIX, code);
  const r = new Reader(bytes);
  const version = r.u8();
  if (version > FORMAT) throw new Error('that code was made by a newer version');
  return readSpec(r);
}

export function encodeAlbum(title, specs) {
  const w = new Writer();
  w.u8(FORMAT);
  w.str(title || 'Untitled', 40);
  w.u16(specs.length);
  for (const spec of specs) writeSpec(w, spec);
  return wrap(ALBUM_PREFIX, Uint8Array.from(w.bytes));
}

export function decodeAlbum(code) {
  const bytes = unwrap(ALBUM_PREFIX, code);
  const r = new Reader(bytes);
  const version = r.u8();
  if (version > FORMAT) throw new Error('that code was made by a newer version');
  const title = r.str();
  const count = r.u16();
  const specs = [];
  for (let i = 0; i < count; i++) specs.push(readSpec(r));
  return { title, specs };
}

// Which kind of code is this? Lets one paste box accept either.
export function codeKind(code) {
  const t = String(code || '').trim().toUpperCase();
  if (t.startsWith(ALBUM_PREFIX)) return 'album';
  if (t.startsWith(SONG_PREFIX)) return 'song';
  return null;
}
