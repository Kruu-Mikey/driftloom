import { newSpec, rerollLayer, cloneSpec, render, choirOf, LAYERS, STEPS_PER_BAR } from './generator.js';
import { Synth } from './synth.js';
import { ENGINE, loadCore, fetchCore } from './core.js';
import { Engine } from './engine.js';
import { patternToMidi } from './midi.js';
import { MediaBridge } from './media.js';
import * as share from './share.js';

// Build stamp. Shown in Diagnostics so that after a deploy you can confirm
// in one glance which version you are actually running, rather than
// guessing whether a change landed. Bump it with CACHE in sw.js.
const BUILD = 'v82';

// Reported in Diagnostics. Declared here rather than beside the registration
// at the foot of the file so it is initialised before anything can read it.
let swState = 'unsupported';
// Track length is chosen as a time, which is how anyone thinks of it, and
// stored as passes (a track ends on a whole loop), worked out at this tempo
// when the slider moves. The stops are curated: fine at the short end, where
// people actually set it, and reaching a whole day at the top.
const TRACK_TIMES = [
  0, 60, 120, 180, 300, 600, 900, 1200, 1800, 2700,
  3600, 5400, 7200, 10800, 14400, 21600, 28800, 43200, 86400,
];
import { drawCover } from './cover.js';
import * as store from './storage.js';
import * as ui from './ui.js';
import * as library from './library.js';

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
  // Which viewport is up ('now', 'sounds', 'layers', 'library' or 'save');
  // the last of the first three, where leaving Library or Save goes back
  // to; and the last of Sound and Layers, which the switch offers.
  view: 'now',
  lastView: 'now',
  lastEdit: 'layers',
  // The album most recently left, so Now Playing can offer the way back.
  lastAlbum: null,
  // Now Playing's last audible position, in steps, held while paused.
  nowSteps: 0,
  // The spec the cover was last drawn for, so the card is not redrawn when
  // only its words change.
  coverFor: null,
  passCount: 0,
  frameHandle: null,
  lite: false,
  media: null,
  // The Rust core for this context, once loaded (`?engine=rust`, js/core.js).
  core: null,
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
  // The core arrives a moment after the context. Until then the synth plays
  // its voices in JS, and counts them; a later synth (the quality toggle)
  // takes it from the start.
  if (ENGINE === 'rust') {
    const ctx = state.ctx;
    loadCore(ctx).then((core) => {
      if (state.ctx !== ctx) return;
      state.core = core;
      if (state.synth) state.synth.attachCore(core);
    }).catch((err) => {
      console.warn('Rust core unavailable; playing in JS', err);
    });
  }
}

