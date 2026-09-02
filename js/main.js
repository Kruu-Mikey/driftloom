import { newSpec, rerollLayer, cloneSpec, render, LAYERS, STEPS_PER_BAR } from './generator.js';
import { Synth } from './synth.js';
import { Engine } from './engine.js';
import { patternToMidi } from './midi.js';
import * as store from './storage.js';
import * as ui from './ui.js';

const state = {
  ctx: null,
  synth: null,
  engine: null,
  spec: null,
  pattern: null,
  currentId: null,
  bar: -1,
  lite: false,
};

let lights = null;
let cells = null;

// --------------------------------------------------------------- audio

// Browsers will not make sound until a real gesture has happened, so the
// audio graph is built the first time you press something rather than on
// page load.
function ensureAudio() {
  if (state.ctx) {
    if (state.ctx.state === 'suspended') state.ctx.resume();
    return;
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  state.ctx = new Ctx({ latencyHint: 'playback' });
  buildAudio();
}

function buildAudio() {
  const wasPlaying = state.engine ? state.engine.playing : false;
  if (state.engine) state.engine.stop();
  state.synth = new Synth(state.ctx, state.lite ? 'lite' : 'full');
  state.engine = new Engine(state.ctx, state.synth);
  state.engine.onStep = onStep;
  state.engine.onLoop = onLoop;
  state.engine.driftOn = ui.el('driftToggle').checked;
  state.engine.driftAmount = parseFloat(ui.el('driftAmount').value);
  state.synth.setVolume(parseFloat(ui.el('volume').value));
  if (state.spec) {
    state.pattern = state.engine.load(state.spec);
    if (wasPlaying) state.engine.start();
  }
}

// -------------------------------------------------------------- loading

function loadSpec(spec, { keepPosition = false, id = null } = {}) {
  ensureAudio();
  state.spec = spec;
  state.currentId = id;
  state.pattern = state.engine.load(spec, { keepPosition });
  state.bar = -1;
  ui.renderReadout(spec, state.pattern);
  ui.renderGrids(cells, state.pattern, 0, spec.mutes);
  syncToneInputs(spec);
  refreshSaved();
}

function syncToneInputs(spec) {
  ui.el('bpm').value = spec.bpm;
  ui.el('warmth').value = spec.tone.warmth;
  ui.el('space').value = spec.tone.space;
  ui.el('wobble').value = spec.tone.wobble;
  ui.el('bpmVal').textContent = spec.bpm;
}

function refreshSaved() {
  ui.renderSaved(store.loadAll(), state.currentId, {
    onOpen: (entry) => {
      loadSpec(cloneSpec(entry.spec), { id: entry.id });
      if (!state.engine.playing) togglePlay();
      ui.toast(`Loaded ${entry.spec.name}`);
    },
    onMidi: (entry) => exportMidi(cloneSpec(entry.spec)),
    onDelete: (entry) => {
      store.remove(entry.id);
      if (state.currentId === entry.id) state.currentId = null;
      refreshSaved();
      ui.toast('Deleted');
    },
  });
}

// ------------------------------------------------------------ callbacks

function onStep(step) {
  if (!state.engine.playing) return; // frames queued before Stop
  const bar = Math.floor(step / STEPS_PER_BAR);
  if (bar !== state.bar) {
    state.bar = bar;
    ui.renderGrids(cells, state.engine.live, bar, state.spec.mutes);
  }
  ui.moveCursor(lights, cells, step % STEPS_PER_BAR);
}

function onLoop(count) {
  ui.el('loopCounter').textContent = `pass ${count}`;
}

// ------------------------------------------------------------- actions

function togglePlay() {
  ensureAudio();
  if (!state.engine.spec) loadSpec(state.spec || newSpec());
  if (state.engine.playing) {
    state.engine.stop();
    ui.el('playBtn').setAttribute('aria-pressed', 'false');
    ui.el('playLabel').textContent = 'Play';
    ui.moveCursor(lights, cells, -1);
  } else {
    state.engine.start();
    ui.el('playBtn').setAttribute('aria-pressed', 'true');
    ui.el('playLabel').textContent = 'Stop';
  }
}

function newLoop() {
  loadSpec(newSpec());
  state.engine.reset();
  ui.el('loopCounter').textContent = 'pass 0';
  if (!state.engine.playing) togglePlay();
  ui.toast(`New loop: ${state.spec.name}`);
}

function reroll(layer) {
  if (!state.spec) return newLoop();
  const next = rerollLayer(state.spec, layer);
  next.name = state.spec.name; // a re-roll is a revision, not a new piece
  loadSpec(next, { keepPosition: true, id: null });
  ui.toast(`Re-rolled ${layer}`);
}

function toggleMute(layer) {
  if (!state.spec) return;
  state.spec.mutes[layer] = !state.spec.mutes[layer];
  state.synth.setMute(layer, state.spec.mutes[layer]);
  ui.renderGrids(cells, state.engine.live || state.pattern, Math.max(0, state.bar), state.spec.mutes);
}

function saveCurrent() {
  if (!state.spec) return;
  const entry = store.save(state.spec);
  state.currentId = entry.id;
  refreshSaved();
  ui.toast(`Saved ${state.spec.name}`);
}

function exportMidi(spec = state.spec) {
  if (!spec) return;
  // Rendered straight from the spec so exporting never disturbs playback.
  const blob = patternToMidi(render(spec), { repeats: 4 });
  ui.download(blob, `${spec.name}-${spec.bpm}bpm.mid`);
  ui.toast('MIDI exported');
}

// ---------------------------------------------------------------- boot

function wire() {
  lights = ui.buildPlayhead();
  cells = ui.buildLayers({ onReroll: reroll, onMute: toggleMute });

  ui.el('playBtn').addEventListener('click', togglePlay);
  ui.el('newBtn').addEventListener('click', newLoop);
  ui.el('saveBtn').addEventListener('click', saveCurrent);
  ui.el('exportMidi').addEventListener('click', () => exportMidi());

  ui.el('renameBtn').addEventListener('click', () => {
    if (!state.spec) return;
    const name = prompt('Name this loop', state.spec.name);
    if (!name) return;
    state.spec.name = name.trim().slice(0, 40);
    ui.renderReadout(state.spec, state.pattern);
    if (state.currentId) store.rename(state.currentId, state.spec.name);
    refreshSaved();
  });

  ui.el('driftToggle').addEventListener('change', (e) => {
    if (state.engine) {
      state.engine.driftOn = e.target.checked;
      if (!e.target.checked && state.engine.base) state.engine.live = state.engine.base;
    }
    store.setPrefs({ drift: e.target.checked });
  });
  ui.el('driftAmount').addEventListener('input', (e) => {
    if (state.engine) state.engine.driftAmount = parseFloat(e.target.value);
  });
  ui.el('bpm').addEventListener('input', (e) => {
    if (!state.spec) return;
    state.spec.bpm = parseInt(e.target.value, 10);
    ui.el('bpmVal').textContent = state.spec.bpm;
    if (state.synth) state.synth.setEchoTime((60 / state.spec.bpm) * 0.75);
  });

  for (const k of ['warmth', 'space', 'wobble']) {
    ui.el(k).addEventListener('input', (e) => {
      if (!state.spec) return;
      state.spec.tone[k] = parseFloat(e.target.value);
      if (state.synth) state.synth.setTone(state.spec.tone);
    });
  }
  ui.el('volume').addEventListener('input', (e) => {
    if (state.synth) state.synth.setVolume(parseFloat(e.target.value));
    store.setPrefs({ volume: parseFloat(e.target.value) });
  });

  ui.el('liteMode').addEventListener('change', (e) => {
    state.lite = e.target.checked;
    store.setPrefs({ lite: state.lite });
    if (state.ctx) buildAudio();
  });

  ui.el('exportJson').addEventListener('click', () => {
    ui.download(store.exportAll(), 'driftloom-loops.json');
  });
  ui.el('importBtn').addEventListener('click', () => ui.el('importFile').click());
  ui.el('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const added = store.importAll(await file.text());
      refreshSaved();
      ui.toast(added ? `Restored ${added} loops` : 'Nothing new in that file');
    } catch {
      ui.toast('That file could not be read');
    }
    e.target.value = '';
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'n') newLoop();
    else if (e.key === 's') saveCurrent();
    else if (e.key >= '1' && e.key <= '5') reroll(LAYERS[parseInt(e.key, 10) - 1]);
  });

  // Small phones and cheap tablets get the lighter graph by default.
  const cores = navigator.hardwareConcurrency || 4;
  const prefs = store.getPrefs();
  state.lite = prefs.lite ?? cores <= 4;
  ui.el('liteMode').checked = state.lite;
  ui.el('driftToggle').checked = prefs.drift ?? true;
  if (prefs.volume != null) ui.el('volume').value = prefs.volume;

  // Show something on screen before any audio exists, so the first thing
  // you see is a real loop rather than an empty machine.
  state.spec = newSpec();
  ui.renderReadout(state.spec, { meta: { kit: 'none' } });
  syncToneInputs(state.spec);
  refreshSaved();
}

wire();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
