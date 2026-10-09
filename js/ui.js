import { LAYERS, LAYER_LABELS, STEPS_PER_BAR } from './generator.js';
import { CHARACTERS, resolveKey } from './characters.js';
import { NOTE_NAMES, SCALES } from './theory.js';
import { moodWord, pointWord } from './moods.js';

export const el = (id) => document.getElementById(id);

// ------------------------------------------------------------- readout

// The grid is rebuilt whenever the metre changes, because a bar of 6/8 is
// twelve cells, not sixteen with four dead ones on the end.
export function buildPlayhead(steps = STEPS_PER_BAR) {
  const host = el('playhead');
  host.innerHTML = '';
  host.style.gridTemplateColumns = `repeat(${steps}, 1fr)`;
  for (let i = 0; i < steps; i++) {
    const light = document.createElement('i');
    if (i % 4 === 0) light.className = 'beat';
    host.appendChild(light);
  }
  return host.children;
}

const METER = { 12: '6/8', 16: '4/4', 20: '5/4', 14: '7/8' };

// Both the profile blend and the feeling are mixtures, so show them as
// mixtures. Percentages are more honest than one adjective standing in for a
// loop that is 60% one thing and 30% another.
function asMixParts(weights, nameOf, max = 3) {
  return Object.entries(weights)
    .filter(([, w]) => w >= 0.05)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([k, w]) => `${Math.round(w * 100)}% ${nameOf(k)}`);
}

function mixParts(spec) {
  if (!spec.mix) {
    const c = CHARACTERS[resolveKey(spec.character || 'dust')];
    return [c ? c.label : 'Dust'];
  }
  const named = {};
  for (const [k, w] of Object.entries(spec.mix)) {
    const key = resolveKey(k);
    named[key] = (named[key] || 0) + w;
  }
  const parts = asMixParts(named, (k) => CHARACTERS[k].label);
  return parts.length ? parts : ['Dust'];
}

function feelParts(spec) {
  if (spec.feelMix && Object.keys(spec.feelMix).length) {
    return asMixParts(spec.feelMix, moodWord);
  }
  // Saves from before feeling became a mixture.
  return [pointWord(spec.feel || { lift: spec.mood ?? 0.5, energy: 0.5, warmth: 0.6 })];
}

// One fact per line, as the card lays them out: the blend, the feeling,
// then key, tempo, meter and form. `extra` adds the album being played and
// the pass count when a track length is set; both are what someone glancing
// at the card would otherwise have to go looking for.
export function renderReadout(spec, pattern, extra = {}) {
  setName(spec.name);
  const meter = METER[spec.stepsPerBar || 16] || `${spec.stepsPerBar}/16`;
  const shape = [];
  if (pattern && pattern.form) shape.push('airy');
  if (spec.cycles) shape.push('drifting');
  const parts = {
    mix: mixParts(spec),
    feel: feelParts(spec),
    key: `${NOTE_NAMES[spec.root]} ${SCALES[spec.scale].label}`,
    bpm: `${spec.bpm} bpm`,
    meter: `${meter} · ${spec.bars} bars`,
    shape: shape.join(' · '),
    album: extra.album || '',
    pass: extra.pass || '',
  };
  // The card is as tall as its art and no taller, so a loop with a lot to
  // say says it more compactly instead of pushing the viewport down. Each
  // level folds a little more together; the first that fits wins.
  for (let level = 0; level <= 5; level++) {
    setLines(readoutLines(parts, level));
    if (level === 5) el('loopDetail').classList.add('tight');
    if (!overflowing()) break;
  }
  const bpm = el('bpmVal');
  if (bpm) bpm.textContent = spec.bpm;
}

function readoutLines(p, level) {
  const lines = [];
  const mix = level >= 4 ? p.mix.slice(0, 1) : level >= 3 ? p.mix.slice(0, 2) : p.mix;
  const feel = level >= 2 ? p.feel.slice(0, 1) : p.feel;
  for (const m of mix) lines.push([m, 'mix']);
  for (const f of feel) lines.push([f, 'feel']);
  let meter = p.meter;
  if (level >= 1) {
    lines.push([`${p.key} · ${p.bpm}`]);
    lines.push([p.shape ? `${meter} · ${p.shape}` : meter]);
  } else {
    lines.push([p.key]);
    lines.push([p.bpm]);
    lines.push([meter]);
    if (p.shape) lines.push([p.shape]);
  }
  if (p.album) lines.push([p.album, 'album-line']);
  if (p.pass) lines.push([p.pass, 'faint']);
  return lines;
}

function overflowing() {
  const info = el('loopDetail').parentElement;
  return info.scrollHeight > info.clientHeight + 1;
}