function buildAudio() {
  const wasPlaying = state.engine ? state.engine.playing : false;
  if (state.engine) state.engine.stop();
  // Tear the previous graph down before replacing it, or each rebuild
  // leaves a whole synth wired to the speakers and another keepalive
  // element in the DOM.
  if (state.media) state.media.dispose();
  if (state.synth) state.synth.dispose();
  state.synth = new Synth(state.ctx, state.lite ? 'lite' : 'full', { engine: ENGINE, core: state.core });
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
  const wander = parseFloat(ui.el('driftAmount').value);
  state.engine.driftOn = wander > 0;
  state.engine.driftAmount = wander > 0 ? wander : 1;
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
  state.passCount = 0;
  if (!keepPosition) state.nowSteps = 0;
  ui.renderGrids(cells, state.pattern, 0, spec.mutes);
  syncToneInputs(spec);
  refreshCard();
  savedChanged();
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
// The time a length actually comes to (whole passes at this tempo), kept
// short: it sits beside the slider and must not change width much.
function describeLength(passes, spec) {
  if (!passes) return 'off';
  if (!spec) return `${passes}×`;
  return ui.formatTime(passes * ui.passSeconds(spec));
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

// ---------------------------------------------------------------- card

// The card shows the album open in the library, or else the loop that is
// playing. Everything that changes either one ends up here.
function refreshCard() {
  const albumId = library.shownAlbum();
  const album = albumId && store.loadAlbums().find((a) => a.id === albumId);
  const playhead = ui.el('playhead');
  if (album) {
    const byId = new Map(store.loadAll().map((e) => [e.id, e]));
    const specs = album.ids.map((id) => byId.get(id)).filter(Boolean).map((e) => e.spec);
    const canvas = ui.el('cover');
    const ctx = canvas.getContext('2d');
    canvas.width = 320;
    canvas.height = 320;
    ctx.drawImage(library.albumArt(album, specs, 320), 0, 0, 320, 320);
    state.coverFor = null;
    const pl = state.playlist;
    const playing = pl && pl.albumId === album.id
      ? `playing ${pl.index + 1}/${pl.ids.length}` : '';
    ui.renderAlbumCard(album.title, specs, { playing });
    // Hidden rather than removed, so the card keeps its height and the
    // viewport below does not jump.
    playhead.style.visibility = 'hidden';
    return;
  }
  playhead.style.visibility = '';
  if (!state.spec) return;
  if (state.coverFor !== state.spec) {
    drawCoverFor(state.spec);
    state.coverFor = state.spec;
  }
  renderLoopWords();
}

// Time left and album position live in Now Playing; the card keeps only
// which album is playing, as a reminder of where Next goes.
function renderLoopWords() {
  const pl = state.playlist;
  ui.renderReadout(state.spec, state.pattern, {
    album: pl && pl.ids.length ? `${pl.title} ${pl.index + 1}/${pl.ids.length}` : '',
  });
}

// Anything saved, deleted or renamed: the lists, and whether the loop on
// screen counts as saved.
function savedChanged() {
  library.refresh();
  updateSaveButton();
  if (state.view === 'now') renderNow();
}

// ------------------------------------------------------------------ save

// A saved loop lives in at least one album; saving is putting it in one.
function isSaved() {
  return !!state.currentId && store.loadAll().some((e) => e.id === state.currentId);
}

function isChanged() {
  if (!isSaved() || !state.spec) return false;
  const stored = store.loadAll().find((e) => e.id === state.currentId);
  return !!stored && !store.sameSpec(stored.spec, state.spec);
}

// Save the playing loop to an album, saving it first if it is not saved
// anywhere yet.
function saveIn(albumId) {
  if (!state.spec) return;
  if (!isSaved()) {
    const entry = store.save(state.spec);
    if (!entry) { ui.toast('Could not save it - this browser is refusing to store data'); return; }
    state.currentId = entry.id;
  }
  if (!store.addToAlbum(albumId, state.currentId)) { ui.toast('Could not change that album'); return; }
  const album = store.loadAlbums().find((a) => a.id === albumId);
  ui.toast(`Saved to ${album ? album.title : 'the album'}`);
  savedChanged();
  refreshCard();
}

function unsaveFrom(albumId) {
  if (!isSaved()) return;
  const name = state.spec.name;
  const res = store.removeFromAlbum(albumId, state.currentId);
  if (!res.ok) { ui.toast('Could not change that album'); return; }
  if (res.deleted) {
    state.currentId = null;
    ui.toast(`Deleted ${name}`);
  } else {
    ui.toast('Taken out of that album');
  }
  savedChanged();
  refreshCard();
}

function updateSaved() {
  if (!isSaved()) return;
  if (!store.replaceSpec(state.currentId, state.spec)) {
    ui.toast('Could not save - this browser is refusing to store data');
    return;
  }
  ui.toast(`Updated ${state.spec.name}`);
  savedChanged();
}

// The changed loop becomes a loop of its own, in Favorite Loops; the one it
// came from stays as it was.
function saveAsNew() {
  if (!state.spec) return;
  const entry = store.save(state.spec);
  if (!entry) { ui.toast('Could not save - this browser is refusing to store data'); return; }
  state.currentId = entry.id;
  store.addToAlbum(store.FAVORITES, entry.id);
  ui.toast(`Saved ${state.spec.name} as a new loop in Favorite Loops`);
  savedChanged();
}

// S on a keyboard: save to Favorite Loops, or save the changes to a saved loop.
function saveQuick() {
  if (!state.spec) return;
  if (!isSaved()) saveIn(store.FAVORITES);
  else if (isChanged()) updateSaved();
  else ui.toast(`${state.spec.name} is saved`);
}

// The bookmark is filled once the loop lives in an album, and becomes an
// outline with a dot when the saved loop has been changed since.
function updateSaveButton() {
  const kept = isSaved();
  const b = ui.el('saveBtn');
  ui.setIcon(b, kept ? (isChanged() ? 'savedChanged' : 'saved') : 'save');
  b.classList.toggle('saved', kept);
  b.setAttribute('aria-label', kept ? 'Saved: albums and sharing' : 'Save and share');
}

// ------------------------------------------------------------ viewport

// Now Playing, Sound and Layers are where you stay; Library and Save are
// places you visit, whose buttons light while you are there. Pressing a lit
// button again (or the switch) goes back to where you were.
const BASE_VIEWS = ['now', 'sounds', 'layers'];

function setView(view) {
  state.view = view;
  const visiting = !BASE_VIEWS.includes(view);
  if (!visiting) state.lastView = view;
  if (view === 'sounds' || view === 'layers') state.lastEdit = view;
  for (const v of document.querySelectorAll('.view')) v.hidden = v.dataset.view !== view;
  ui.el('libraryBtn').setAttribute('aria-pressed', String(view === 'library'));
  ui.el('saveBtn').setAttribute('aria-pressed', String(view === 'save'));
  ui.el('nowBtn').setAttribute('aria-pressed', String(view === 'now'));
  // The switch shows where it goes, not where you are: from Sound it offers
  // Layers, from Layers it offers Sound, and from anywhere else it offers
  // whichever of the two you used last.
  const target = view === 'sounds' ? 'layers' : view === 'layers' ? 'sounds' : state.lastEdit;
  const vb = ui.el('viewBtn');
  ui.setIcon(vb, target);
  vb.setAttribute('aria-label', target === 'sounds' ? 'Show sound controls' : 'Show layers');
  vb.title = target === 'sounds' ? 'Sound' : 'Layers';
  if (view === 'library') library.render();
  if (view === 'save') library.renderSave();
  if (view === 'now') renderNow();
  refreshCard();
  store.setPrefs({ view: state.lastView, edit: state.lastEdit });
}

// ----------------------------------------------------------- now playing

// Big and plain: how long is left (or that it is endless), how far through,
// where in an album, and what Next will do. The one control sits at the
// bottom of the view, a thumb's reach from the buttons.
function renderNow() {
  if (state.view !== 'now' || !state.spec) return;
  updateNowClock();

  const pl = state.playlist;
  const albumRow = ui.el('nowAlbum');
  albumRow.hidden = !(pl && pl.ids.length);
  if (pl && pl.ids.length) {
    ui.el('nowAlbumName').textContent = pl.title;
    const n = pl.ids.length;
    ui.el('nowDots').textContent = n <= 12
      ? Array.from({ length: n }, (_, i) => (i === pl.index ? '●' : '○')).join(' ')
      : `${pl.index + 1} of ${n}`;
  }

  ui.el('nowNext').textContent = `Next: ${nextName()}`;

  const action = ui.el('nowAction');
  if (pl && pl.ids.length) {
    action.hidden = false;
    action.textContent = 'Leave album';
    action.onclick = leaveAlbum;
  } else if (state.lastAlbum) {
    const album = store.loadAlbums().find((a) => a.id === state.lastAlbum.albumId);
    action.hidden = !album;
    if (album) {
      action.textContent = `Back to ${album.title}`;
      action.onclick = () => playAlbum(album.id, state.lastAlbum.index);
    }
  } else {
    action.hidden = true;
  }
}

function nextName() {
  const pl = state.playlist;
  if (pl && pl.ids.length) {
    const id = pl.ids[(pl.index + 1) % pl.ids.length];
    const entry = store.loadAll().find((e) => e.id === id);
    return entry ? entry.spec.name : 'the next track';
  }
  if (state.historyIndex < state.history.length - 1) {
    return state.history[state.historyIndex + 1].name;
  }
  return 'something new';
}

// Where the listener is in this track, in steps, read off the audio clock.
// The scheduler's own counters (loopCount, step) run ahead of the sound by
// its lookahead, up to three seconds while the screen is off, so counting
// onLoop calls made the clock jump early at every pass. This takes the
// scheduler's position and walks it back by how far its next step is ahead
// of what is being heard, using the engine's measured output latency.
function audibleSteps() {
  const e = state.engine;
  if (!e || !e.playing || !e.live || !e.spec) return null;
  const heard = state.ctx.currentTime - (e.latency || 0);
  const ahead = (e.nextStepTime - heard) / e.stepDur;
  return Math.max(0, e.loopCount * e.live.totalSteps + e.step - ahead);
}

// The clock and the bar. Called every animation frame while Now Playing is
// up and playing, so the bar glides; the text is only rewritten when the
// second it shows changes. A set length counts down (shown with a minus, as
// players do); an endless loop counts up. Paused, it holds where it was.
function updateNowClock() {
  const e = state.engine;
  const steps = audibleSteps();
  if (steps != null) state.nowSteps = steps;
  const spec = state.spec;
  if (!spec || !e || !e.live) {
    setNowText('0:00');
    ui.el('nowFill').style.transform = 'scaleX(0)';
    return;
  }
  const total = e.live.totalSteps;
  const pos = state.nowSteps || 0;
  let text;
  let frac;
  if (spec.playFor) {
    const end = spec.playFor * total;
    text = `\u2212${clock(Math.max(0, end - pos) * e.stepDur)}`;
    frac = Math.min(1, pos / end);
  } else {
    text = clock(pos * e.stepDur);
    frac = (pos % total) / total;
  }
  setNowText(text);
  ui.el('nowFill').style.transform = `scaleX(${frac.toFixed(4)})`;
}

function setNowText(text) {
  const big = ui.el('nowBig');
  if (big.textContent !== text) big.textContent = text;
}

function clock(secs) {
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}


// --------------------------------------------------------------- rename

// Tap the name on the card to rename whatever the card shows: the loop, or
// the album open in the library. It edits in place rather than in a pop-up.
function startRename() {
  const albumId = library.shownAlbum();
  if (!albumId && !state.spec) return;
  const h = ui.el('loopName');
  const input = ui.el('nameEdit');
  input.value = h.textContent;
  input.style.fontSize = h.style.fontSize;
  h.hidden = true;
  input.hidden = false;
  input.focus();
  input.select();

  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    input.removeEventListener('keydown', onKey);
    input.removeEventListener('blur', onBlur);
    input.hidden = true;
    h.hidden = false;
    const name = input.value.trim().slice(0, store.NAME_MAX);
    if (!commit || !name || name === h.textContent) return;
    if (albumId) {
      if (!store.renameAlbum(albumId, name)) { ui.toast('Could not rename'); return; }
      library.refresh();
      refreshCard();
      return;
    }
    state.spec.name = name;
    if (state.historyIndex >= 0 && state.history[state.historyIndex]) {
      state.history[state.historyIndex].name = name;
    }
    if (state.currentId) store.rename(state.currentId, name);
    refreshCard();
    savedChanged();
    syncMediaMetadata();
  };
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  const onBlur = () => finish(true);
  input.addEventListener('keydown', onKey);
  input.addEventListener('blur', onBlur);
}

// -------------------------------------------------------------- albums

// Out of album mode without stopping the music: Next makes new loops again.
// Out of album mode without stopping the music: Next makes new loops again,
// and Now Playing offers the way back.
function leaveAlbum() {
  const pl = state.playlist;
  if (pl) state.lastAlbum = { albumId: pl.albumId, index: Math.max(0, pl.index) };
  state.playlist = null;
  refreshCard();
  library.refresh();
  renderNow();
  ui.toast('Left the album. Next makes new loops');
}

function playAlbum(albumId, index = 0) {
  const album = store.loadAlbums().find((a) => a.id === albumId);
  if (!album) return;
  const saved = new Set(store.loadAll().map((e) => e.id));
  const present = album.ids.filter((id) => saved.has(id));
  if (!present.length) { ui.toast('That album is empty'); return; }
  state.playlist = { albumId: album.id, title: album.title, ids: present, index: index - 1 };
  advancePlaylist(1);
}

async function shareAlbum(albumId) {
  const album = store.loadAlbums().find((a) => a.id === albumId);
  if (!album) return;
  const byId = new Map(store.loadAll().map((e) => [e.id, e]));
  const specs = album.ids.map((id) => byId.get(id)).filter(Boolean).map((e) => e.spec);
  if (!specs.length) { ui.toast('That album is empty'); return; }
  await offerCode(share.encodeAlbum(album.title, specs), `${album.title} · ${specs.length} loops`);
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
    // The box lives under Save > Share; take them to it.
    setView('save');
    library.showShare();
    ui.toast('Copy it from the box below');
  }
}

