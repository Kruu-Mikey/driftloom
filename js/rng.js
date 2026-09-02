// Deterministic pseudo-random number generation.
// Everything in Driftloom grows from seeds, so the same seed always
// produces the same loop. That is what makes a 40-byte save file enough
// to store a whole four-bar piece.

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed) {
    this.next = mulberry32((seed >>> 0) || 1);
  }
  f() {
    return this.next();
  }
  range(a, b) {
    return a + this.next() * (b - a);
  }
  int(a, b) {
    // inclusive on both ends
    return Math.floor(a + this.next() * (b - a + 1));
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p) {
    return this.next() < p;
  }
  // weighted([[value, weight], ...])
  weighted(items) {
    let total = 0;
    for (const it of items) total += it[1];
    let r = this.next() * total;
    for (const [v, w] of items) {
      r -= w;
      if (r <= 0) return v;
    }
    return items[items.length - 1][0];
  }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  // A fresh 32-bit seed, used to hand each layer its own independent stream.
  seed32() {
    return Math.floor(this.next() * 4294967296) >>> 0;
  }
}

export function randomSeed() {
  return (Math.random() * 4294967296) >>> 0;
}

const ONSETS = ['k', 's', 't', 'm', 'n', 'h', 'r', 'w', 'y', 'v', 'l', 'd', 'f', 'sh', 'th', 'br', 'gl'];
const NUCLEI = ['a', 'e', 'i', 'o', 'u', 'ai', 'ei', 'oa', 'ui', 'ou'];
const CODAS = ['', '', '', 'n', 'm', 'l', 'r', 'sk', 'th', 'ng'];

// Seeds are long numbers and hard to say out loud. Give every loop a
// pronounceable name derived from its seed, the way world seeds get names.
export function seedName(seed) {
  const r = new Rng((seed >>> 0) ^ 0x9e3779b9);
  // Two syllables. Three fits, but it wraps onto a second line on a phone
  // and the name is meant to be glanceable.
  return `${r.pick(ONSETS)}${r.pick(NUCLEI)}${r.pick(CODAS)}-${r.pick(ONSETS)}${r.pick(NUCLEI)}${r.pick(CODAS)}`;
}
