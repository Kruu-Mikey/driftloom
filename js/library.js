// The Library viewport: albums, saved loops, and everything else that used
// to sit in panels further down the page (sharing, backups, the processor
// switch, diagnostics), which now lives under More.
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

const lib = {
  tab: 'albums',
  albumId: null,
  pages: {},          // remembered page per list
  app: null,
};

const el = ui.el;

export function initLibrary(app) {
  lib.app = app;
  for (const b of document.querySelectorAll('.lib-tabs button')) {
    b.addEventListener('click', () => setTab(b.dataset.tab));
  }
  ui.setIcon(el('pgPrev'), 'left');
  ui.setIcon(el('pgNext'), 'right');
  el('pgPrev').addEventListener('click', () => turn(-1));
  el('pgNext').addEventListener('click', () => turn(1));

  // A sideways swipe on the list turns the page, the way any paged thing
  // on a phone does. Mostly-vertical drags are left alone.
  let x0 = null;
  let y0 = 0;
  const list = el('libList');
  list.addEventListener('touchstart', (e) => {
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
  }, { passive: true });
  list.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) turn(dx < 0 ? 1 : -1);
  }, { passive: true });

  // Rows per page depend on the viewport's height, which changes with the
  // window (and with the phone's keyboard).
  window.addEventListener('resize', () => { if (isVisible()) render(); });
}

export function isVisible() {
  return !el('viewLibrary').hidden;
}

// The album the card should show, or null for the playing loop.
export function shownAlbum() {
  return isVisible() && lib.tab === 'albums' ? lib.albumId : null;
}

export function setTab(tab) {
  // Tapping Albums while inside an album goes back up to the list; coming
  // to it from another tab returns to the album you were in.
  if (tab === 'albums' && lib.tab === 'albums') lib.albumId = null;
  lib.tab = tab;
  render();
  lib.app.cardChanged();
}

export function openAlbum(id) {
  lib.tab = 'albums';
  lib.albumId = id;
  render();
  lib.app.cardChanged();
}

export function closeAlbum() {
  lib.albumId = null;
  render();
  lib.app.cardChanged();
}

// Called whenever something the lists show may have changed. Cheap when the
// library is not on screen: it does nothing.
export function refresh() {
  if (isVisible()) render();
}

// Shown in the More tab when the clipboard refuses a code.
export function showMore() {
  setTab('more');
}

function turn(step) {
  const key = listKey();
  lib.pages[key] = (lib.pages[key] || 0) + step;
  render();
}

function listKey() {
  if (lib.tab === 'albums' && lib.albumId) return `album:${lib.albumId}`;
  return lib.tab;
}

export function render() {
  for (const b of document.querySelectorAll('.lib-tabs button')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === lib.tab));
  }
  const more = lib.tab === 'more';
  el('libMore').hidden = !more;
  el('libPages').hidden = more;
  if (more) {
    el('pager').hidden = true;
    return;
  }

  if (lib.tab === 'albums') {
    const album = lib.albumId && store.loadAlbums().find((a) => a.id === lib.albumId);
    if (lib.albumId && !album) lib.albumId = null;
    if (album) renderAlbum(album);
    else renderAlbums();
  } else {
    renderLoops();
  }
}

// ------------------------------------------------------------- paging

function rowHeight() {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h'));
  return v > 0 ? v : 52;
}

// Fill the list with one page of rows. `current` is the index to open on
// the first time this list is shown, so the loop that is playing is on the
// page you land on.
function paged(items, makeRow, emptyText, current = -1) {
  const list = el('libList');
  list.innerHTML = '';
  const pager = el('pager');
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
    // Without the pager there may be room for everything.
    pager.hidden = true;
    const all = Math.max(1, Math.floor(list.clientHeight / rowHeight()));
    if (items.length <= all) per = all;
    else pager.hidden = false;
  }
  const pages = Math.ceil(items.length / per);
  const key = listKey();
  if (lib.pages[key] == null && current >= 0) lib.pages[key] = Math.floor(current / per);
  const page = Math.min(Math.max(lib.pages[key] || 0, 0), pages - 1);
  lib.pages[key] = page;
  el('pgLabel').textContent = `${page + 1} / ${pages}`;
  el('pgPrev').disabled = page === 0;
  el('pgNext').disabled = page === pages - 1;
  items.slice(page * per, page * per + per).forEach((item, i) => {
    list.appendChild(makeRow(item, page * per + i));
  });
}

// ------------------------------------------------------------ pieces

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

// Destructive buttons ask twice: the first tap turns the button into
// "sure?", and only a second tap within a few seconds acts.
function confirmTiny(label, onConfirm) {
  const b = tiny(label, () => {
    if (b.classList.contains('confirm')) {
      onConfirm();
      return;
    }
    b.classList.add('confirm');
    b.textContent = 'sure?';
    setTimeout(() => {
      if (!b.isConnected) return;
      b.classList.remove('confirm');
      b.textContent = label;
    }, 3000);
  });
  return b;
}

