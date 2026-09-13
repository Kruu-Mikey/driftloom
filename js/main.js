import { newSpec, rerollLayer, cloneSpec, render, LAYERS, STEPS_PER_BAR } from './generator.js';
import { Synth } from './synth.js';
import { Engine } from './engine.js';
import { patternToMidi } from './midi.js';
import { MediaBridge } from './media.js';
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
  gridSteps: 16,
  frameHandle: null,
  lite: false,
  media: null,
  history: [],            // array of specs (max 5)
  historyIndex: -1,       // current position in history
};
const HISTORY_LIMIT = 5;

let lights = null;
let cells = null;

// --------------------------------------------------------------- audio

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
  // Tear the previous graph down before replacing it, or each rebuild
  // leaves a whole synth wired to the speakers and another keepalive
  // element in the DOM.
  if (state.media) state.media.dispose();
  if (state.synth) state.synth.dispose();
  state.synth = new Synth(state.ctx, state.lite ? 'lite' : 'full');
  // Route the mix through a media element so the phone gives us lock-screen
  // controls and stops treating us as an idle tab.
  state.media = new MediaBridge(state.ctx);
  state.media.attach(state.synth.output);
  state.media.setHandlers({
    onPlay: () => { if (!state.engine.playing) togglePlay(); },
    onPause: () => { if (state.engine.playing) togglePlay(); },
    onNext: () => goForward(),
    onPrev: () => goBack(),
  });
  state.engine = new Engine(state.ctx, state.synth);
  state.engine.onStep = onStep;
  state.engine.onLoop = onLoop;
  state.engine.visualOffset = (parseInt(ui.el('playheadSync').value, 10) || 0) / 1000;
  state.engine.driftOn = ui.el('driftToggle').checked;
  state.engine.driftAmount = parseFloat(ui.el('driftAmount').value);
  state.synth.setVolume(parseFloat(ui.el('volume').value));
  if (state.spec) {
    state.pattern = state.engine.load(state.spec);
    if (wasPlaying) {
      // The new bridge has to take over the media session too, otherwise
      // the lock-screen controls stay attached to the graph we just binned.
      state.media.start();
      state.engine.start();
      syncMediaMetadata();
      state.media.setPlaybackState(true);
      if (!state.frameHandle) state.frameHandle = requestAnimationFrame(frameLoop);
    }
  }
}

// -------------------------------------------------------------- history

function pushHistory(spec) {
  // If we're not at the end, discard forward history
  if (state.historyIndex < state.history.length - 1) {
    state.history = state.history.slice(0, state.historyIndex + 1);
  }
  state.history.push(JSON.parse(JSON.stringify(spec)));
  if (state.history.length > HISTORY_LIMIT) state.history.shift();
  state.historyIndex = state.history.length - 1;
  updateHistoryButtons();
}

function goBack() {
  if (state.historyIndex > 0) {
    state.historyIndex--;
    const spec = cloneSpec(state.history[state.historyIndex]);
    loadSpec(spec, { keepPosition: false, pushToHistory: false });
    if (!state.engine.playing) togglePlay();
    ui.toast(spec.name);
  }
}

function goForward() {
  // At the end of the history, skipping forward makes something new. A skip
  // button that does nothing is worse than no skip button, and on a headset
  // there is no other way to ask for a fresh loop.
  if (state.historyIndex >= state.history.length - 1) {
    newLoop();
    return;
  }
  state.historyIndex++;
  const spec = cloneSpec(state.history[state.historyIndex]);
  loadSpec(spec, { keepPosition: false, pushToHistory: false });
  if (!state.engine.playing) togglePlay();
  ui.toast(spec.name);
}

function resetHistory(spec) {
  state.history = [JSON.parse(JSON.stringify(spec))];
  state.historyIndex = 0;
  updateHistoryButtons();
}

function updateHistoryButtons() {
  const prev = ui.el('prevBtn');
  if (prev) prev.disabled = state.historyIndex <= 0;
  // Next is never disabled: past the end of the history it makes a new loop.
}

// -------------------------------------------------------------- loading

function loadSpec(spec, { keepPosition = false, id = null, pushToHistory = false } = {}) {
  ensureAudio();
  // A bar of 6/8 is twelve cells and 5/4 is twenty, so the grid has to be
  // rebuilt whenever the metre changes. Without this the cursor indexes a
  // sixteen-cell grid against twelve steps of music and drifts away from it.
  const spb = spec.stepsPerBar || 16;
  if (spb !== state.gridSteps) {
    state.gridSteps = spb;
    lights = ui.buildPlayhead(spb);
    cells = ui.buildLayers({ onReroll: reroll, onMute: toggleMute }, spb);
    ui.resetCursor();
  }
  state.spec = spec;
  state.currentId = id;
  state.pattern = state.engine.load(spec, { keepPosition });
  state.bar = -1;
  ui.renderReadout(spec, state.pattern);
  ui.renderGrids(cells, state.pattern, 0, spec.mutes);
  syncToneInputs(spec);
  refreshSaved();
  if (pushToHistory) pushHistory(spec);
  updateHistoryButtons();
  syncMediaMetadata();
}

