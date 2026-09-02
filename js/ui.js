import { LAYERS, LAYER_LABELS, STEPS_PER_BAR } from './generator.js';
import { NOTE_NAMES, SCALES } from './theory.js';

export const el = (id) => document.getElementById(id);

// ------------------------------------------------------------- readout

export function buildPlayhead() {
  const host = el('playhead');
  host.innerHTML = '';
  for (let i = 0; i < STEPS_PER_BAR; i++) {
    const light = document.createElement('i');
    if (i % 4 === 0) light.className = 'beat';
    host.appendChild(light);
  }
  return host.children;
}

export function renderReadout(spec, pattern) {
  el('loopName').textContent = spec.name;
  const key = `${NOTE_NAMES[spec.root]} ${SCALES[spec.scale].label}`;
  const kit = pattern.meta.kit === 'none' ? 'no drums' : `${pattern.meta.kit} kit`;
  el('loopDetail').textContent = `${key} · ${spec.bpm} bpm · ${spec.bars} bars · ${kit}`;
  el('bpmVal').textContent = spec.bpm;
}

// -------------------------------------------------------------- layers

// Each layer shows one bar at sixteenth resolution. Showing the whole loop
// at once would squash a four-bar pattern into unreadable slivers on a
// phone, so the view follows the playhead bar by bar instead.
export function buildLayers(handlers) {
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
    const boxes = [];
    for (let i = 0; i < STEPS_PER_BAR; i++) {
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
  const out = new Array(STEPS_PER_BAR).fill(0);
  const start = bar * STEPS_PER_BAR;
  for (const e of pattern.tracks[layer]) {
    if (!e.vel) continue;
    const idx = e.step - start;
    if (idx < 0 || idx >= STEPS_PER_BAR) continue;
    out[idx] = Math.max(out[idx], e.vel);
  }
  return out;
}

export function renderGrids(cells, pattern, bar, mutes) {
  for (const layer of LAYERS) {
    const vels = stepsForBar(pattern, layer, bar);
    const boxes = cells[layer];
    for (let i = 0; i < STEPS_PER_BAR; i++) {
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
