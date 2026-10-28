// Small helpers shared by the renderer modules. No DOM here, so tests can import it.

export const pick = (list, rnd = Math.random) => list[Math.floor(rnd() * list.length)];

export const rand = (a, b, rnd = Math.random) => a + (b - a) * rnd();

// '{n} in {project}' with { n: 3, project: 'api' }; unknown keys stay as written
export const fmt = (text, vars = {}) => String(text).replace(/\{(\w+)\}/g, (all, key) => (key in vars ? String(vars[key]) : all));

// Shortens text to at most max characters, ending in '…', without splitting a surrogate pair.
export function clip(text, max) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  let end = Math.max(0, max - 1);
  const code = s.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return s.slice(0, end) + '…';
}

export const basename = (p) => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() || '';

// 45 s, 2m 14s, 1h 03m
export function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

// forms: [one, other]
export const plural = (n, [one, other]) => (n === 1 ? one : other);

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
