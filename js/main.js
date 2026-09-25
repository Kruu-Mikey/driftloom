import { newSpec, rerollLayer, cloneSpec, render, choirOf, LAYERS, STEPS_PER_BAR } from './generator.js';
import { Synth } from './synth.js';
import { Engine } from './engine.js';
import { patternToMidi } from './midi.js';
import { MediaBridge } from './media.js';
import * as share from './share.js';

// Build stamp. Shown in Diagnostics so that after a deploy you can confirm
// in one glance which version you are actually running, rather than
// guessing whether a change landed. Bump it with CACHE in sw.js.
const BUILD = 'v47';

// Reported in Diagnostics. Declared here rather than beside the registration
// at the foot of the file so it is initialised before anything can read it.
let swState = 'unsupported';
// Curated stops rather than a linear range: 0 to 9999 on a slider gives you
// no useful control at the short end, and short lengths are what anyone
// actually sets. The top end still reaches well past a day on a two-bar loop.
const TRACK_LENGTHS = [
  0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128,
  192, 256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096, 6144, 9999,
];
import { drawCover, albumCoverSpec } from './cover.js';
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
  playlist: null,
  openAlbum: null,
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
  state.engine.onTrackEnd = onTrackEnd;
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
  if (state.playlist && state.playlist.ids.length) {
    advancePlaylist(-1);
    return;
  }
  if (state.historyIndex > 0) {
    state.historyIndex--;
    const spec = cloneSpec(state.history[state.historyIndex]);
    loadSpec(spec, { keepPosition: false, pushToHistory: false });
    if (!state.engine.playing) togglePlay();
    ui.toast(spec.name);
  }
}

