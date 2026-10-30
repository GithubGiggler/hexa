'use strict';

// Talking to her. One conversation at a time, append-only (Claude's replies go back exactly as
// they came, thinking blocks and all); "new chat" starts over, and so does switching brains.
// With Claude she can use her tools (actions.js): she streams her reply, runs the tools it calls,
// sends the results back, and goes on, a few rounds at most.

const { chatSystem, clock } = require('./persona');

const MAX_ROUNDS = 6;
const MAX_TURNS = 60; // past this, a fresh conversation (her history isn't trimmed: append-only)

function createChat({ getBrain, actions, onEvent, user, persona = () => ({ user }) }) {
  let history = [];
  let brainKey = null;
  let controller = null;
  let system = null; // who she is, fixed for the length of a conversation (no prefix edits)

  const reset = () => {
    controller?.abort();
    history = [];
    system = null;
  };

  async function send(text) {
    const message = String(text || '').trim().slice(0, 4000);
    if (!message) return;
    const { brain, model, key } = getBrain();
    if (key !== brainKey || history.length >= MAX_TURNS * 2) {
      history = [];
      system = null;
      brainKey = key;
    }
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    const withTools = brain.name === 'claude';
    if (!history.length || !system) system = chatSystem({ ...persona(), tools: withTools });
    history.push({ role: 'user', content: withTools ? [{ type: 'text', text: `${clock()} ${message}` }] : `${clock()} ${message}` });
    onEvent({ type: 'start' });
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const r = await brain.chat({ model, system, messages: history, tools: withTools ? actions.tools : undefined, onText: (d) => onEvent({ type: 'delta', text: d }), signal });
        history.push({ role: 'assistant', content: r.content });
        if (r.stopReason === 'refusal') {
          onEvent({ type: 'done', text: r.text, refused: true });
          return;
        }
        const calls = Array.isArray(r.content) ? r.content.filter((b) => b.type === 'tool_use') : [];
        if (r.stopReason !== 'tool_use' || !calls.length) {
          onEvent({ type: 'done', text: r.text });
          return;
        }
        // every tool_result in one user message, matched by id
        const results = [];
        for (const call of calls) {
          if (signal.aborted) return;
          const out = await actions.call(call.name, call.input);
          if (out.label) onEvent({ type: 'action', label: out.label });
          results.push(resultBlock(call.id, out));
        }
        history.push({ role: 'user', content: results });
      }
      onEvent({ type: 'done', text: '' });
    } catch (err) {
      if (signal.aborted) {
        onEvent({ type: 'stopped' });
        return;
      }
      onEvent({ type: 'error', text: err.message });
    }
  }

  return {
    send,
    stop: () => controller?.abort(),
    reset,
    get length() {
      return history.length;
    },
  };
}

function resultBlock(id, out) {
  if (out.error) return { type: 'tool_result', tool_use_id: id, is_error: true, content: out.error };
  if (out.image) {
    return { type: 'tool_result', tool_use_id: id, content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: out.image.data } }] };
  }
  return { type: 'tool_result', tool_use_id: id, content: out.ok || 'OK' };
}

module.exports = { createChat, resultBlock, MAX_ROUNDS };
