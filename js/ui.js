import { LAYERS, LAYER_LABELS, STEPS_PER_BAR } from './generator.js';
import { CHARACTERS } from './characters.js';
import { NOTE_NAMES, SCALES } from './theory.js';

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

export function renderReadout(spec, pattern) {
  el('loopName').textContent = spec.name;
  const character = CHARACTERS[spec.character];
  const key = `${NOTE_NAMES[spec.root]} ${SCALES[spec.scale].label}`;
  const meter = METER[spec.stepsPerBar || 16] || `${spec.stepsPerBar}/16`;
  const bits = [character ? character.label : 'Tape', key, `${spec.bpm} bpm`, meter];
  if (spec.cycles) bits.push('drifting');
  el('loopDetail').textContent = bits.join(' · ');
  el('bpmVal').textContent = spec.bpm;
}

// -------------------------------------------------------------- layers

// Each layer shows one bar at sixteenth resolution. Showing the whole loop
// at once would squash a four-bar pattern into unreadable slivers on a
// phone, so the view follows the playhead bar by bar instead.
export function buildLayers(handlers, steps = STEPS_PER_BAR) {
  const host = el('layerList');
  host.innerHTML = '';
  const cells = {};

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
    const boxes = [];
    for (let i = 0; i < steps; i++) {
      const b = document.createElement('b');
      grid.appendChild(b);
      boxes.push(b);
    }
    cells[layer] = boxes;

    const reroll = document.createElement('button');
    reroll.className = 'icon';
    reroll.textContent = 'roll';
    reroll.title = `Re-roll ${LAYER_LABELS[layer].toLowerCase()}`;
    reroll.addEventListener('click', () => handlers.onReroll(layer));

    const mute = document.createElement('button');
    mute.className = 'icon';
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
      boxes[i].className = v ? (v > 0.55 ? 'hit strong' : 'hit') : '';
    }
    const row = document.querySelector(`.layer[data-layer="${layer}"]`);
    row.classList.toggle('muted', !!mutes[layer]);
    row.querySelectorAll('.icon')[1].textContent = mutes[layer] ? 'off' : 'on';
  }
}

export function moveCursor(lights, cells, index) {
  for (let i = 0; i < lights.length; i++) {
    lights[i].classList.toggle('on', i === index);
  }
  for (const layer of Object.keys(cells)) {
    const boxes = cells[layer];
    for (let i = 0; i < boxes.length; i++) {
      boxes[i].classList.toggle('cursor', i === index);
    }
  }
}

// --------------------------------------------------------------- saved

export function renderSaved(list, currentId, handlers) {
  const host = el('savedList');
  host.innerHTML = '';
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Nothing saved yet. Find a loop you like and press Save.';
    host.appendChild(p);
    return;
  }
  for (const entry of list) {
    const row = document.createElement('div');
    row.className = 'saved' + (entry.id === currentId ? ' current' : '');

    const open = document.createElement('button');
    open.className = 'saved-name';
    const key = `${NOTE_NAMES[entry.spec.root]} ${SCALES[entry.spec.scale].label}`;
    open.innerHTML = '';
    open.appendChild(document.createTextNode(entry.spec.name));
    const meta = document.createElement('span');
    meta.className = 'saved-meta';
    meta.textContent = `${key} · ${entry.spec.bpm} bpm`;
    open.appendChild(meta);
    open.addEventListener('click', () => handlers.onOpen(entry));

    const midi = document.createElement('button');
    midi.className = 'ghost tiny';
    midi.textContent = 'midi';
    midi.addEventListener('click', () => handlers.onMidi(entry));

    const del = document.createElement('button');
    del.className = 'ghost tiny';
    del.textContent = 'delete';
    del.addEventListener('click', () => handlers.onDelete(entry));

    row.append(open, midi, del);
    host.appendChild(row);
  }
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
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
