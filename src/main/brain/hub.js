'use strict';

// Her brain, put together for main.js: which brain you picked (her Mainframe), its models, your
// key, the chat and her actions, computer use behind your consent, reminders. Everything the page
// sees goes through send(); everything it asks comes back through the methods here.
//
// Brains: normal (a small local model), bigger (a bigger local one), max (Claude).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { ollama, claudeBrain, DEFAULT_CLAUDE } = require('./providers');
const { createChat } = require('./chat');
const { createActions } = require('./actions');
const { runComputerTask } = require('./computer');
const { resolveLang } = require('../lang');

const TIERS = ['normal', 'bigger', 'max'];

// one-time questions to you (consent, her questions mid-task): answered only by your click
function createAsker(send, timers = { setTimeout, clearTimeout }) {
  const pending = new Map();
  return {
    ask(kind, payload, { timeoutMs = 120000, otherwise = null } = {}) {
      const id = crypto.randomUUID();
      return new Promise((resolve) => {
        const timer = timers.setTimeout(() => { pending.delete(id); send('brain:gone', { id }); resolve(otherwise); }, timeoutMs);
        pending.set(id, { resolve, timer });
        send('brain:ask', { id, kind, ...payload });
      });
    },
    answer(id, value) {
      const p = pending.get(id);
      if (!p) return false;
      pending.delete(id);
      timers.clearTimeout(p.timer);
      p.resolve(value);
      return true;
    },
    cancelAll(value = null) {
      for (const [id, p] of pending) {
        timers.clearTimeout(p.timer);
        send('brain:gone', { id });
        p.resolve(value);
      }
      pending.clear();
    },
  };
}

// media through playerctl when it's there (MPRIS), for the media tool
function playerctl(action) {
  const args = { play_pause: ['play-pause'], next: ['next'], previous: ['previous'], stop: ['stop'], status: ['metadata', '--format', '{{status}}: {{artist}} - {{title}}'] }[action];
  return new Promise((resolve) => execFile('playerctl', args, { timeout: 3000 }, (err, out) => resolve(err ? null : (action === 'status' ? String(out).trim() : 'OK'))));
}