function syncToneInputs(spec) {
  ui.el('bpm').value = spec.bpm;
  const len = spec.playFor || 0;
  const secs = len * ui.passSeconds(spec);
  const idx = len ? TRACK_TIMES.reduce((best, v, i) =>
    (i && Math.abs(v - secs) < Math.abs(TRACK_TIMES[best] - secs) ? i : best), 1) : 0;
  ui.el('trackLen').value = idx;
  ui.el('lenVal').textContent = describeLength(len, spec);
  ui.el('warmth').value = spec.tone.warmth;
  ui.el('space').value = spec.tone.space;
  ui.el('wobble').value = spec.tone.wobble;
  ui.el('bpmVal').textContent = spec.bpm;
}

function openSaved(entry) {
  // One unreadable save should not take the app down with it.
  try {
    state.playlist = null;
    resetHistory(cloneSpec(entry.spec));
    loadSpec(cloneSpec(entry.spec), { id: entry.id, pushToHistory: false });
  } catch (err) {
    console.warn('Could not open saved loop', err);
    ui.toast('That saved loop could not be opened');
    return;
  }
  if (!state.engine.playing) togglePlay();
  ui.toast(`Loaded ${entry.spec.name}`);
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
  if (state.view === 'now') updateNowClock();
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
  state.passCount = count;
  if (state.view === 'now') renderNow();
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
    setPlayButton(false);
    ui.moveCursor(lights, cells, -1);
    ui.resetCursor();
  } else {
    state.media.start();
    state.engine.start();
    if (!state.frameHandle) state.frameHandle = requestAnimationFrame(frameLoop);
    syncMediaMetadata();
    state.media.setPlaybackState(true);
    setPlayButton(true);
  }
}

