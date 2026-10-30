'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { langOf, resolveLang } = require('../src/main/lang');

const auto = (env) => resolveLang('auto', env);

test('a locale names its language', () => {
  assert.equal(langOf('de_DE.UTF-8'), 'de');
  assert.equal(langOf('fr_CA.utf8'), 'fr');
  assert.equal(langOf('es_MX'), 'es');
  assert.equal(langOf('ja_JP.eucJP'), 'ja');
  assert.equal(langOf('de_AT.UTF-8@euro'), 'de');
  assert.equal(langOf('pt-BR'), 'pt');
  assert.equal(langOf('EN_us'), 'en');
  for (const none of ['C', 'C.UTF-8', 'POSIX', '', undefined, null]) assert.equal(langOf(none), null, String(none));
});

test("'auto' follows LANG for each language she speaks", () => {
  assert.equal(auto({ LANG: 'de_DE.UTF-8' }), 'de');
  assert.equal(auto({ LANG: 'fr_FR.UTF-8' }), 'fr');
  assert.equal(auto({ LANG: 'fr_BE.UTF-8' }), 'fr');
  assert.equal(auto({ LANG: 'es_ES.UTF-8' }), 'es');
  assert.equal(auto({ LANG: 'es_AR.UTF-8' }), 'es');
  assert.equal(auto({ LANG: 'ja_JP.UTF-8' }), 'ja');
  assert.equal(auto({ LANG: 'en_GB.UTF-8' }), 'en');
});

test('LC_ALL beats LC_MESSAGES beats LANG', () => {
  assert.equal(auto({ LC_ALL: 'ja_JP.UTF-8', LC_MESSAGES: 'fr_FR.UTF-8', LANG: 'de_DE.UTF-8' }), 'ja');
  assert.equal(auto({ LC_MESSAGES: 'fr_FR.UTF-8', LANG: 'de_DE.UTF-8' }), 'fr');
  assert.equal(auto({ LC_ALL: '', LC_MESSAGES: '', LANG: 'es_ES.UTF-8' }), 'es');
  // the other categories don't decide the language
  assert.equal(auto({ LC_TIME: 'de_DE.UTF-8', LC_NUMERIC: 'fr_FR.UTF-8', LANG: 'en_US.UTF-8' }), 'en');
});

test('LANGUAGE comes first, as with gettext, unless the locale is C', () => {
  // Plasma: German formats, English messages
  assert.equal(auto({ LANG: 'de_DE.UTF-8', LANGUAGE: 'en_US' }), 'en');
  assert.equal(auto({ LANG: 'en_US.UTF-8', LANGUAGE: 'ja' }), 'ja');
  // the first one in the list she speaks
  assert.equal(auto({ LANG: 'en_US.UTF-8', LANGUAGE: 'it:es:fr' }), 'es');
  // none she speaks: the locale itself
  assert.equal(auto({ LANG: 'de_DE.UTF-8', LANGUAGE: 'it:pt_BR' }), 'de');
  assert.equal(auto({ LC_ALL: 'C', LANGUAGE: 'de' }), 'en');
  assert.equal(auto({ LANGUAGE: 'de' }), 'en');
});

test('anything else falls back to English', () => {
  assert.equal(auto({}), 'en');
  assert.equal(auto({ LANG: 'C.UTF-8' }), 'en');
  assert.equal(auto({ LANG: 'POSIX' }), 'en');
  assert.equal(auto({ LANG: 'it_IT.UTF-8' }), 'en');
  assert.equal(auto({ LANG: 'zh_CN.UTF-8' }), 'en');
  assert.equal(auto({ LANG: 'garbage' }), 'en');
});

test('a language set in the config wins over the locale', () => {
  const env = { LANG: 'de_DE.UTF-8' };
  assert.equal(resolveLang('fr', env), 'fr');
  assert.equal(resolveLang('ja_JP', env), 'ja');
  assert.equal(resolveLang('ES', env), 'es');
  assert.equal(resolveLang('it', env), 'en', 'one she does not speak: English, not the locale');
  assert.equal(resolveLang(undefined, env), 'de', 'unset means auto');
  assert.equal(resolveLang(null, env), 'de');
  assert.equal(resolveLang('', env), 'de');
  assert.equal(resolveLang(42, env), 'en');
});

test('with no env given she reads the process one', () => {
  assert.equal(typeof resolveLang('auto'), 'string');
  assert.equal(resolveLang('ja'), 'ja');
});
