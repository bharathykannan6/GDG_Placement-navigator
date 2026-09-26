// Small wrapper around localStorage. Storage can be blocked (private mode,
// strict settings), so every call is guarded and falls back gracefully.

const PREFIX = 'pn.';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearAll() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // nothing to clear
  }
}
