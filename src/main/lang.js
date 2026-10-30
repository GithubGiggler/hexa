'use strict';

// Which language she speaks. The config's `lang` names one ('de', or a locale such as 'de_DE'),
// or is 'auto': then she reads the locale the way gettext does, so she agrees with the rest of
// your desktop. The messages locale is the first of LC_ALL, LC_MESSAGES and LANG that is set;
// unless it is C or POSIX, LANGUAGE (a priority list like 'de:en', which Plasma's language
// setting writes) comes first. Anything she doesn't speak falls back to English.

const { LANGS } = require('./labels');

// 'de_DE.UTF-8@euro' -> 'de', 'pt-BR' -> 'pt'; 'C', 'POSIX' and '' -> null
function langOf(locale) {
  const code = String(locale ?? '').trim().split(/[_.@-]/)[0].toLowerCase();
  return code && code !== 'c' && code !== 'posix' ? code : null;
}

function resolveLang(setting = 'auto', env = process.env, known = LANGS) {
  const speak = (code) => (code && known.includes(code) ? code : null);
  if (setting && setting !== 'auto') return speak(langOf(setting)) || 'en';
  const messages = env.LC_ALL || env.LC_MESSAGES || env.LANG || '';
  if (!langOf(messages)) return 'en'; // the C locale: gettext ignores LANGUAGE too
  for (const entry of String(env.LANGUAGE || '').split(':')) {
    const code = speak(langOf(entry));
    if (code) return code;
  }
  return speak(langOf(messages)) || 'en';
}

module.exports = { langOf, resolveLang };
