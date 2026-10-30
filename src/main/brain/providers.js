'use strict';

// Her brains, one at a time: a small or a bigger local model through Ollama (free, on your
// machine), or Claude through the Anthropic API (your key, or whatever credentials the SDK finds:
// ANTHROPIC_API_KEY, an `ant auth login` profile). One shape for both:
//   listModels() -> [{ id, label }]
//   chat({ model, system, messages, tools, onText, signal }) -> { content, text, stopReason }
// Local brains only talk; tools (opening things, using your computer) need Claude.

const http = require('node:http');

// where Ollama listens (OLLAMA_HOST, as Ollama itself reads it; "host:port" works too)
function ollamaBase() {
  const host = process.env.OLLAMA_HOST || '127.0.0.1:11434';
  return /^https?:\/\//.test(host) ? host : `http://${host}`;
}
// Claude models that take server-side refusal fallbacks ("default" routing)
const FALLBACKS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
const DEFAULT_CLAUDE = 'claude-opus-5-5';

function ollamaRequest(method, path, body, { signal, onLine } = {}) {
  const url = new URL(path, ollamaBase());
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(url, {
      method,
      headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {},
      signal,
    }, (res) => {
      let buf = '';
      let all = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (!onLine) { all += chunk; return; }
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            onLine(JSON.parse(line));
          } catch (err) {
            req.destroy();
            reject(err);
            return;
          }
        }
      });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Ollama: HTTP ${res.statusCode} ${all.slice(0, 200)}`));
        try {
          if (onLine && buf.trim()) onLine(JSON.parse(buf));
          resolve(onLine ? null : JSON.parse(all || '{}'));
        } catch (err) {
          reject(err);
        }
      });
      res.on('error', reject);
    });
    req.on('error', (err) => reject(err.code === 'ECONNREFUSED' ? new Error('Ollama isn\'t running (ollama serve)') : err));
    req.end(data);
  });
}

const ollama = {
  name: 'ollama',
  async listModels() {
    const r = await ollamaRequest('GET', '/api/tags');
    return (r.models || [])
      .sort((a, b) => (a.size || 0) - (b.size || 0))
      .map((m) => ({ id: m.name, label: m.details?.parameter_size ? `${m.name} (${m.details.parameter_size})` : m.name, size: m.size || 0 }));
  },
  async chat({ model, system, messages, onText = () => {}, signal }) {
    let text = '';
    const body = {
      model,
      stream: true,
      messages: [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role, content: plainText(m.content) }))],
    };
    await ollamaRequest('POST', '/api/chat', body, {
      signal,
      onLine: (o) => {
        if (o.error) throw new Error(`Ollama: ${o.error}`);
        const delta = o.message?.content || '';
        if (delta) {
          text += delta;
          onText(delta);
        }
      },
    });
    return { content: text, text, stopReason: 'end_turn' };
  },
};

// a message's text, whatever shape its content has
function plainText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

function claudeBrain({ apiKey = null, createClient } = {}) {
  let client = null;
  const getClient = () => {
    if (client) return client;
    if (createClient) client = createClient(apiKey);
    else {
      const { Anthropic } = require('@anthropic-ai/sdk');
      client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
    }
    return client;
  };
  return {
    name: 'claude',
    async listModels() {
      const out = [];
      for await (const m of getClient().models.list()) {
        if (String(m.id).startsWith('claude-')) out.push({ id: m.id, label: m.display_name || m.id });
      }
      return out;
    },
    // Streams the reply; returns the whole assistant content (to append to history unchanged) and
    // its text. effort: 'low' for chat, higher for computer use.
    async chat({ model = DEFAULT_CLAUDE, system, messages, tools, onText = () => {}, signal, effort = 'low', betas = [], extra = {} }) {
      const fallback = FALLBACKS.has(model);
      const params = {
        model,
        max_tokens: 64000,
        system,
        messages,
        output_config: { effort },
        ...(tools?.length ? { tools } : {}),
        ...(fallback ? { fallbacks: 'default' } : {}),
        betas: [...betas, ...(fallback ? ['server-side-fallback-2026-07-01'] : [])],
        ...extra,
      };
      const stream = getClient().beta.messages.stream(params, { signal });
      stream.on('text', (delta) => onText(delta));
      const msg = await stream.finalMessage();
      const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      return { content: msg.content, text, stopReason: msg.stop_reason, stopDetails: msg.stop_details || null, model: msg.model };
    },
  };
}

module.exports = { ollama, claudeBrain, plainText, ollamaBase, DEFAULT_CLAUDE, FALLBACKS };
