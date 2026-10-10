// Saved loops live in localStorage. A loop is only its spec — a few
// numbers and a handful of seeds, under a kilobyte as JSON — so a hundred
// saves is well under a hundred kilobytes.

const KEY = 'driftloom.saves.v1';
const PREFS = 'driftloom.prefs.v1';

export function loadAll() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.warn('Could not read saved loops', err);
    return [];
  }
}

function persist(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch (err) {
    console.warn('Could not save', err);
    return false;
  }
}

export function save(spec) {
  const list = loadAll();
  const entry = {
    id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    savedAt: new Date().toISOString(),
    spec: JSON.parse(JSON.stringify(spec)),
  };
  list.unshift(entry);
  // Returns null if the write failed -- full quota, private browsing,
  // storage disabled. Telling someone their loop is saved when it is not is
  // the worst failure this app has: the loop is unrecoverable the moment
  // they move on.
  if (!persist(list)) return null;
  return entry;
}

export function remove(id) {
  const list = loadAll().filter((e) => e.id !== id);
  return persist(list) ? list : null;
}

export function rename(id, name) {
  const list = loadAll();
  const e = list.find((x) => x.id === id);
  if (e) {
    e.spec.name = name;
    persist(list);
  }
  return list;
}

// Backups carry the albums too, since every kept loop lives in one. Older
// backups have only `loops`; those land in Favorite Loops on restore.
export function exportAll() {
  return new Blob([JSON.stringify({ format: 'driftloom.v1', loops: loadAll(), albums: loadAlbums() }, null, 2)], {
    type: 'application/json',
  });
}

// A loop is only restorable if it has the pieces render() needs. Anything
// missing them would throw the moment it was opened, which from the outside
// looks like the app breaking rather than one bad entry.
function usable(entry) {
  const s = entry && entry.spec;
  if (!s || typeof s !== 'object') return false;
  if (typeof s.scale !== 'string' || !Number.isFinite(s.root)) return false;
  if (!Number.isFinite(s.bpm) || !Number.isFinite(s.bars) || s.bars < 1) return false;
  if (!s.layerSeeds || typeof s.layerSeeds !== 'object') return false;
  return ['drums', 'bass', 'chords', 'melody', 'texture']
    .every((k) => Number.isFinite(s.layerSeeds[k]));
}

export function importAll(json) {
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  const incoming = parsed.loops || (Array.isArray(parsed) ? parsed : []);
  const list = loadAll();
  const have = new Set(list.map((e) => e.id));
  let added = 0;
  let rejected = 0;
  for (const e of incoming) {
    if (!e || have.has(e.id)) continue;
    if (!usable(e)) { rejected++; continue; }
    // Defaults for anything a very old save predates.
    e.spec.mutes = e.spec.mutes || { drums: false, bass: false, chords: false, melody: false, texture: false };
    e.spec.stepsPerBar = e.spec.stepsPerBar || 16;
    list.push(e);
    added++;
  }
  if (!persist(list)) return { added: 0, rejected, failed: true };
  // Albums from a backup: merge by id, keeping only loops that exist, and
  // never letting a backup's copy of a built-in album replace this one's.
  if (Array.isArray(parsed.albums)) {
    const albums = loadAlbums();
    const ids = new Set(list.map((e) => e.id));
    for (const a of parsed.albums) {
      if (!a || !Array.isArray(a.ids)) continue;
      const keep = a.ids.filter((id) => ids.has(id));
      const mine = albums.find((x) => x.id === a.id);
      if (mine) {
        for (const id of keep) if (!mine.ids.includes(id)) mine.ids.push(id);
      } else if (!a.builtin) {
        albums.push({ id: a.id, title: String(a.title || 'Untitled').slice(0, NAME_MAX), ids: keep });
      }
    }
    persistAlbums(albums);
  }
  ensureAlbums();
  return { added, rejected, failed: false };
}

// Albums are named lists of saved-loop ids. Kept separate from the loops
// themselves so a loop can sit in several albums without being duplicated.
//
// Every kept loop lives in at least one album (Mikey, 2026-10-10). Two are
// built in and always first: Favorite Loops, where keeping a loop puts it by
// default, and Imported Loops, where a pasted loop code lands. Built-ins
// cannot be deleted or renamed; Imported Loops hides while it is empty.
// Taking a loop out of the last album it is in deletes it.
const ALBUMS = 'driftloom.albums.v1';
export const FAVORITES = 'fav';
export const IMPORTED = 'imported';
const BUILTIN_TITLES = { [FAVORITES]: 'Favorite Loops', [IMPORTED]: 'Imported Loops' };
// Names (loops and albums) are kept short enough to sit on the card at a
// readable size.
export const NAME_MAX = 24;

export function isBuiltin(id) {
  return id === FAVORITES || id === IMPORTED;
}

// Create the built-ins if missing, keep them first, and put any kept loop
// that is in no album at all into Favorite Loops. That last part is the
// one-time move for saves made before albums mattered, and stays as a
// safety net (a restore of an old backup, say).
export function ensureAlbums() {
  let albums = loadAlbums();
  let changed = false;
  for (const id of [FAVORITES, IMPORTED]) {
    if (!albums.some((a) => a.id === id)) {
      albums.push({ id, title: BUILTIN_TITLES[id], ids: [], builtin: true });
      changed = true;
    }
  }
  const inSome = new Set(albums.flatMap((a) => a.ids));
  const orphans = loadAll().filter((e) => !inSome.has(e.id)).map((e) => e.id);
  if (orphans.length) {
    albums.find((a) => a.id === FAVORITES).ids.push(...orphans);
    changed = true;
  }
  const order = (a) => (a.id === FAVORITES ? 0 : a.id === IMPORTED ? 1 : 2);
  const sorted = albums.slice().sort((a, b) => order(a) - order(b));
  if (sorted.some((a, i) => a !== albums[i])) changed = true;
  albums = sorted;
  if (changed) persistAlbums(albums);
  return albums;
}