// The card turned over to show an album: its art is drawn by the caller,
// this fills in the words.
export function renderAlbumCard(title, specs, extra = {}) {
  setName(title);
  const lines = [[`${specs.length} ${specs.length === 1 ? 'track' : 'tracks'}`, 'mix']];
  if (specs.length) {
    // The album's blend is the average of its loops' blends.
    const named = {};
    for (const spec of specs) {
      const mix = spec.mix || { [spec.character || 'dust']: 1 };
      for (const [k, w] of Object.entries(mix)) {
        const key = resolveKey(k);
        named[key] = (named[key] || 0) + w / specs.length;
      }
    }
    for (const part of asMixParts(named, (k) => (CHARACTERS[k] ? CHARACTERS[k].label : k), 2)) {
      lines.push([part, 'feel']);
    }
    const bpms = specs.map((s) => s.bpm);
    const lo = Math.min(...bpms);
    const hi = Math.max(...bpms);
    lines.push([lo === hi ? `${lo} bpm` : `${lo}-${hi} bpm`]);
    const secs = specs.reduce((t, s) => t + passSeconds(s), 0);
    lines.push([`~${formatTime(secs)} once through`]);
  }
  if (extra.playing) lines.push([extra.playing, 'album-line']);
  setLines(lines);
  if (overflowing()) el('loopDetail').classList.add('tight');
}

export function passSeconds(spec) {
  return spec.bars * (spec.stepsPerBar || 16) * (60 / spec.bpm / 4);
}