function ghost(label, onClick) {
  const b = document.createElement('button');
  b.className = 'ghost';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
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

function savedSpecs() {
  const saved = store.loadAll();
  const byId = new Map(saved.map((e) => [e.id, e]));
  return { saved, byId };
}

function keyOf(spec) {
  return `${NOTE_NAMES[spec.root]} ${SCALES[spec.scale].label} · ${spec.bpm} bpm`;
}

// ------------------------------------------------------------- albums

function renderAlbums() {
  const head = el('libHead');
  const foot = el('libFoot');
  head.innerHTML = '';
  foot.innerHTML = '';
  foot.append(
    ghost('New album', () => {
      const title = prompt('Name this album', 'Untitled');
      if (!title || !title.trim()) return;
      const album = store.createAlbum(title.trim());
      if (!album) { ui.toast('Could not create the album'); return; }
      ui.toast(`Created ${title.trim()}`);
      render();
    }),
    ghost('Paste a code', () => lib.app.pasteCode()),
  );

  const albums = store.loadAlbums();
  const { byId } = savedSpecs();
  const playing = lib.app.state.playlist;

  paged(albums, (album) => {
    const specs = album.ids.map((id) => byId.get(id)).filter(Boolean).map((e) => e.spec);
    const art = document.createElement('canvas');
    art.className = 'album-art';
    art.width = 96;
    art.height = 96;
    art.getContext('2d').drawImage(albumArt(album, specs), 0, 0, 96, 96);
    const isPlaying = playing && playing.albumId === album.id;
    const meta = `${specs.length} ${specs.length === 1 ? 'loop' : 'loops'}`
      + (isPlaying ? ` · playing ${playing.index + 1}/${playing.ids.length}` : '');
    const r = row(album.title, meta, () => openAlbum(album.id), { art, current: isPlaying });
    const play = document.createElement('button');
    play.className = 'ghost tiny';
    play.setAttribute('aria-label', `Play ${album.title}`);
    play.innerHTML = ui.icon('play');
    play.addEventListener('click', () => lib.app.playAlbum(album.id, 0));
    r.appendChild(play);
    return r;
  }, 'No albums yet. Make one, then add loops to it.');
}

function renderAlbum(album) {
  const head = el('libHead');
  const foot = el('libFoot');
  head.innerHTML = '';
  foot.innerHTML = '';

  const back = document.createElement('button');
  back.className = 'back';
  back.innerHTML = `${ui.icon('left')}<span>Albums</span>`;
  back.addEventListener('click', closeAlbum);
  head.appendChild(back);

  const { byId } = savedSpecs();
  const present = album.ids.filter((id) => byId.has(id));
  const playing = lib.app.state.playlist;
  const here = playing && playing.albumId === album.id;

  foot.append(
    ghost('Play', () => lib.app.playAlbum(album.id, 0)),
    ghost('Add this loop', () => lib.app.addCurrentTo(album.id)),
    ghost('Share', () => lib.app.shareAlbum(album.id)),
    (() => {
      const b = ghost('Delete', () => {
        if (!b.classList.contains('confirm')) {
          b.classList.add('confirm');
          b.textContent = 'Delete album?';
          b.style.color = 'var(--rust)';
          b.style.borderColor = 'var(--rust)';
          setTimeout(() => {
            if (!b.isConnected) return;
            b.classList.remove('confirm');
            b.textContent = 'Delete';
            b.style.color = '';
            b.style.borderColor = '';
          }, 3000);
          return;
        }
        store.removeAlbum(album.id);
        if (playing && playing.albumId === album.id) lib.app.state.playlist = null;
        ui.toast('Album deleted');
        closeAlbum();
      });
      return b;
    })(),
  );

  const current = here ? playing.index : -1;
  paged(present, (id, i) => {
    const spec = byId.get(id).spec;
    const isCurrent = here && playing.index === i;
    const r = row(`${i + 1}. ${spec.name}`, keyOf(spec), () => lib.app.playAlbum(album.id, i),
      { current: isCurrent });
    // Overwrite this entry with whatever is playing now, so a loop can be
    // tweaked and put back without losing its place in the running order.
    r.appendChild(tiny('replace', () => {
      const s = lib.app.state.spec;
      if (!s) return;
      if (!store.replaceSpec(id, s)) { ui.toast('Could not save that change'); return; }
      ui.toast(`Replaced track ${i + 1}`);
      lib.app.cardChanged();
      render();
    }, 'Replace with the loop playing now'));
    r.appendChild(tiny('remove', () => {
      store.setAlbumIds(album.id, album.ids.filter((x) => x !== id));
      ui.toast('Removed from album');
      lib.app.cardChanged();
      render();
    }, 'Take out of this album (the loop stays saved)'));
    return r;
  }, 'Nothing in here yet. Play a loop you like, then tap "Add this loop".', current);
}

// -------------------------------------------------------------- loops

function renderLoops() {
  el('libHead').innerHTML = '';
  el('libFoot').innerHTML = '';
  const { saved } = savedSpecs();
  const currentId = lib.app.state.currentId;
  const current = saved.findIndex((e) => e.id === currentId);

  paged(saved, (entry) => {
    const r = row(entry.spec.name, keyOf(entry.spec), () => lib.app.openSaved(entry),
      { current: entry.id === currentId });
    r.appendChild(tiny('midi', () => lib.app.exportMidi(entry.spec), 'Export MIDI'));
    r.appendChild(confirmTiny('delete', () => {
      if (!store.remove(entry.id)) {
        ui.toast('Could not delete - this browser is refusing to store data');
        return;
      }
      if (lib.app.state.currentId === entry.id) lib.app.state.currentId = null;
      ui.toast('Deleted');
      lib.app.savedChanged();
    }));
    return r;
  }, 'Nothing saved yet. Find a loop you like and press Save.', current);
}
