'use strict';

// What tokens would cost on the Anthropic API: prices.json (USD per million tokens) with your own
// ~/.config/hexa/prices.json on top. Always an estimate (list prices, standard speed, global
// routing); on a subscription it is what the same use would cost on the API.

const fs = require('node:fs');
const path = require('node:path');
const paths = require('../paths');
const BUILT_IN = require('./prices.json');

const KINDS = ['input', 'output', 'cacheWrite', 'cacheWrite1h', 'cacheRead'];
const count = (n) => (Number.isFinite(n) && n > 0 ? n : 0);
const price = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

// Every kind filled in; missing cache prices follow the API's usual multipliers of the input price.
function normalize(p) {
  if (!p || typeof p !== 'object') return null;
  const input = price(p.input);
  const output = price(p.output);
  if (input === null || output === null) return null;
  const out = {
    input,
    output,
    cacheWrite: price(p.cacheWrite) ?? input * 1.25,
    cacheWrite1h: price(p.cacheWrite1h) ?? input * 2,
    cacheRead: price(p.cacheRead) ?? input * 0.1,
  };
  const long = normalize(p.long);
  if (long) out.long = long;
  return out;
}

// The built-in table, then yours: an entry of yours replaces the built-in one for that model.
function loadPrices({ file = path.join(paths.configDir(), 'prices.json'), log = console } = {}) {
  const table = { updated: BUILT_IN.updated, custom: false, models: {}, families: { ...BUILT_IN.families } };
  for (const [id, p] of Object.entries(BUILT_IN.models)) table.models[id] = normalize(p);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return table; // no prices of yours
  }
  let user;
  try {
    user = JSON.parse(text);
  } catch (err) {
    log.warn(`[hexa] ${file} is not valid JSON (${err.message}): using the built-in prices`);
    return table;
  }
  for (const [id, p] of Object.entries(user?.models || {})) {
    const entry = normalize(p);
    if (entry) table.models[id.toLowerCase()] = entry;
    else log.warn(`[hexa] ${file}: the prices for "${id}" need at least input and output, in USD per million tokens`);
  }
  for (const [family, id] of Object.entries(user?.families || {})) {
    if (typeof id === 'string') table.families[family.toLowerCase()] = id.toLowerCase();
  }
  if (typeof user?.updated === 'string') table.updated = user.updated;
  table.custom = true;
  return table;
}

// claude-opus-4-5-20251101, us.anthropic.claude-opus-4-5-20251101-v1:0 (Bedrock),
// claude-opus-4-5@20251101 (Vertex), claude-opus-5-5[1m]: the id the price table uses.
function canonical(model) {
  return String(model || '').toLowerCase().trim()
    .replace(/^.*anthropic\./, '')
    .replace(/\[[^\]]*\]$/, '')
    .replace(/-v\d+(:\d+)?$/, '')
    .replace(/@.*$/, '')
    .replace(/-\d{8}$/, '');
}

// The prices for a model: its own, else its family's current model's (opus, sonnet, haiku...),
// else null: an unknown model has no cost rather than a made-up one.
function priceFor(table, model) {
  const id = canonical(model);
  if (table.models[id]) return table.models[id];
  const words = id.split(/[^a-z0-9]+/);
  for (const [family, target] of Object.entries(table.families)) {
    if (words.includes(family) && table.models[target]) return table.models[target];
  }
  return null;
}

function partCost(p, u) {
  const write = count(u.cacheWrite);
  const hour = Math.min(write, count(u.cacheWrite1h));
  return (count(u.input) * p.input + count(u.output) * p.output + (write - hour) * p.cacheWrite
    + hour * p.cacheWrite1h + count(u.cacheRead) * p.cacheRead) / 1e6;
}

// USD for one model's usage ({ input, output, cacheWrite, cacheWrite1h, cacheRead, long? }), or
// null when the model has no price.
function costOf(table, model, usage) {
  const p = priceFor(table, model);
  if (!p || !usage) return null;
  if (!usage.long || !p.long) return partCost(p, usage);
  const rest = {};
  for (const k of KINDS) rest[k] = Math.max(0, count(usage[k]) - count(usage.long[k]));
  return partCost(p, rest) + partCost(p.long, usage.long);
}

// { usd, byModel: { [model]: usd }, unpriced: [model] } for { [model]: usage }
function costOfModels(table, models) {
  const out = { usd: 0, byModel: {}, unpriced: [], estimate: true };
  for (const [model, usage] of Object.entries(models || {})) {
    const usd = costOf(table, model, usage);
    if (usd === null) out.unpriced.push(model);
    else {
      out.byModel[model] = usd;
      out.usd += usd;
    }
  }
  return out;
}

module.exports = { loadPrices, priceFor, costOf, costOfModels, canonical, normalize, BUILT_IN };