// The lock screen and the headset notification read from here. Called on
// every load and again on Play, because the very first loop is put into the
// engine while the audio graph is being built, before any load happens.
function syncMediaMetadata() {
  if (!state.media || !state.spec) return;
  state.media.setMetadata(state.spec.name, `${state.spec.bpm} bpm · Driftloom`);
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
      resetHistory(cloneSpec(entry.spec));
      loadSpec(cloneSpec(entry.spec), { id: entry.id, pushToHistory: false });
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

// Repaint on animation frames, reading position off the audio clock. This
// is the only place the cursor moves.
function frameLoop() {
  if (!state.engine || !state.engine.playing) {
    state.frameHandle = null;
    return;
  }
  const step = state.engine.visualStep();
  if (step != null) onStep(step);
  state.frameHandle = requestAnimationFrame(frameLoop);
}

function onStep(step) {
  if (!state.engine.playing) return;
  const spb = state.gridSteps;
  const bar = Math.floor(step / spb);
  if (bar !== state.bar) {
    state.bar = bar;
    ui.renderGrids(cells, state.engine.live, bar, state.spec.mutes);
  }
  ui.moveCursor(lights, cells, step % spb);
}

function onLoop(count) {
  ui.el('loopCounter').textContent = `pass ${count}`;
}

// ------------------------------------------------------------- actions

function togglePlay() {
  ensureAudio();
  if (!state.engine.spec) {
    const s = state.spec || newSpec();
    resetHistory(s);
    loadSpec(s, { pushToHistory: false });
  }
  if (state.engine.playing) {
    state.engine.stop();
    state.media.stop();
    state.media.setPlaybackState(false);
    ui.el('playBtn').setAttribute('aria-pressed', 'false');
    ui.el('playLabel').textContent = 'Play';
    ui.moveCursor(lights, cells, -1);
    ui.resetCursor();
  } else {
    state.media.start();
    state.engine.start();
    if (!state.frameHandle) state.frameHandle = requestAnimationFrame(frameLoop);
    syncMediaMetadata();
    state.media.setPlaybackState(true);
    ui.el('playBtn').setAttribute('aria-pressed', 'true');
    ui.el('playLabel').textContent = 'Stop';
  }
}

function newLoop() {
  // Save the current loop to history before creating a new one (if it exists)
  if (state.spec) {
    // Avoid duplicate if the current spec is already the last in history
    const last = state.history[state.history.length - 1];
    if (!last || JSON.stringify(last) !== JSON.stringify(state.spec)) {
      pushHistory(state.spec);
    }
  }
  const s = newSpec();
  // Push the new spec to history (this truncates any forward history)
  pushHistory(s);
  // Load the new spec without pushing it again
  loadSpec(s, { pushToHistory: false });
  state.engine.reset();
  ui.el('loopCounter').textContent = 'pass 0';
  if (!state.engine.playing) togglePlay();
  ui.toast(`New loop: ${s.name}`);
  updateHistoryButtons();
}

function reroll(layer) {
  if (!state.spec) return newLoop();
  const next = rerollLayer(state.spec, layer);
  next.name = state.spec.name; // a re-roll is a revision, not a new piece
  // And because it is a revision it REPLACES the current history entry
  // instead of adding one. Otherwise Previous walks back through your own
  // rolls of the same loop rather than reaching the loop before it.
  loadSpec(next, { keepPosition: true, id: null, pushToHistory: false });
  if (state.historyIndex >= 0 && state.history[state.historyIndex]) {
    state.history[state.historyIndex] = cloneSpec(next);
  }
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
  const blob = patternToMidi(render(spec), { repeats: 4 });
  ui.download(blob, `${spec.name}-${spec.bpm}bpm.mid`);
  ui.toast('MIDI exported');
}

// ---------------------------------------------------------------- boot

function wire() {
  lights = ui.buildPlayhead(state.gridSteps);
  cells = ui.buildLayers({ onReroll: reroll, onMute: toggleMute }, state.gridSteps);

  ui.el('playBtn').addEventListener('click', togglePlay);
  ui.el('newBtn').addEventListener('click', newLoop);
  ui.el('saveBtn').addEventListener('click', saveCurrent);
  ui.el('exportMidi').addEventListener('click', () => exportMidi());
  ui.el('prevBtn').addEventListener('click', goBack);
  ui.el('nextBtn').addEventListener('click', goForward);

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
  ui.el('playheadSync').addEventListener('input', (e) => {
    const ms = parseInt(e.target.value, 10);
    ui.el('syncVal').textContent = `${ms} ms`;
    if (state.engine) state.engine.visualOffset = ms / 1000;
    store.setPrefs({ playheadSync: ms });
  });

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

  const renderDiag = () => {
    const lines = [];
    const push = (o) => { for (const [k, v] of Object.entries(o)) lines.push(`${k}: ${v}`); };
    lines.push(`ua: ${navigator.userAgent}`);
    lines.push(`standalone: ${window.matchMedia('(display-mode: standalone)').matches}`);
    lines.push(`cores: ${navigator.hardwareConcurrency || '?'}  lite: ${state.lite}`);
    if (state.media) push(state.media.report());
    else lines.push('media: not built yet (press Play)');
    if (state.engine && state.engine.spec) push(state.engine.report());
    else lines.push('engine: not built yet (press Play)');
    ui.el('diagOut').textContent = lines.join('\n');
  };

  ui.el('diagRefresh').addEventListener('click', renderDiag);
  document.querySelector('.diag').addEventListener('toggle', (e) => {
    if (e.target.open) renderDiag();
  });
  ui.el('diagReset').addEventListener('click', () => {
    if (state.engine) state.engine.clearMetrics();
    renderDiag();
    ui.toast('Counters cleared');
  });
  ui.el('diagCopy').addEventListener('click', async () => {
    renderDiag();
    try {
      await navigator.clipboard.writeText(ui.el('diagOut').textContent);
      ui.toast('Diagnostics copied');
    } catch {
      ui.toast('Select the text above and copy it manually');
    }
  });

  ui.el('copyBackup').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(await store.exportAll().text());
      ui.toast('Backup copied. Paste it somewhere safe.');
    } catch {
      ui.toast('This browser will not let the page reach the clipboard');
    }
  });

  ui.el('pasteBackup').addEventListener('click', async () => {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = prompt('Paste your backup here') || '';
    }
    if (!text.trim()) return;
    try {
      const added = store.importAll(text);
      refreshSaved();
      ui.toast(added ? `Restored ${added} loops` : 'Nothing new in that backup');
    } catch {
      ui.toast('That does not look like a Driftloom backup');
    }
  });
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
    if (e.code === 'Space' || e.code === 'MediaPlayPause') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'n') newLoop();
    else if (e.key === 's') saveCurrent();
    else if (e.key >= '1' && e.key <= '5') reroll(LAYERS[parseInt(e.key, 10) - 1]);
    else if (e.code === 'MediaNextTrack') {
      e.preventDefault();
      goForward();
    } else if (e.code === 'MediaPreviousTrack') {
      e.preventDefault();
      goBack();
    }
  });

  // The scheduler queues further ahead while hidden, so it has to be told
  // when that changes. Resume anything the system paused on the way out.
  document.addEventListener('visibilitychange', () => {
    if (state.ctx && state.ctx.state === 'suspended') state.ctx.resume();
    if (state.engine) state.engine.retune();
    if (document.visibilityState === 'visible' && state.media && state.engine
        && state.engine.playing) {
      state.media.resume();
    }
  });

  const cores = navigator.hardwareConcurrency || 4;
  const prefs = store.getPrefs();
  state.lite = prefs.lite ?? cores <= 4;
  ui.el('liteMode').checked = state.lite;
  ui.el('driftToggle').checked = prefs.drift ?? true;
  if (prefs.volume != null) ui.el('volume').value = prefs.volume;
  const sync = prefs.playheadSync ?? 0;
  ui.el('playheadSync').value = sync;
  ui.el('syncVal').textContent = `${sync} ms`;

  state.spec = newSpec();
  // Build the grid for the metre of the loop that is actually on screen,
  // not for an assumed 4/4.
  state.gridSteps = state.spec.stepsPerBar || 16;
  lights = ui.buildPlayhead(state.gridSteps);
  cells = ui.buildLayers({ onReroll: reroll, onMute: toggleMute }, state.gridSteps);
  ui.resetCursor();
  resetHistory(state.spec);
  ui.renderReadout(state.spec, { meta: { kit: 'none' } });
  syncToneInputs(state.spec);
  refreshSaved();
  updateHistoryButtons();
}

wire();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}