function setPlayButton(playing) {
  renderNow();
  const b = ui.el('playBtn');
  b.setAttribute('aria-pressed', String(playing));
  b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  b.title = playing ? 'Pause' : 'Play';
  ui.setIcon(b, playing ? 'pause' : 'play');
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
  // It keeps its place among the saved loops: Save then offers to update the
  // saved one or save this as a new loop, rather than silently forgetting it.
  loadSpec(next, { keepPosition: true, id: state.currentId, pushToHistory: false });
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

function exportMidi(spec = state.spec) {
  if (!spec) return;
  const blob = patternToMidi(render(spec), { repeats: 4 });
  ui.download(blob, `${spec.name}-${spec.bpm}bpm.mid`);
  ui.toast('MIDI exported');
}

// Paste a song or album code: from the clipboard if the browser allows it,
// otherwise from a box.
async function pasteCode() {
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
      // A loop code lands in Imported Loops, unless this exact loop is saved
      // already, in which case it plays from where it lives.
      const spec = share.decodeSong(text);
      const same = store.findSame(spec);
      state.playlist = null;
      if (same) {
        loadSpec(cloneSpec(same.spec), { id: same.id });
        const home = store.albumsOf(same.id)[0];
        ui.toast(`Already saved${home ? ` in ${home.title}` : ''}`);
      } else {
        const ids = store.addSpecs([spec]);
        if (ids) store.addToAlbum(store.IMPORTED, ids[0]);
        loadSpec(spec, { id: ids ? ids[0] : null });
        ui.toast(ids ? `Added ${spec.name} to Imported Loops` : `Playing ${spec.name} (could not save it)`);
      }
      if (!state.engine.playing) togglePlay();
    } else {
      const { title, specs } = share.decodeAlbum(text);
      const ids = store.addSpecs(specs);
      if (!ids) {
        ui.toast('Could not save those loops');
        return;
      }
      const album = store.createAlbum(title);
      if (album) store.setAlbumIds(album.id, ids);
      savedChanged();
      ui.toast(`Added ${title} · ${specs.length} loops`);
    }
  } catch (err) {
    ui.toast(err.message || 'That code could not be read');
  }
}

