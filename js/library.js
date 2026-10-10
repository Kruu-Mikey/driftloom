// The Library and Save viewports.
//
// Library: albums (Favorite Loops and Imported Loops built in, first), every
// loop, and More (backups, the processor switch, diagnostics). Save: which
// albums the playing loop is in, and sharing and exporting.
//
// A saved loop always lives in at least one album, so saving a loop IS
// ticking an album, and taking it out of its last album deletes it
// (storage.js has the rules).
//
// Lists come in pages rather than scrolling, so the screen never moves under
// your thumb. A page holds as many fixed-height rows as fit the viewport on
// this phone, and a swipe or the arrows turn it.
//
// Opening an album turns the card over to show the album; leaving the album
// turns it back to whatever is playing.

import { drawCover, albumCoverSpec } from './cover.js';
import { NOTE_NAMES, SCALES } from './theory.js';
import * as store from './storage.js';
import * as ui from './ui.js';

const el = ui.el;

const lib = {
  app: null,
  tab: 'albums',
  albumId: null,
  mode: null,          // within an album: null (tracks), 'pick' or 'move'
  moving: null,        // the loop being moved
  saveTab: 'albums',
  pages: {},           // remembered page per list
  armed: null,         // { key, until }: a destructive tap waiting for its second
};

// ---------------------------------------------------------------- setup

export function initLibrary(app) {
  lib.app = app;
  for (const b of document.querySelectorAll('[data-tab]')) {
    b.addEventListener('click', () => setTab(b.dataset.tab));
  }
  for (const b of document.querySelectorAll('[data-stab]')) {
    b.innerHTML = ui.icon(b.dataset.stab === 'share' ? 'share' : 'bookmark');
    b.addEventListener('click', () => { lib.saveTab = b.dataset.stab; renderSave(); });
  }
  for (const pg of [LIB_PAGER, SAVE_PAGER]) {
    ui.setIcon(el(pg.prev), 'left');
    ui.setIcon(el(pg.next), 'right');
    el(pg.prev).addEventListener('click', () => turn(pg, -1));
    el(pg.next).addEventListener('click', () => turn(pg, 1));
    swipe(el(pg.list), (step) => turn(pg, step));
  }
  // Rows per page depend on the viewport's height, which changes with the
  // window (and with the phone's keyboard).
  window.addEventListener('resize', refresh);
}

// A sideways swipe on a list turns the page, the way any paged thing on a
// phone does. Mostly-vertical drags are left alone.
function swipe(node, onTurn) {
  let x0 = null;
  let y0 = 0;
  node.addEventListener('touchstart', (e) => {
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
  }, { passive: true });
  node.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) onTurn(dx < 0 ? 1 : -1);
  }, { passive: true });
}

export function isVisible() {
  return !el('viewLibrary').hidden;
}

function saveVisible() {
  return !el('viewSave').hidden;
}

// The album the card should show, or null for the playing loop.
export function shownAlbum() {
  return isVisible() && lib.tab === 'albums' ? lib.albumId : null;
}

export function setTab(tab) {
  // Tapping Albums while inside an album goes back up to the list; coming
  // to it from another tab returns to the album you were in.
  if (tab === 'albums' && lib.tab === 'albums') {
    lib.albumId = null;
    lib.mode = null;
  }
  lib.tab = tab;
  render();
  lib.app.cardChanged();
}

export function openAlbum(id) {
  lib.tab = 'albums';
  lib.albumId = id;
  lib.mode = null;
  render();
  lib.app.cardChanged();
}

export function closeAlbum() {
  lib.albumId = null;
  lib.mode = null;
  render();
  lib.app.cardChanged();
}

// Called whenever something the lists show may have changed. Cheap when
// neither view is on screen: it does nothing.
export function refresh() {
  if (isVisible()) render();
  if (saveVisible()) renderSave();
}

export function showShare() {
  lib.saveTab = 'share';
  renderSave();
}

// --------------------------------------------------------------- paging

const LIB_PAGER = { list: 'libList', pager: 'pager', label: 'pgLabel', prev: 'pgPrev', next: 'pgNext', key: () => libKey(), render: () => render() };
const SAVE_PAGER = { list: 'saveList', pager: 'savePager', label: 'spLabel', prev: 'spPrev', next: 'spNext', key: () => 'save', render: () => renderSave() };

