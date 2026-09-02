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
  persist(list);
  return entry;
}

export function remove(id) {
  const list = loadAll().filter((e) => e.id !== id);
  persist(list);
  return list;
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

export function importAll(json) {
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  const incoming = parsed.loops || (Array.isArray(parsed) ? parsed : []);
  const list = loadAll();
  const have = new Set(list.map((e) => e.id));
  let added = 0;
  for (const e of incoming) {
    if (!e || !e.spec || have.has(e.id)) continue;
    list.push(e);
    added++;
  }
  persist(list);
  return added;
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