export function formatTime(secs) {
  if (secs < 90) return `${Math.round(secs)}s`;
  if (secs < 5400) return `${Math.round(secs / 60)}m`;
  if (secs < 86400) {
    const h = Math.floor(secs / 3600);
    const m = Math.round((secs % 3600) / 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(secs / 86400);
  const h = Math.round((secs % 86400) / 3600);
  return h ? `${d}d ${h}h` : `${d}d`;
}

// The name is as big as fits on one line of the card, down to a floor;
// only a name too long even at the floor wraps. Breaking "mun-dain" at its
// hyphen to keep a size reads worse than a slightly smaller name.
export function setName(name) {
  const h = el('loopName');
  h.textContent = name;
  fitName();
}

export function fitName() {
  const h = el('loopName');
  h.classList.remove('wrap');
  h.style.fontSize = '';
  let size = parseFloat(getComputedStyle(h).fontSize) || 32;
  while (h.scrollWidth > h.clientWidth + 1 && size > 18) {
    size -= 1;
    h.style.fontSize = `${size}px`;
  }
  if (h.scrollWidth > h.clientWidth + 1) h.classList.add('wrap');
}

function setLines(lines) {
  const host = el('loopDetail');
  host.classList.remove('tight');
  host.innerHTML = '';
  for (const [text, cls] of lines) {
    const li = document.createElement('li');
    li.textContent = text;
    if (cls) li.className = cls;
    host.appendChild(li);
  }
}

// -------------------------------------------------------------- layers

// Each layer shows one bar at sixteenth resolution. Showing the whole loop
// at once would squash a four-bar pattern into unreadable slivers on a
// phone, so the view follows the playhead bar by bar instead.
export function buildLayers(handlers, steps = STEPS_PER_BAR) {
  const host = el('layerList');
  host.innerHTML = '';
  const cells = {};
  cursors = [];

  for (const layer of LAYERS) {
    const row = document.createElement('div');
    row.className = 'layer';
    row.dataset.layer = layer;

    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = LAYER_LABELS[layer];

    const grid = document.createElement('div');
    grid.className = 'grid';
    grid.style.gridTemplateColumns = `repeat(${steps}, 1fr)`;
    grid.style.setProperty('--steps', steps);
    const boxes = [];
    for (let i = 0; i < steps; i++) {
      const b = document.createElement('b');
      grid.appendChild(b);
      boxes.push(b);
    }
    cells[layer] = boxes;
    // The cursor is one box laid over the row and slid along it, rather
    // than an outline switched on and off cell by cell. Sliding it is a
    // transform, which the compositor does without repainting anything.
    const cursor = document.createElement('i');
    cursor.className = 'cursor';
    grid.appendChild(cursor);
    cursors.push(cursor);

    const reroll = document.createElement('button');
    reroll.className = 'icon';
    reroll.textContent = 'roll';
    reroll.title = `Re-roll ${LAYER_LABELS[layer].toLowerCase()}`;
    reroll.addEventListener('click', () => handlers.onReroll(layer));

    const mute = document.createElement('button');
    mute.className = 'icon mute';
    mute.textContent = 'on';
    mute.title = `Mute ${LAYER_LABELS[layer].toLowerCase()}`;
    mute.addEventListener('click', () => handlers.onMute(layer));

    row.append(name, grid, reroll, mute);
    host.appendChild(row);
  }
  return cells;
}

function stepsForBar(pattern, layer, bar) {
  const spb = pattern.stepsPerBar || STEPS_PER_BAR;
  const out = new Array(spb).fill(0);
  // With polymeter a layer wraps on its own cycle, so ask where it actually
  // is rather than assuming it shares the pattern's bar lines.
  const cycle = (pattern.cycles && pattern.cycles[layer]) || pattern.totalSteps;
  const start = (bar * spb) % cycle;
  for (const e of pattern.tracks[layer]) {
    if (!e.vel) continue;
    const idx = ((e.step - start) % cycle + cycle) % cycle;
    if (idx >= spb) continue;
    out[idx] = Math.max(out[idx], e.vel);
  }
  return out;
}

export function renderGrids(cells, pattern, bar, mutes) {
  for (const layer of LAYERS) {
    const vels = stepsForBar(pattern, layer, bar);
    const boxes = cells[layer];
    for (let i = 0; i < boxes.length; i++) {
      const v = vels[i];
      const want = v ? (v > 0.55 ? 'hit strong' : 'hit') : '';
      // Only the cells that change. Writing a class, even the same one,
      // marks the cell for style and paint.
      if (boxes[i].className !== want) boxes[i].className = want;
    }
    const row = document.querySelector(`.layer[data-layer="${layer}"]`);
    row.classList.toggle('muted', !!mutes[layer]);
    row.querySelectorAll('.icon')[1].textContent = mutes[layer] ? 'off' : 'on';
  }
}

let lastCursor = -1;
let cursors = [];

export function resetCursor() {
  lastCursor = -1;
}

// Only the cell being left and the cell being entered change. The old
// version rewrote every cell in every layer on every step -- well over a
// hundred class writes several times a second, each one forcing a style
// recalculation, which is enough to make the playhead visibly drag on a
// phone.
//
// Nothing here repaints. A light's lit colour and glow are its own
// pseudo-element switched on and off by opacity, with no fade, and the
// layer cursors slide by transform; both run on the compositor. The old
// background-colour fade repainted the whole page on every frame it ran,
// and at a sixteenth's pace it was always running.
export function moveCursor(lights, cells, index) {
  if (index === lastCursor) return;
  if (lastCursor >= 0 && lights[lastCursor]) lights[lastCursor].classList.remove('on');
  if (index >= 0 && lights[index]) lights[index].classList.add('on');
  for (const c of cursors) {
    if (index < 0) {
      c.style.opacity = '0';
    } else {
      c.style.transform = `translateX(calc(${index} * (100% + 2px)))`;
      c.style.opacity = '1';
    }
  }
  lastCursor = index;
}

// --------------------------------------------------------------- misc

let toastTimer = null;
export function toast(message) {
  const t = el('toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

export function download(blob, filename) {
  // Loop names are user-editable, and a slash or colon in one either breaks
  // the download or silently writes somewhere unexpected.
  const safe = filename
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .slice(0, 120) || 'driftloom.dat';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safe;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// --------------------------------------------------------------- icons

// Line icons on a 24-unit grid, drawn in the button's text color so the
// panel's palette decides how they look, not the icon. Anything marked
// `solid` is filled instead of stroked.
const ICONS = {
  prev: '<path class="solid" d="M19 20 9 12l10-8z"/><path d="M5 19V5"/>',
  next: '<path class="solid" d="m5 4 10 8-10 8z"/><path d="M19 5v14"/>',
  play: '<path class="solid" d="M7 4.5v15l12.5-7.5z"/>',
  pause: '<rect class="solid" x="6" y="4.5" width="4" height="15" rx="1"/>'
    + '<rect class="solid" x="14" y="4.5" width="4" height="15" rx="1"/>',
  // Books on a shelf: what Library looks like everywhere else.
  library: '<path d="M4 4v16"/><path d="M8 7v13"/><path d="M12 5v15"/><path d="m16 6 4 14"/>',
  // A bookmark rather than a floppy disk: "keep this one".
  save: '<path d="M18 21l-6-4.5L6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M12 7.5v6"/><path d="M9 10.5h6"/>',
  saved: '<path class="solid" d="M18 21l-6-4.5L6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/>',
  // Three joined dots: the share mark phones already use.
  share: '<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/>'
    + '<path d="m8.3 13.3 7.4 4.4"/><path d="m15.7 6.3-7.4 4.4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  sounds: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  layers: '<path d="M12 2.5 2.5 7.25 12 12l9.5-4.75z"/><path d="m2.5 16.75 9.5 4.75 9.5-4.75"/><path d="m2.5 12 9.5 4.75L21.5 12"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
};

export function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
}

// Only rewrites when the icon actually changes, since it is called on every
// load and every play/stop.
export function setIcon(button, name) {
  if (button.dataset.icon === name) return;
  button.dataset.icon = name;
  button.innerHTML = icon(name);
}