function createHub({ config, secrets, send, shell, capture, x11, grabEscape, dataDir, onReminder, media = playerctl, makeClaude = null, bond = null }) {
  const asker = createAsker(send);
  let claude = null;
  let computer = null; // { controller } while she has the controls

  const cfg = () => config.load();
  const claudeFor = () => {
    const key = secrets.load();
    const id = key ? crypto.createHash('sha256').update(key).digest('hex').slice(0, 8) : 'env';
    if (!claude || claude.id !== id) claude = { id, brain: makeClaude ? makeClaude() : claudeBrain({ apiKey: key }) };
    return claude.brain;
  };
  const picked = async (tier) => {
    const models = cfg().brainModels || {};
    if (tier === 'max') return models.max || DEFAULT_CLAUDE;
    if (models[tier]) return models[tier];
    // not picked yet: the smallest local model for normal, the biggest for bigger
    const list = await ollama.listModels().catch(() => []);
    if (!list.length) return null;
    return tier === 'bigger' ? list[list.length - 1].id : list[0].id;
  };

  // reminders: kept on disk so a restart doesn't lose them
  const remindersFile = path.join(dataDir, 'reminders.json');
  const reminders = (() => { try { return JSON.parse(fs.readFileSync(remindersFile, 'utf8')); } catch { return []; } })();
  const saveReminders = () => { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(remindersFile, JSON.stringify(reminders)); };
  const arm = (r) => setTimeout(() => {
    const i = reminders.indexOf(r);
    if (i >= 0) reminders.splice(i, 1);
    saveReminders();
    onReminder(r.text);
  }, Math.max(0, r.at - Date.now()));
  reminders.forEach(arm);

  async function useComputer(task) {
    if (!cfg().computerUse) return { started: false, reason: 'Using the computer is off: turn on "Let her use my computer" in my Mainframe first.' };
    if (cfg().brain !== 'max') return { started: false, reason: 'Using the computer needs my Max intelligence brain (Claude).' };
    if (!x11?.hasInput) return { started: false, reason: 'I can\'t reach your mouse and keyboard here (computer use needs an X11 session).' };
    if (computer) return { started: false, reason: 'I\'m already on a task.' };
    const yes = await asker.ask('consent', { task }, { otherwise: 'no' });
    if (yes !== 'start') return { started: false, reason: 'You said no, so I didn\'t touch anything.' };
    const controller = new AbortController();
    computer = { controller };
    const hands = await x11.input();
    const release = grabEscape(() => controller.abort());
    send('computer:start', { task });
    const model = await picked('max');
    runComputerTask({
      brain: claudeFor(), model, task, screen: capture, input: hands, signal: controller.signal,
      askUser: (question) => asker.ask('question', { question }, { otherwise: 'No answer: don\'t do it.' }),
      onStep: (step) => send('computer:step', step),
    }).then((out) => send('computer:end', out), (err) => send('computer:end', { outcome: controller.signal.aborted ? 'stopped' : 'error', text: err.message }))
      .finally(() => {
        release();
        asker.cancelAll('Stopped.');
        computer = null;
      });
    return { started: true };
  }

  const actions = createActions({
    openExternal: (url) => shell.openExternal(url),
    openPath: (p) => shell.openPath(p),
    media,
    remind: (minutes, text) => {
      const r = { at: Date.now() + minutes * 60000, text };
      reminders.push(r);
      saveReminders();
      arm(r);
    },
    lookAtScreen: () => capture.capture().catch(() => null),
    useComputer,
  });

  let brainNow = { brain: ollama, model: null, key: 'none' };
  const chat = createChat({
    getBrain: () => brainNow,
    actions,
    onEvent: (e) => send('chat:event', e),
    // who she is to you: what she calls you, what you asked her to remember, how close you are
    persona: () => ({ user: cfg().userName || 'you', memories: cfg().memories || [], stage: bond?.stage() || null, days: bond?.days() || 0, lang: resolveLang(cfg().lang) }),
  });

  // "call me …", "remember that …", "forget everything": hers to answer, no model needed. Each one
  // starts a fresh conversation (her history is append-only, and who she is just changed).
  const reply = (text) => {
    send('chat:event', { type: 'start' });
    send('chat:event', { type: 'delta', text });
    send('chat:event', { type: 'done', text });
  };
  function yours(text) {
    let m = /^\s*call me\s+(.{1,40}?)[.!]?\s*$/i.exec(text);
    if (m) {
      config.save({ userName: m[1] });
      chat.reset();
      reply(`Got it, ${m[1]}.`);
      return true;
    }
    m = /^\s*remember(?:\s+that)?\s+(.{3,200}?)[.!]?\s*$/i.exec(text);
    if (m) {
      const list = cfg().memories || [];
      if (!list.includes(m[1])) config.save({ memories: [...list, m[1]].slice(-30) });
      chat.reset();
      reply('Noted. I\'ll remember that.');
      return true;
    }
    if (/^\s*forget (?:everything|it all)[.!]?\s*$/i.test(text)) {
      config.save({ memories: [] });
      chat.reset();
      reply('Forgotten. Clean slate.');
      return true;
    }
    return false;
  }

  return {
    async status() {
      const c = cfg();
      return {
        brain: c.brain, models: c.brainModels || {}, computerUse: Boolean(c.computerUse),
        hasKey: secrets.has(), keyring: secrets.keyringOk(), canUseComputer: Boolean(x11?.hasInput), working: Boolean(computer),
      };
    },
    async listModels(tier) {
      if (tier === 'max') return claudeFor().listModels();
      return ollama.listModels();
    },
    set(patch) {
      const out = {};
      if (TIERS.includes(patch.brain)) out.brain = patch.brain;
      if (patch.model && TIERS.includes(patch.tier)) out.brainModels = { ...(cfg().brainModels || {}), [patch.tier]: String(patch.model).slice(0, 200) };
      if (typeof patch.computerUse === 'boolean') out.computerUse = patch.computerUse;
      config.save(out);
      return this.status();
    },
    saveKey: (key) => { secrets.save(key); claude = null; },
    clearKey: () => { secrets.clear(); claude = null; },
    async send(text) {
      bond?.credit('chat');
      if (yours(String(text))) return;
      const tier = cfg().brain;
      const model = await picked(tier);
      if (!model) {
        send('chat:event', { type: 'error', text: 'No local model yet: install Ollama and pull one (ollama pull llama3.2), or pick my Max intelligence brain.' });
        return;
      }
      brainNow = { brain: tier === 'max' ? claudeFor() : ollama, model, key: `${tier}:${model}` };
      await chat.send(text);
    },
    stop: () => chat.stop(),
    reset: () => chat.reset(),
    answer: (id, value) => asker.answer(id, value),
    useComputer,
    stopComputer: () => computer?.controller.abort(),
  };
}

module.exports = { createHub, createAsker, TIERS };