function goForward() {
  // While an album is playing the skip buttons belong to the album, which is
  // what anyone would expect them to do.
  if (state.playlist && state.playlist.ids.length) {
    advancePlaylist(1);
    return;
  }
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
  drawCoverFor(spec);
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

// Passes are the honest unit -- a track ends on a whole loop -- but nobody
// thinks in passes, so show the time it comes to at this tempo as well.
function describeLength(passes, spec) {
  if (!passes) return 'off';
  if (!spec) return `${passes} passes`;
  const spb = spec.stepsPerBar || 16;
  const secs = passes * spec.bars * spb * (60 / spec.bpm / 4);
  let time;
  if (secs < 90) time = `${Math.round(secs)}s`;
  else if (secs < 5400) time = `${Math.round(secs / 60)}m`;
  else if (secs < 86400) {
    const h = Math.floor(secs / 3600);
    const m = Math.round((secs % 3600) / 60);
    time = m ? `${h}h ${m}m` : `${h}h`;
  } else {
    const d = Math.floor(secs / 86400);
    const h = Math.round((secs % 86400) / 3600);
    time = h ? `${d}d ${h}h` : `${d}d`;
  }
  return `${passes} ${passes === 1 ? 'pass' : 'passes'} · ~${time}`;
}

function drawCoverFor(spec) {
  const canvas = ui.el('cover');
  if (!canvas || !spec) return;
  try {
    drawCover(canvas, spec, 320);
  } catch (err) {
    console.warn('Could not draw cover', err);
  }
}

function refreshAlbums() {
  const host = ui.el('albumList');
  if (!host) return;
  host.innerHTML = '';
  const albums = store.loadAlbums();
  if (!albums.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No albums yet. Make one, then add the loop you are playing.';
    host.appendChild(p);
    return;
  }
  const saved = store.loadAll();
  const specOf = (id) => (saved.find((e) => e.id === id) || {}).spec;

  for (const album of albums) {
    const present = album.ids.filter((id) => specOf(id));
    const open = state.openAlbum === album.id;

    const row = document.createElement('div');
    row.className = 'album';

    const art = document.createElement('canvas');
    art.className = 'album-art';
    try {
      const specs = present.map(specOf);
      drawCover(art, albumCoverSpec(album.title, specs.length ? specs : [
        { seed: 1, feel: { lift: 0.5, energy: 0.3, warmth: 0.6 }, mix: { dust: 1 } },
      ]), 96);
    } catch (err) {
      console.warn('Could not draw album art', err);
    }

    const name = document.createElement('button');
    name.className = 'album-name';
    name.appendChild(document.createTextNode(album.title));
    const meta = document.createElement('span');
    meta.className = 'album-meta';
    meta.textContent = `${present.length} loop${present.length === 1 ? '' : 's'} · tap to ${open ? 'close' : 'open'}`;
    name.appendChild(meta);
    name.addEventListener('click', () => {
      state.openAlbum = open ? null : album.id;
      refreshAlbums();
    });

    const play = document.createElement('button');
    play.className = 'ghost tiny';
    play.textContent = 'play';
    play.addEventListener('click', () => {
      if (!present.length) { ui.toast('That album is empty'); return; }
      state.playlist = { albumId: album.id, title: album.title, ids: present.slice(), index: -1 };
      advancePlaylist(1);
    });

    row.append(art, name, play);
    host.appendChild(row);
    if (!open) continue;

    const panel = document.createElement('div');
    panel.className = 'album-open';

    present.forEach((id, i) => {
      const spec = specOf(id);
      const t = document.createElement('div');
      t.className = 'album-track';

      const label = document.createElement('button');
      label.className = 'track-name';
      label.textContent = `${i + 1}. ${spec.name}`;
      label.addEventListener('click', () => {
        state.playlist = { albumId: album.id, title: album.title, ids: present.slice(), index: i - 1 };
        advancePlaylist(1);
      });

      // Overwrite this entry with whatever is playing now, so a loop can be
      // tweaked and put back without losing its place in the running order.
      const update = document.createElement('button');
      update.className = 'ghost tiny';
      update.textContent = 'replace';
      update.addEventListener('click', () => {
        if (!state.spec) return;
        if (!store.replaceSpec(id, state.spec)) {
          ui.toast('Could not save that change');
          return;
        }
        refreshAlbums();
        refreshSaved();
        ui.toast(`Replaced track ${i + 1}`);
      });

      const drop = document.createElement('button');
      drop.className = 'ghost tiny';
      drop.textContent = 'remove';
      drop.addEventListener('click', () => {
        store.setAlbumIds(album.id, album.ids.filter((x) => x !== id));
        refreshAlbums();
        ui.toast('Removed from album');
      });

      t.append(label, update, drop);
      panel.appendChild(t);
    });

    if (!present.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'Nothing in here yet.';
      panel.appendChild(p);
    }

    const tools = document.createElement('div');
    tools.className = 'row wrap';

    const add = document.createElement('button');
    add.className = 'ghost';
    add.textContent = 'Add current loop';
    add.addEventListener('click', () => {
      if (!state.spec) return;
      // Adding to an album IS saving it. Making someone press Save first was
      // a rule the app imposed for its own convenience, not the user's.
      let id = state.currentId;
      const known = id && store.loadAll().some((e) => e.id === id);
      if (!known) {
        const entry = store.save(state.spec);
        if (!entry) { ui.toast('Could not save this loop'); return; }
        id = entry.id;
        state.currentId = id;
      }
      if (album.ids.includes(id)) { ui.toast('Already in this album'); return; }
      store.setAlbumIds(album.id, [...album.ids, id]);
      refreshAlbums();
      refreshSaved();
      ui.toast(`Added to ${album.title}`);
    });

    const rename = document.createElement('button');
    rename.className = 'ghost';
    rename.textContent = 'Rename';
    rename.addEventListener('click', () => {
      const title = prompt('Rename album', album.title);
      if (!title) return;
      if (!store.renameAlbum(album.id, title.trim())) {
        ui.toast('Could not rename');
        return;
      }
      refreshAlbums();
    });

    const code = document.createElement('button');
    code.className = 'ghost';
    code.textContent = 'Share code';
    code.addEventListener('click', async () => {
      const specs = present.map(specOf);
      if (!specs.length) { ui.toast('That album is empty'); return; }
      await offerCode(share.encodeAlbum(album.title, specs), `${album.title} · ${specs.length} loops`);
    });

    const del = document.createElement('button');
    del.className = 'ghost';
    del.textContent = 'Delete album';
    del.addEventListener('click', () => {
      store.removeAlbum(album.id);
      if (state.openAlbum === album.id) state.openAlbum = null;
      if (state.playlist && state.playlist.albumId === album.id) state.playlist = null;
      refreshAlbums();
      ui.toast('Album deleted');
    });

    tools.append(add, rename, code, del);
    panel.appendChild(tools);
    host.appendChild(panel);
  }
}

// Put a code where it can be taken. The clipboard is the quick path; the
// box below is the one that still works when the clipboard is refused.
async function offerCode(code, label) {
  const out = ui.el('shareOut');
  out.hidden = false;
  out.textContent = `${label}\n\n${code}`;
  try {
    await navigator.clipboard.writeText(code);
    ui.toast('Code copied');
  } catch {
    ui.toast('Copy it from the box below');
  }
}

function syncToneInputs(spec) {
  ui.el('bpm').value = spec.bpm;
  const len = spec.playFor || 0;
  let idx = TRACK_LENGTHS.indexOf(len);
  if (idx < 0) {
    idx = TRACK_LENGTHS.reduce((best, v, i) =>
      Math.abs(v - len) < Math.abs(TRACK_LENGTHS[best] - len) ? i : best, 0);
  }
  ui.el('trackLen').value = idx;
  ui.el('lenVal').textContent = describeLength(len, spec);
  ui.el('warmth').value = spec.tone.warmth;
  ui.el('space').value = spec.tone.space;
  ui.el('wobble').value = spec.tone.wobble;
  ui.el('bpmVal').textContent = spec.bpm;
}

function refreshSaved() {
  ui.renderSaved(store.loadAll(), state.currentId, {
    onOpen: (entry) => {
      // One unreadable save should not take the app down with it.
      try {
        resetHistory(cloneSpec(entry.spec));
        loadSpec(cloneSpec(entry.spec), { id: entry.id, pushToHistory: false });
      } catch (err) {
        console.warn('Could not open saved loop', err);
        ui.toast('That saved loop could not be opened');
        return;
      }
      if (!state.engine.playing) togglePlay();
      ui.toast(`Loaded ${entry.spec.name}`);
    },
    onMidi: (entry) => exportMidi(cloneSpec(entry.spec)),
    onDelete: (entry) => {
      if (!store.remove(entry.id)) {
        ui.toast('Could not delete - this browser is refusing to store data');
        return;
      }
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
  const limit = state.spec && state.spec.playFor;
  ui.el('loopCounter').textContent = limit ? `pass ${count} of ${limit}` : `pass ${count}`;
}

// A track that has run its length hands over: to the next loop in the album
// if one is playing, otherwise onward through the history.
function onTrackEnd() {
  // Out of the scheduler's call stack before touching the graph.
  setTimeout(() => {
    if (state.playlist && state.playlist.ids.length) advancePlaylist(1);
    else goForward();
  }, 0);
}

function advancePlaylist(step) {
  const pl = state.playlist;
  if (!pl || !pl.ids.length) return;
  pl.index = (pl.index + step + pl.ids.length) % pl.ids.length;
  const entry = store.loadAll().find((e) => e.id === pl.ids[pl.index]);
  if (!entry) {
    // A loop was deleted out from under the album; drop it and carry on.
    pl.ids.splice(pl.index, 1);
    if (!pl.ids.length) { state.playlist = null; return; }
    pl.index %= pl.ids.length;
    advancePlaylist(0);
    return;
  }
  loadSpec(cloneSpec(entry.spec), { id: entry.id, pushToHistory: false });
  if (!state.engine.playing) togglePlay();
  ui.toast(`${pl.title} · ${pl.index + 1}/${pl.ids.length}`);
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
  // Making something new is leaving the album.
  state.playlist = null;
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
  // Saves predating the mutes field would otherwise throw here.
  if (!state.spec.mutes) {
    state.spec.mutes = { drums: false, bass: false, chords: false, melody: false, texture: false };
  }
  state.spec.mutes[layer] = !state.spec.mutes[layer];
  state.synth.setMute(layer, state.spec.mutes[layer]);
  ui.renderGrids(cells, state.engine.live || state.pattern, Math.max(0, state.bar), state.spec.mutes);
}

function saveCurrent() {
  if (!state.spec) return;
  const entry = store.save(state.spec);
  if (!entry) {
    ui.toast('Could not save - this browser is refusing to store data');
    return;
  }
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
  ui.el('trackLen').addEventListener('input', (e) => {
    const passes = TRACK_LENGTHS[parseInt(e.target.value, 10)] || 0;
    if (state.spec) state.spec.playFor = passes || null;
    if (state.engine) state.engine.loopCount = 0;
    ui.el('lenVal').textContent = describeLength(passes, state.spec);
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
    lines.push(`build: ${BUILD}`);
    lines.push(`ua: ${navigator.userAgent}`);
    lines.push(`standalone: ${window.matchMedia('(display-mode: standalone)').matches}`);
    // Registration failures are swallowed so they cannot break the app, which
    // means a dead service worker -- no offline mode -- is otherwise invisible.
    lines.push(`sw: ${swState}`);
    lines.push(`cores: ${navigator.hardwareConcurrency || '?'}  lite: ${state.lite}`);
    // One loop in thirty is a deliberate doubling (roadmap item 12), and
    // "is this one of them?" is otherwise only answerable by ear, which is
    // no use at all when the question is whether it fired.
    lines.push(`choir: ${state.spec && choirOf(state.spec) ? 'yes' : 'no'}`);
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

  ui.el('copySong').addEventListener('click', async () => {
    if (!state.spec) return;
    try {
      await offerCode(share.encodeSong(state.spec), state.spec.name);
    } catch (err) {
      console.warn('Could not build a code', err);
      ui.toast('Could not build a code for this loop');
    }
  });

  ui.el('pasteCode').addEventListener('click', async () => {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = '';
    }
    if (!share.codeKind(text)) {
      text = prompt('Paste a Driftloom code') || '';
    }
    const kind = share.codeKind(text);
    if (!kind) {
      if (text.trim()) ui.toast('That does not look like a Driftloom code');
      return;
    }
    try {
      if (kind === 'song') {
        const spec = share.decodeSong(text);
        const ids = store.addSpecs([spec]);
        refreshSaved();
        loadSpec(spec, { id: ids ? ids[0] : null });
        if (!state.engine.playing) togglePlay();
        ui.toast(ids ? `Added ${spec.name}` : `Playing ${spec.name} (could not save it)`);
      } else {
        const { title, specs } = share.decodeAlbum(text);
        const ids = store.addSpecs(specs);
        if (!ids) {
          ui.toast('Could not save those loops');
          return;
        }
        const album = store.createAlbum(title);
        if (album) store.setAlbumIds(album.id, ids);
        refreshSaved();
        refreshAlbums();
        ui.toast(`Added ${title} · ${specs.length} loops`);
      }
    } catch (err) {
      ui.toast(err.message || 'That code could not be read');
    }
  });

  ui.el('newAlbum').addEventListener('click', () => {
    const title = prompt('Name this album', 'Untitled');
    if (!title) return;
    if (!store.createAlbum(title.trim())) {
      ui.toast('Could not create the album');
      return;
    }
    refreshAlbums();
    ui.toast(`Created ${title.trim()}`);
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
      const res = store.importAll(text);
      refreshSaved();
      if (res.failed) ui.toast('Could not save the restored loops');
      else if (res.added) ui.toast(`Restored ${res.added} loops${res.rejected ? `, skipped ${res.rejected}` : ''}`);
      else ui.toast(res.rejected ? `Skipped ${res.rejected} unreadable loops` : 'Nothing new in that backup');
    } catch {
      ui.toast('That does not look like a Driftloom backup');
    }
  });
  ui.el('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const res = store.importAll(await file.text());
      refreshSaved();
      if (res.failed) ui.toast('Could not save the restored loops');
      else if (res.added) ui.toast(`Restored ${res.added} loops${res.rejected ? `, skipped ${res.rejected}` : ''}`);
      else ui.toast(res.rejected ? `Skipped ${res.rejected} unreadable loops` : 'Nothing new in that file');
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
  drawCoverFor(state.spec);
  refreshAlbums();
  resetHistory(state.spec);
  ui.renderReadout(state.spec, { meta: { kit: 'none' } });
  syncToneInputs(state.spec);
  refreshSaved();
  updateHistoryButtons();
}

wire();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  swState = 'registering';
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const track = () => {
      const w = reg.installing || reg.waiting || reg.active;
      swState = w ? w.state : 'registered';
    };
    track();
    reg.addEventListener('updatefound', track);
  }).catch((err) => { swState = `failed: ${err && err.message ? err.message : err}`; });
}