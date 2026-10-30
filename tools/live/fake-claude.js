'use strict';

// A scripted stand-in for Claude, for the live checks only (Hexa loads it in dev mode when
// HEXA_FAKE_CLAUDE names a script): { chat: [replies], computer: [replies] }; each chat() returns
// the next reply of its kind (computer use is the one with the computer toolset) and appends the
// request it got to <script>.log.jsonl, images shortened. Never part of a release.

const fs = require('node:fs');

function createFakeClaude(file) {
  const script = JSON.parse(fs.readFileSync(file, 'utf8'));
  const log = `${file}.log.jsonl`;
  const shorten = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'data' && typeof x === 'string' ? `<${x.length} chars>` : x)));
  return {
    name: 'claude',
    async listModels() { return [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (scripted)' }]; },
    async chat(req) {
      fs.appendFileSync(log, `${JSON.stringify(shorten({ model: req.model, tools: req.tools?.map((t) => t.name || t.type), messages: req.messages }))}\n`);
      const kind = req.tools?.some((t) => t.type === 'computer_toolset_20260801') ? 'computer' : 'chat';
      const r = script[kind].shift() || { content: [{ type: 'text', text: '(script over)' }] };
      const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (text) req.onText?.(text);
      return { content: r.content, text, stopReason: r.stop || 'end_turn' };
    },
  };
}

module.exports = { createFakeClaude };