function libKey() {
  if (lib.tab === 'albums' && lib.albumId) return `${lib.mode || 'album'}:${lib.albumId}`;
  return lib.tab;
}

function turn(pg, step) {
  const key = pg.key();
  lib.pages[key] = (lib.pages[key] || 0) + step;
  pg.render();
}

function rowHeight() {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h'));
  return v > 0 ? v : 52;
}

// Fill a list with one page of rows. `current` is the index to open on the
// first time this list is shown, so the loop that is playing is on the page
// you land on.
function paged(pg, items, makeRow, emptyText, current = -1) {
  const list = el(pg.list);
  list.innerHTML = '';
  const pager = el(pg.pager);
  if (!items.length) {
    pager.hidden = true;
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = emptyText;
    list.appendChild(p);
    return;
  }
  // Measure with the pager in place, since it takes height from the list
  // whenever there is more than one page.
  pager.hidden = false;
  let per = Math.max(1, Math.floor(list.clientHeight / rowHeight()));
  if (items.length <= per + 1) {
    pager.hidden = true;
    const all = Math.max(1, Math.floor(list.clientHeight / rowHeight()));
    if (items.length <= all) per = all;
    else pager.hidden = false;
  }
  const pages = Math.ceil(items.length / per);
  const key = pg.key();
  if (lib.pages[key] == null && current >= 0) lib.pages[key] = Math.floor(current / per);
  const page = Math.min(Math.max(lib.pages[key] || 0, 0), pages - 1);
  lib.pages[key] = page;
  el(pg.label).textContent = `${page + 1} / ${pages}`;
  el(pg.prev).disabled = page === 0;
  el(pg.next).disabled = page === pages - 1;
  items.slice(page * per, page * per + per).forEach((item, i) => {
    list.appendChild(makeRow(item, page * per + i));
  });
}

// --------------------------------------------------------------- pieces

function row(title, meta, onOpen, { art = null, current = false } = {}) {
  const r = document.createElement('div');
  r.className = 'lrow' + (current ? ' current' : '');
  const main = document.createElement('button');
  main.className = 'lrow-main';
  if (art) main.appendChild(art);
  const text = document.createElement('span');
  text.className = 'lrow-text';
  const t = document.createElement('span');
  t.className = 'lrow-title';
  t.textContent = title;
  const m = document.createElement('span');
  m.className = 'lrow-meta';
  m.textContent = meta;
  text.append(t, m);
  main.appendChild(text);
  main.addEventListener('click', onOpen);
  r.appendChild(main);
  return r;
}