// ---------------------------------------------------------------- boot

function wire() {
  lights = ui.buildPlayhead(state.gridSteps);
  cells = ui.buildLayers({ onReroll: reroll, onMute: toggleMute }, state.gridSteps);

  ui.setIcon(ui.el('prevBtn'), 'prev');
  ui.setIcon(ui.el('nextBtn'), 'next');
  ui.setIcon(ui.el('libraryBtn'), 'library');
  ui.setIcon(ui.el('nowBtn'), 'now');
  setPlayButton(false);
  store.ensureAlbums();
  updateSaveButton();

  library.initLibrary({
    state,
    cardChanged: refreshCard,
    savedChanged,
    playAlbum,
    leaveAlbum,
    isSaved,
    isChanged,
    saveIn,
    unsaveFrom,
    updateSaved,
    saveAsNew,
    shareAlbum,
    openSaved,
    pasteCode,
    exportMidi: (spec) => exportMidi(cloneSpec(spec)),
  });

  ui.el('libraryBtn').addEventListener('click', () => {
    setView(state.view === 'library' ? state.lastView : 'library');
  });
  ui.el('saveBtn').addEventListener('click', () => {
    setView(state.view === 'save' ? state.lastView : 'save');
  });
  // Now Playing is home: its button goes there, and from there back to
  // whichever of Sound and Layers you were using.
  ui.el('nowBtn').addEventListener('click', () => {
    setView(state.view === 'now' ? state.lastEdit : 'now');
  });
  ui.el('viewBtn').addEventListener('click', () => {
    if (state.view === 'sounds') setView('layers');
    else if (state.view === 'layers') setView('sounds');
    else setView(state.lastEdit);
  });

  const nameEl = ui.el('loopName');
  nameEl.addEventListener('click', startRename);
  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); startRename(); }
  });

  ui.el('playBtn').addEventListener('click', togglePlay);
  ui.el('exportMidi').addEventListener('click', () => exportMidi());
  ui.el('prevBtn').addEventListener('click', goBack);
  ui.el('nextBtn').addEventListener('click', goForward);

  // One slider for drift: all the way left is off, anywhere else is how far
  // it strays. The label dims at off so the state reads at a glance.
  ui.el('driftAmount').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    const on = v > 0;
    if (state.engine) {
      state.engine.driftOn = on;
      if (on) state.engine.driftAmount = v;
      else if (state.engine.base) state.engine.live = state.engine.base;
    }
    ui.el('wanderRow').classList.toggle('off', !on);
    store.setPrefs(on ? { drift: true, driftAmount: v } : { drift: false });
  });
  ui.el('trackLen').addEventListener('input', (e) => {
    if (!state.spec) return;
    const secs = TRACK_TIMES[parseInt(e.target.value, 10)] || 0;
    const passes = secs ? Math.max(1, Math.round(secs / ui.passSeconds(state.spec))) : 0;
    state.spec.playFor = passes || null;
    if (state.engine) state.engine.loopCount = 0;
    ui.el('lenVal').textContent = describeLength(passes, state.spec);
    state.passCount = 0;
    renderNow();
    updateSaveButton();
  });

  ui.el('bpm').addEventListener('input', (e) => {
    if (!state.spec) return;
    state.spec.bpm = parseInt(e.target.value, 10);
    ui.el('bpmVal').textContent = state.spec.bpm;
    // The same number of passes takes a different time at a new tempo.
    ui.el('lenVal').textContent = describeLength(state.spec.playFor || 0, state.spec);
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
    // Which synth plays the voices the Rust core has: js, or rust with the
    // notes that arrived late and the ones that fell back to JS.
    lines.push(`engine: ${state.synth ? state.synth.engineReport() : ENGINE}`);
    // One loop in thirty is a deliberate doubling (roadmap item 12), and
    // "is this one of them?" is otherwise only answerable by ear, which is
    // no use at all when the question is whether it fired.
    lines.push(`choir: ${state.spec && choirOf(state.spec) ? 'yes' : 'no'}`);
    if (state.media) push(state.media.report());
    else lines.push('media: not built yet (press Play)');
    if (state.engine && state.engine.spec) push(state.engine.report());
    else lines.push('scheduler: not built yet (press Play)');
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

  ui.el('pasteCode').addEventListener('click', pasteCode);

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
      savedChanged();
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
      savedChanged();
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
    else if (e.key === 's') saveQuick();
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
  // Drift was a switch plus an amount; the amount was never kept, so an old
  // "on" comes back at the default distance.
  const wander = prefs.drift === false ? 0 : (prefs.driftAmount ?? 1);
  ui.el('driftAmount').value = wander;
  ui.el('wanderRow').classList.toggle('off', !(wander > 0));
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
  syncToneInputs(state.spec);
  state.lastEdit = prefs.edit === 'sounds' ? 'sounds' : 'layers';
  // Now Playing is where a first visit starts.
  setView(BASE_VIEWS.includes(prefs.view) ? prefs.view : 'now');
  updateHistoryButtons();
  updateSaveButton();

  // The name's size depends on the card's width.
  window.addEventListener('resize', () => ui.fitName());
}

wire();
// Fetched ahead, so the core is ready by the time Play is pressed.
if (ENGINE === 'rust') fetchCore().catch(() => {});

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