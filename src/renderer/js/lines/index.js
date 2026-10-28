// Her lines by language. English is the fallback for anything missing.

import * as en from './en.js';

const TABLES = { en };

export const LANGS = Object.keys(TABLES);

export function linesFor(lang) {
  const table = TABLES[lang] || en;
  return { ...en.LINES, ...table.LINES, verbs: table.VERBS || en.VERBS };
}