function tiny(label, onClick, title = '') {
  const b = document.createElement('button');
  b.className = 'ghost tiny';
  b.textContent = label;
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function ghost(label, onClick) {
  const b = document.createElement('button');
  b.className = 'ghost';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

// Destructive taps ask twice. The first arms `key` (and the caller shows
// what will happen); a second tap on the same thing within a few seconds
// returns true. Survives re-renders, since rows are rebuilt on every change.
function armed(key) {
  const now = Date.now();
  if (lib.armed && lib.armed.key === key && lib.armed.until > now) {
    lib.armed = null;
    return true;
  }
  lib.armed = { key, until: now + 3500 };
  setTimeout(() => {
    if (lib.armed && lib.armed.key === key && lib.armed.until <= Date.now()) {
      lib.armed = null;
      refresh();
    }
  }, 3600);
  return false;
}

function isArmed(key) {
  return !!lib.armed && lib.armed.key === key && lib.armed.until > Date.now();
}

function confirmTiny(key, label, armedLabel, onConfirm) {
  const b = tiny(isArmed(key) ? armedLabel : label, () => {
    if (armed(key)) onConfirm();
    else refresh();
  });
  if (isArmed(key)) b.classList.add('confirm');
  return b;
}

function mark(on, warn = false) {
  const m = document.createElement('span');
  m.className = 'pick' + (warn ? ' warn' : '');
  m.innerHTML = ui.icon(warn ? 'close' : on ? 'check' : 'plus');
  return m;
}

// Album art is drawn once per album contents and copied after that, so
// paging through albums does not redraw noise fields on every turn.
const artCache = new Map();
export function albumArt(album, specs, size = 96) {
  const key = `${album.title}|${album.ids.join(',')}|${size}`;
  let src = artCache.get(key);
  if (!src) {
    src = document.createElement('canvas');
    try {
      drawCover(src, albumCoverSpec(album.title, specs.length ? specs : [
        { seed: 1, feel: { lift: 0.5, energy: 0.3, warmth: 0.6 }, mix: { dust: 1 } },
      ]), size);
    } catch (err) {
      console.warn('Could not draw album art', err);
    }
    if (artCache.size > 40) artCache.clear();
    artCache.set(key, src);
  }
  return src;
}

function artFor(album, byId) {
  const specs = album.ids.map((id) => byId.get(id)).filter(Boolean).map((e) => e.spec);
  const art = document.createElement('canvas');
  art.className = 'album-art';
  art.width = 96;
  art.height = 96;
  art.getContext('2d').drawImage(albumArt(album, specs), 0, 0, 96, 96);
  return art;
}

function loopsById() {
  return new Map(store.loadAll().map((e) => [e.id, e]));
}

function keyOf(spec) {
  return `${NOTE_NAMES[spec.root]} ${SCALES[spec.scale].label} · ${spec.bpm} bpm`;
}

function count(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// Albums worth listing: Imported Loops only when it has something in it.
function listedAlbums(alsoShow = null) {
  return store.loadAlbums().filter((a) => a.id !== store.IMPORTED || a.ids.length || a.id === alsoShow);
}

function newAlbumThen(after) {
  const title = prompt('Name this album', 'Untitled');
  if (!title || !title.trim()) return;
  const album = store.createAlbum(title.trim().slice(0, store.NAME_MAX));
  if (!album) { ui.toast('Could not create the album'); return; }
  after(album);
}

// ------------------------------------------------------------- library

export function render() {
  for (const b of document.querySelectorAll('[data-tab]')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === lib.tab));
  }
  const more = lib.tab === 'more';
  el('libMore').hidden = !more;
  el('libPages').hidden = more;
  if (more) {
    el('pager').hidden = true;
    return;
  }
  el('libHead').innerHTML = '';
  el('libFoot').innerHTML = '';
  if (lib.tab === 'albums') {
    const album = lib.albumId && store.loadAlbums().find((a) => a.id === lib.albumId);
    if (lib.albumId && !album) { lib.albumId = null; lib.mode = null; }
    if (!album) renderAlbums();
    else if (lib.mode === 'pick') renderPicker(album);
    else if (lib.mode === 'move' && lib.moving) renderMove(album);
    else renderAlbum(album);
  } else {
    renderLoops();
  }
}

function backTo(label, onBack) {
  const back = document.createElement('button');
  back.className = 'back';
  back.innerHTML = `${ui.icon('left')}<span></span>`;
  back.querySelector('span').textContent = label;
  back.addEventListener('click', onBack);
  el('libHead').appendChild(back);
}

function renderAlbums() {
  el('libFoot').append(
    ghost('New album', () => newAlbumThen((a) => { ui.toast(`Created ${a.title}`); render(); })),
    ghost('Paste a code', () => lib.app.pasteCode()),
  );
  const byId = loopsById();
  const playing = lib.app.state.playlist;
  paged(LIB_PAGER, listedAlbums(), (album) => {
    const n = album.ids.filter((id) => byId.has(id)).length;
    const isPlaying = playing && playing.albumId === album.id;
    const meta = count(n, 'loop') + (isPlaying ? ` · playing ${playing.index + 1}/${playing.ids.length}` : '');
    const r = row(album.title, meta, () => openAlbum(album.id), { art: artFor(album, byId), current: isPlaying });
    const play = document.createElement('button');
    play.className = 'ghost tiny';
    play.setAttribute('aria-label', `Play ${album.title}`);
    play.innerHTML = ui.icon('play');
    play.addEventListener('click', () => lib.app.playAlbum(album.id, 0));
    r.appendChild(play);
    return r;
  }, 'No albums yet.');
}

function renderAlbum(album) {
  backTo('Albums', closeAlbum);
  const byId = loopsById();
  const present = album.ids.filter((id) => byId.has(id));
  const playing = lib.app.state.playlist;
  const here = playing && playing.albumId === album.id;

  const foot = el('libFoot');
  foot.append(
    // While this album is playing the same button takes you out of it, so
    // Next goes back to making new loops.
    here ? ghost('Stop album', () => lib.app.leaveAlbum())
      : ghost('Play', () => lib.app.playAlbum(album.id, 0)),
    ghost('Add loops', () => { lib.mode = 'pick'; render(); }),
    ghost('Share', () => lib.app.shareAlbum(album.id)),
  );
  if (!store.isBuiltin(album.id)) {
    const key = `del-album:${album.id}`;
    const going = store.onlyHere(album.id).length;
    const b = ghost(isArmed(key)
      ? (going ? `Delete it and ${count(going, 'loop')}?` : 'Delete album?')
      : 'Delete', () => {
      if (!armed(key)) { render(); return; }
      const pl = lib.app.state.playlist;
      if (pl && pl.albumId === album.id) lib.app.state.playlist = null;
      store.removeAlbum(album.id);
      ui.toast('Album deleted');
      lib.app.savedChanged();
      closeAlbum();
    });
    if (isArmed(key)) b.classList.add('confirm');
    foot.append(b);
  }

  paged(LIB_PAGER, present, (id, i) => {
    const spec = byId.get(id).spec;
    const isCurrent = here && playing.index === i;
    const r = row(`${i + 1}. ${spec.name}`, keyOf(spec), () => lib.app.playAlbum(album.id, i),
      { current: isCurrent });
    r.appendChild(tiny('move', () => {
      lib.mode = 'move';
      lib.moving = id;
      render();
    }, 'Move to another album'));
    const last = store.albumsOf(id).length <= 1;
    r.appendChild(confirmTiny(`rm:${album.id}:${id}`, 'remove', last ? 'delete?' : 'sure?', () => {
      const res = store.removeFromAlbum(album.id, id);
      if (!res.ok) { ui.toast('Could not change that album'); return; }
      if (res.deleted && lib.app.state.currentId === id) lib.app.state.currentId = null;
      ui.toast(res.deleted ? `Deleted ${spec.name}` : 'Removed from album');
      lib.app.savedChanged();
      lib.app.cardChanged();
    }));
    return r;
  }, 'Nothing in here yet. Tap Add loops to pick from your loops.',
  here ? playing.index : -1);
}

// Move one track: tap the album it should go to.
function renderMove(album) {
  const byId = loopsById();
  const entry = byId.get(lib.moving);
  if (!entry) { lib.mode = null; render(); return; }
  const done = () => { lib.mode = null; lib.moving = null; render(); };
  backTo(`Move ${entry.spec.name} to…`, done);
  const go = (target) => {
    if (!store.moveToAlbum(entry.id, album.id, target.id)) { ui.toast('Could not move it'); return; }
    ui.toast(`Moved to ${target.title}`);
    lib.app.savedChanged();
    lib.app.cardChanged();
    done();
  };
  el('libFoot').append(
    ghost('New album', () => newAlbumThen(go)),
    ghost('Cancel', done),
  );
  // Imported Loops is where codes land, not somewhere to file things.
  const targets = store.loadAlbums().filter((a) => a.id !== album.id && a.id !== store.IMPORTED);
  paged(LIB_PAGER, targets, (target) => {
    const has = target.ids.includes(entry.id);
    const r = row(target.title, has ? 'already has it' : count(target.ids.length, 'loop'),
      () => go(target), { art: artFor(target, byId) });
    return r;
  }, 'No other albums yet. Make one with New album.');
}

// Pick loops into the album without playing them: tap a row to put it in,
// tap again to take it out (twice, if that would delete it).
function renderPicker(album) {
  const done = () => { lib.mode = null; render(); };
  backTo(album.title, done);
  const s = lib.app.state.spec;
  if (s && !lib.app.isSaved()) {
    el('libFoot').append(ghost(`Add playing: ${s.name}`, () => {
      lib.app.saveIn(album.id);
      render();
    }));
  }
  el('libFoot').append(ghost('Done', done));

  const loops = store.loadAll();
  paged(LIB_PAGER, loops, (entry) => {
    const fresh = store.loadAlbums().find((a) => a.id === album.id) || album;
    const inAlbum = fresh.ids.includes(entry.id);
    const last = inAlbum && store.albumsOf(entry.id).length <= 1;
    const key = `pick:${album.id}:${entry.id}`;
    const warn = last && isArmed(key);
    const r = row(entry.spec.name, warn ? 'only here: tap again to delete' : keyOf(entry.spec), () => {
      if (!inAlbum) {
        store.addToAlbum(album.id, entry.id);
      } else if (last && !armed(key)) {
        render();
        return;
      } else {
        const res = store.removeFromAlbum(album.id, entry.id);
        if (res.deleted) {
          if (lib.app.state.currentId === entry.id) lib.app.state.currentId = null;
          ui.toast(`Deleted ${entry.spec.name}`);
        }
      }
      lib.app.savedChanged();
      lib.app.cardChanged();
    }, { current: entry.id === lib.app.state.currentId });
    if (inAlbum) r.classList.add('in');
    r.querySelector('.lrow-main').appendChild(mark(inAlbum, warn));
    return r;
  }, 'No loops yet. Save one you like and it will show up here.');
}

// Every loop, wherever it lives. Tap to play; changes happen in albums.
function renderLoops() {
  const loops = store.loadAll();
  const albums = store.loadAlbums();
  const currentId = lib.app.state.currentId;
  const current = loops.findIndex((e) => e.id === currentId);
  paged(LIB_PAGER, loops, (entry) => {
    const homes = albums.filter((a) => a.ids.includes(entry.id));
    const where = homes.length ? homes[0].title + (homes.length > 1 ? ` +${homes.length - 1}` : '') : '';
    return row(entry.spec.name, `${keyOf(entry.spec)} · ${where}`, () => lib.app.openSaved(entry),
      { current: entry.id === currentId });
  }, 'No loops yet. Save one you like and it will show up here.', current);
}

// ----------------------------------------------------------------- save

export function renderSave() {
  for (const b of document.querySelectorAll('[data-stab]')) {
    b.setAttribute('aria-selected', String(b.dataset.stab === lib.saveTab));
  }
  const share = lib.saveTab === 'share';
  el('saveShare').hidden = !share;
  el('savePages').hidden = share;
  if (share) {
    el('savePager').hidden = true;
    return;
  }
  const head = el('saveHead');
  const foot = el('saveFoot');
  head.innerHTML = '';
  foot.innerHTML = '';
  const app = lib.app;
  const spec = app.state.spec;
  if (!spec) return;
  const kept = app.isSaved();
  const id = kept ? app.state.currentId : null;

  // A saved loop that has been re-rolled or tweaked since: say so, and offer
  // both ways forward rather than guessing.
  if (kept && app.isChanged()) {
    const homes = store.albumsOf(id).length;
    const p = document.createElement('p');
    p.className = 'save-note';
    p.textContent = 'Changed since you saved it.';
    head.append(p,
      ghost(homes > 1 ? `Update in ${homes} albums` : 'Update it', () => app.updateSaved()),
      ghost('Save as new', () => app.saveAsNew()));
    head.classList.add('changed');
  } else {
    head.classList.remove('changed');
    if (!kept) {
      const p = document.createElement('p');
      p.className = 'save-note';
      p.textContent = `Tap an album to save ${spec.name} to it.`;
      head.append(p);
    }
  }

  foot.append(ghost('New album', () => newAlbumThen((a) => {
    app.saveIn(a.id);
    ui.toast(`Saved to ${a.title}`);
  })));

  const byId = loopsById();
  const albums = listedAlbums(store.IMPORTED);
  const shown = albums.filter((a) => a.id !== store.IMPORTED || (id && a.ids.includes(id)));
  paged(SAVE_PAGER, shown, (album) => {
    const inAlbum = !!id && album.ids.includes(id);
    const last = inAlbum && store.albumsOf(id).length <= 1;
    const key = `save:${album.id}:${id}`;
    const warn = last && isArmed(key);
    const meta = warn ? 'only album: tap again to delete' : count(album.ids.filter((x) => byId.has(x)).length, 'loop');
    const r = row(album.title, meta, () => {
      if (!inAlbum) { app.saveIn(album.id); return; }
      if (last && !armed(key)) { renderSave(); return; }
      app.unsaveFrom(album.id);
    }, { art: artFor(album, byId) });
    if (inAlbum) r.classList.add('in');
    r.querySelector('.lrow-main').appendChild(mark(inAlbum, warn));
    return r;
  }, 'No albums.');
}