// The albums a loop is in.
export function albumsOf(loopId) {
  return loadAlbums().filter((a) => a.ids.includes(loopId));
}

// Put a loop in an album (no-op if it is already there).
export function addToAlbum(albumId, loopId) {
  const list = loadAlbums();
  const album = list.find((a) => a.id === albumId);
  if (!album) return false;
  if (!album.ids.includes(loopId)) album.ids.push(loopId);
  return persistAlbums(list);
}

// Take a loop out of an album. If no other album holds it, the loop itself
// is deleted. Returns { ok, deleted }.
export function removeFromAlbum(albumId, loopId) {
  const list = loadAlbums();
  const album = list.find((a) => a.id === albumId);
  if (!album) return { ok: false, deleted: false };
  album.ids = album.ids.filter((x) => x !== loopId);
  const elsewhere = list.some((a) => a.ids.includes(loopId));
  if (!persistAlbums(list)) return { ok: false, deleted: false };
  if (elsewhere) return { ok: true, deleted: false };
  return { ok: !!remove(loopId), deleted: true };
}

// Move a loop from one album to another, keeping it if the target already
// has it.
export function moveToAlbum(loopId, fromId, toId) {
  const list = loadAlbums();
  const from = list.find((a) => a.id === fromId);
  const to = list.find((a) => a.id === toId);
  if (!from || !to) return false;
  from.ids = from.ids.filter((x) => x !== loopId);
  if (!to.ids.includes(loopId)) to.ids.push(loopId);
  return persistAlbums(list);
}

// How many of an album's loops are in no other album (and so would go
// with it).
export function onlyHere(albumId) {
  const list = loadAlbums();
  const album = list.find((a) => a.id === albumId);
  if (!album) return [];
  return album.ids.filter((id) => !list.some((a) => a !== album && a.ids.includes(id)));
}

export function loadAlbums() {
  try {
    const raw = localStorage.getItem(ALBUMS);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function persistAlbums(list) {
  try {
    localStorage.setItem(ALBUMS, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function createAlbum(title) {
  const list = loadAlbums();
  const album = {
    id: `a${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    title: (title || 'Untitled').slice(0, NAME_MAX),
    ids: [],
  };
  // After the built-ins, newest first.
  const at = list.filter((a) => isBuiltin(a.id)).length;
  list.splice(at, 0, album);
  return persistAlbums(list) ? album : null;
}

export function setAlbumIds(id, ids) {
  const list = loadAlbums();
  const album = list.find((a) => a.id === id);
  if (!album) return false;
  album.ids = ids;
  return persistAlbums(list);
}

export function renameAlbum(id, title) {
  if (isBuiltin(id)) return false;
  const list = loadAlbums();
  const album = list.find((a) => a.id === id);
  if (!album) return false;
  album.title = (title || 'Untitled').slice(0, NAME_MAX);
  return persistAlbums(list);
}

// Replace one entry in place, keeping its position in the running order.
export function replaceSpec(id, spec) {
  const list = loadAll();
  const entry = list.find((e) => e.id === id);
  if (!entry) return false;
  entry.spec = JSON.parse(JSON.stringify(spec));
  entry.savedAt = new Date().toISOString();
  return persist(list);
}

// Deleting an album deletes the loops that were only in it, since a kept
// loop always lives in some album. The caller says how many first.
export function removeAlbum(id) {
  if (isBuiltin(id)) return false;
  const doomed = onlyHere(id);
  if (!persistAlbums(loadAlbums().filter((a) => a.id !== id))) return false;
  if (doomed.length) persist(loadAll().filter((e) => !doomed.includes(e.id)));
  return true;
}

// Whether two specs are the same loop in every detail (used to tell a kept
// loop that has since been tweaked from one that has not).
export function sameSpec(a, b) {
  return stable(a) === stable(b);
}

// The kept loop with exactly this recipe, if any. Names are ignored: the
// same loop renamed is still the same loop.
export function findSame(spec) {
  const key = recipeKey(spec);
  return loadAll().find((e) => recipeKey(e.spec) === key) || null;
}

function recipeKey(spec) {
  const { name, playFor, ...rest } = spec;
  return stable(rest);
}

// JSON with keys sorted, so two copies of a recipe that arrived by
// different routes (a share code, a backup) compare equal.
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

// Add loops that arrived from a shared code, keeping any that are already
// here rather than making duplicates.
export function addSpecs(specs) {
  const list = loadAll();
  const added = [];
  for (const spec of specs) {
    const entry = {
      id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
      savedAt: new Date().toISOString(),
      spec: JSON.parse(JSON.stringify(spec)),
    };
    list.unshift(entry);
    added.push(entry.id);
  }
  return persist(list) ? added : null;
}

export function getPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS) || '{}');
  } catch {
    return {};
  }
}

export function setPrefs(p) {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ ...getPrefs(), ...p }));
  } catch {
    /* private mode, nothing to do */
  }
}
