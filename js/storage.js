// Saved loops live in localStorage. A loop is only its spec — a few
// numbers and five seeds — so a hundred saves is a few kilobytes.

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

export function exportAll() {
  return new Blob([JSON.stringify({ format: 'driftloom.v1', loops: loadAll() }, null, 2)], {
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
  return { added, rejected, failed: false };
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
