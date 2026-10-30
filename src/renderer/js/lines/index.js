// Her lines by language. English is the fallback for anything missing.

import * as en from './en.js';

const TABLES = { en };

export const LANGS = Object.keys(TABLES);

export function linesFor(lang) {
  const table = TABLES[lang] || en;
  return {
    ...en.LINES, ...table.LINES, verbs: table.VERBS || en.VERBS,
    guide: { ...en.GUIDE, ...(table.GUIDE || {}) }, buttons: { ...en.BUTTONS, ...(table.BUTTONS || {}) },
  };
}

// Which greeting goes after her boot line at this hour (0-23).
export function greetingKey(hour) {
  if (hour < 5) return 'greetLate';
  if (hour < 12) return 'greetMorning';
  if (hour < 18) return 'greetDay';
  return 'greetEvening';
}
