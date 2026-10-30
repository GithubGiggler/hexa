// Her lines by language. English is the fallback for anything missing. The main process resolves
// her language (src/main/lang.js) and hands the renderer a code from LANGS; its menu labels list
// the same languages (src/main/labels.js). Adding one: docs/translating.md.

import * as en from './en.js';
import * as de from './de.js';
import * as fr from './fr.js';
import * as es from './es.js';
import * as ja from './ja.js';

const TABLES = { en, de, fr, es, ja };

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
