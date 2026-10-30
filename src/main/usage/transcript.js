'use strict';

// Token usage from a Claude Code transcript (JSONL), read a piece at a time: each call reads only
// the lines added since the byte offset the caller kept from the last one, and sums
// message.usage per model. Only numbers come out: the text in a transcript is never kept,
// returned or logged. The one string kept is the model id, and only when it looks like one.

const fs = require('node:fs');

const CHUNK = 1 << 20;        // 1 MB reads: transcripts grow to hundreds of MB
const MAX_LINE = 64 << 20;    // a longer line is skipped rather than buffered without end
const MAX_SEEN = 50000;       // message ids remembered for deduplication, oldest dropped first
// Haiku 5.5 bills a request whose prompt (input, cache writes and reads) is over 100k tokens at
// higher prices, so those messages are also summed apart, under `long`
const LONG_PROMPT = 100000;
const MODEL_ID = /^[A-Za-z0-9][\w.:@/[\]-]{0,79}$/;
const NEWLINE = 10;
const USAGE = Buffer.from('"usage"');

const FIELDS = ['input', 'output', 'cacheWrite', 'cacheWrite1h', 'cacheRead'];
const emptyUsage = () => ({ input: 0, output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, messages: 0 });

const count = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

// The four counts the API reports, plus the part of the cache writes made for an hour (they
// cost more than the default five minutes).
function usageOf(u) {
  return {
    input: count(u.input_tokens),
    output: count(u.output_tokens),
    cacheWrite: count(u.cache_creation_input_tokens),
    cacheWrite1h: Math.min(count(u.cache_creation_input_tokens), count(u.cache_creation?.ephemeral_1h_input_tokens)),
    cacheRead: count(u.cache_read_input_tokens),
  };
}

function remember(seen, id, value, max) {
  seen.delete(id); // re-inserted at the end: the newest stay
  seen.set(id, value);
  if (seen.size > max) seen.delete(seen.keys().next().value);
}

// Reads what was added to `file` since `state` ({ offset, ino } from the last call; none: from
// the start). `seen` maps message ids to what was counted for them and may be shared by several
// files, so a message copied into another transcript (a resumed session) counts once. Lines
// stamped before `since` (ms) are marked seen but not counted.
//
// Resolves { state, models: { [model]: { input, output, cacheWrite, cacheWrite1h, cacheRead,
// messages, long? } }, lines, bad, reset, missing? }. `state` is what to pass next time.
async function readNew(file, { state = null, seen = new Map(), since = null, maxSeen = MAX_SEEN } = {}) {
  const out = { state: { offset: count(state?.offset), ino: state?.ino ?? null }, models: {}, lines: 0, bad: 0, reset: false };
  let fh;
  try {
    fh = await fs.promises.open(file, 'r');
  } catch {
    out.missing = true;
    return out;
  }

  const add = (model, delta, long) => {
    if (!FIELDS.some((k) => delta[k] > 0) && !delta.messages) return;
    const m = (out.models[model] ??= emptyUsage());
    for (const k of FIELDS) m[k] += delta[k];
    m.messages += delta.messages;
    if (long) {
      const l = (m.long ??= emptyUsage());
      for (const k of FIELDS) l[k] += delta[k];
      l.messages += delta.messages;
    }
  };

  const handle = (buf) => {
    out.lines += 1;
    if (buf.indexOf(USAGE) === -1) return; // prompts and tool results carry no usage: no need to parse them
    let entry;
    try {
      entry = JSON.parse(buf.toString('utf8'));
    } catch {
      out.bad += 1;
      return;
    }
    const msg = entry?.message;
    if (entry?.type !== 'assistant' || !msg || typeof msg !== 'object' || !msg.usage || typeof msg.usage !== 'object') return;
    const model = typeof msg.model === 'string' && MODEL_ID.test(msg.model) ? msg.model : 'unknown';
    const now = usageOf(msg.usage);
    const id = typeof msg.id === 'string' && msg.id ? msg.id : null;
    // Claude Code writes a line per content block, each with the message's usage so far: a
    // message counts once, at the most it ever reported
    const before = id ? seen.get(id) : null;
    const delta = { messages: before ? 0 : 1 };
    const kept = {};
    for (const k of FIELDS) {
      kept[k] = Math.max(now[k], before?.[k] || 0);
      delta[k] = kept[k] - (before?.[k] || 0);
    }
    if (id) remember(seen, id, kept, maxSeen);
    const at = since === null ? NaN : Date.parse(entry.timestamp);
    if (Number.isFinite(at) && at < since) return;
    if (msg.model === '<synthetic>') return; // Claude Code's own stand-ins, not API calls
    add(model, delta, now.input + now.cacheWrite + now.cacheRead > LONG_PROMPT);
  };

  try {
    const st = await fh.stat();
    let offset = out.state.offset;
    // shorter than where we were, or another file under the same name: it starts over
    if (st.size < offset || (out.state.ino !== null && st.ino !== out.state.ino)) {
      offset = 0;
      out.reset = true;
    }
    out.state.ino = st.ino;

    const buf = Buffer.allocUnsafe(CHUNK);
    let pos = offset;
    let consumed = offset; // just past the last complete line
    let carry = [];        // the start of a line still waiting for its newline
    let carried = 0;
    let skipping = false;  // inside a line too long to keep
    while (pos < st.size) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(CHUNK, st.size - pos), pos);
      if (!bytesRead) break;
      const chunk = buf.subarray(0, bytesRead);
      let start = 0;
      let nl;
      while ((nl = chunk.indexOf(NEWLINE, start)) !== -1) {
        if (skipping) {
          out.lines += 1;
          out.bad += 1;
        } else {
          const piece = chunk.subarray(start, nl);
          const line = carried ? Buffer.concat([...carry, piece]) : piece;
          if (line.length) handle(line);
        }
        carry = [];
        carried = 0;
        skipping = false;
        start = nl + 1;
        consumed = pos + start;
      }
      // a partial last line is left for the next call, which reads it again from its start
      if (start < bytesRead && !skipping) {
        carry.push(Buffer.from(chunk.subarray(start)));
        carried += bytesRead - start;
        if (carried > MAX_LINE) {
          carry = [];
          carried = 0;
          skipping = true;
        }
      }
      pos += bytesRead;
    }
    out.state.offset = consumed;
  } finally {
    await fh.close();
  }
  return out;
}

// Adds b's counts into a (both { [model]: usage }), for summing reads and days.
function addModels(a, b) {
  for (const [model, u] of Object.entries(b || {})) {
    const m = (a[model] ??= emptyUsage());
    for (const k of [...FIELDS, 'messages']) m[k] += count(u?.[k]);
    if (u?.long) {
      const l = (m.long ??= emptyUsage());
      for (const k of [...FIELDS, 'messages']) l[k] += count(u.long[k]);
    }
  }
  return a;
}

// input + output + cache writes + cache reads (cacheWrite1h is part of cacheWrite)
const totalOf = (u) => count(u?.input) + count(u?.output) + count(u?.cacheWrite) + count(u?.cacheRead);

module.exports = { readNew, addModels, totalOf, emptyUsage, FIELDS, LONG_PROMPT, MAX_SEEN };
