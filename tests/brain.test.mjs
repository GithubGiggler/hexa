import test from 'node:test';
import assert from 'node:assert/strict';
import { Brain, firstErrorLine } from '../src/renderer/js/brain.js';

// Stand-ins that record what the Brain asks of Hexa, her panel and her voice.
function rig() {
  const calls = [];
  const hexa = {
    mode: 'idle',
    setMode(m) { this.mode = m; calls.push(['setMode', m]); },
    comeToPointer() { this.mode = 'alert'; calls.push(['comeToPointer']); },
    celebrate(summary) { calls.push(['celebrate', summary]); return Promise.resolve(); },
  };
  for (const k of ['wake', 'attend', 'perform', 'goToWork', 'towardCenter', 'knockback', 'spark']) {
    hexa[k] = (...a) => calls.push([k, ...a]);
  }
  const said = [];
  const panel = {
    ticker: undefined,
    say(msg) { said.push(msg); return said.length; },
    setTicker(t) { this.ticker = t; calls.push(['ticker', t]); },
    clearKind(kind) { calls.push(['clearKind', kind]); },
  };
  const played = [];
  const voice = { play: (n) => played.push(n) };
  let t = 0;
  const clock = { set: (v) => { t = v; }, now: () => t };
  const brain = new Brain({ hexa, panel, voice, lang: 'en', now: clock.now });
  brain.linked = true;
  return { brain, hexa, panel, voice, calls, said, played, clock };
}

const evt = (hook_event_name, extra = {}) => ({ hook_event_name, session_id: 's1', cwd: '/home/u/projects/penguin-api', ...extra });
const has = (calls, name) => calls.some((c) => c[0] === name);

test('prompt → goToWork and a work line with the quote', () => {
  const { brain, calls, said } = rig();
  brain.handle(evt('UserPromptSubmit', { prompt: 'Add a /search endpoint' }));
  assert.ok(has(calls, 'goToWork'));
  assert.equal(said.at(-1).kind, 'work');
  assert.equal(said.at(-1).quote, 'Add a /search endpoint');
  assert.equal(said.at(-1).tag, 'penguin-api');
});

test('PreToolUse Edit → ticker EDITS gigs.ts and the file counted', () => {
  const { brain, panel, hexa } = rig();
  brain.handle(evt('UserPromptSubmit', { prompt: 'x' }));
  brain.handle(evt('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: '/p/src/gigs.ts' } }));
  assert.deepEqual(panel.ticker, { verb: 'EDITS', target: 'gigs.ts', state: 'work' });
  assert.equal(brain.sessions.get('s1').files.size, 1);
  assert.equal(brain.sessions.get('s1').count, 1);
  assert.equal(hexa.mode, 'work');
});

test('Bash and web tools make her spark', () => {
  const { brain, calls } = rig();
  brain.handle(evt('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }));
  assert.ok(has(calls, 'spark'));
});

test('firstErrorLine finds the line that matters', () => {
  assert.equal(firstErrorLine("\u001b[31mnpm ERR! code 1\u001b[0m\nError: Cannot find module 'zod'\n    at x"), "Error: Cannot find module 'zod'");
  assert.equal(firstErrorLine('Exit code 1\nsomething odd\nlast words'), 'last words');
  assert.equal(firstErrorLine(''), '');
});

test('Bash failure → knockback and the meaningful error line', () => {
  const { brain, calls, said, played } = rig();
  brain.handle(evt('PostToolUseFailure', {
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
    error: "\u001b[31mnpm ERR! code 1\u001b[0m\nError: Cannot find module 'zod'\n    at x",
  }));
  assert.ok(has(calls, 'knockback'));
  assert.ok(played.includes('error'));
  const msg = said.at(-1);
  assert.equal(msg.kind, 'error');
  assert.ok(`${msg.line} ${msg.quote}`.includes("Error: Cannot find module 'zod'"));
});

test('an interrupted tool says so, without the knockback', () => {
  const { brain, calls, said } = rig();
  brain.handle(evt('PostToolUseFailure', { tool_name: 'Bash', is_interrupt: true }));
  assert.ok(!has(calls, 'knockback'));
  assert.equal(said.at(-1).kind, 'info');
});

test('Notification permission_prompt → alert, comeToPointer, voice alert', () => {
  const { brain, calls, said, played, hexa } = rig();
  brain.handle(evt('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }));
  assert.ok(has(calls, 'comeToPointer'));
  assert.ok(played.includes('alert'));
  assert.equal(said.at(-1).kind, 'alert');
  assert.equal(said.at(-1).quote, 'Claude needs your permission to use Bash');
  assert.equal(hexa.mode, 'alert');
  assert.equal(brain.sessions.get('s1').waiting, true);
});

test('the next event after an alert clears it', () => {
  const { brain, calls, hexa } = rig();
  brain.handle(evt('UserPromptSubmit', { prompt: 'x' }));
  brain.handle(evt('Notification', { notification_type: 'permission_prompt' }));
  brain.handle(evt('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git push' } }));
  assert.ok(calls.some((c) => c[0] === 'clearKind' && c[1] === 'alert'));
  assert.equal(brain.sessions.get('s1').waiting, false);
  assert.equal(hexa.mode, 'work');
});

test('Stop → celebrate with "3 actions · 1 file changed · 2m 14s"', async () => {
  const { brain, calls, said, clock } = rig();
  clock.set(0);
  brain.handle(evt('UserPromptSubmit', { prompt: 'x' }));
  brain.handle(evt('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/p/a.ts' } }));
  brain.handle(evt('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: '/p/a.ts' } }));
  brain.handle(evt('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } }));
  clock.set(134000);
  await brain.handle(evt('Stop', { last_assistant_message: 'I added **GET /search**. Six tests pass now.' }));
  const celebrate = calls.find((c) => c[0] === 'celebrate');
  assert.ok(celebrate, 'celebrated');
  assert.equal(celebrate[1], '3 actions · 1 file changed · 2m 14s');
  const done = said.at(-1);
  assert.equal(done.kind, 'done');
  assert.equal(done.summary, '3 actions · 1 file changed · 2m 14s');
  assert.equal(done.quote, 'Six tests pass now.');
});

test('a quick answer is quiet: no celebration', async () => {
  const { brain, calls, said, clock } = rig();
  clock.set(0);
  brain.handle(evt('UserPromptSubmit', { prompt: 'hi' }));
  clock.set(4000);
  await brain.handle(evt('Stop', { last_assistant_message: 'Hello!' }));
  assert.ok(!has(calls, 'celebrate'));
  assert.equal(said.at(-1).kind, 'done');
});

test('thinking: ticker counts after 15 s, line at 40 s, reassurance at 120 s, once each', () => {
  const { brain, panel, said, clock } = rig();
  clock.set(0);
  brain.handle(evt('UserPromptSubmit', { prompt: 'x' }));
  const before = said.length;
  clock.set(14000); brain.tick();
  assert.notEqual(panel.ticker?.state, 'thinking');
  clock.set(16000); brain.tick();
  assert.equal(panel.ticker.state, 'thinking');
  assert.equal(panel.ticker.seconds, 16);
  clock.set(41000); brain.tick(); brain.tick();
  assert.equal(said.length, before + 1);
  clock.set(121000); brain.tick(); brain.tick();
  assert.equal(said.length, before + 2);
  // any sign of life ends it
  brain.handle(evt('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/a' } }));
  brain.tick();
  assert.equal(panel.ticker.state, 'work');
});

test('resume() restarts the quiet timers (no "thinking" burst after sleep)', () => {
  const { brain, said, clock, panel } = rig();
  clock.set(0);
  brain.handle(evt('UserPromptSubmit', { prompt: 'x' }));
  clock.set(1000);
  brain.handle(evt('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/a' } }));
  const before = said.length;
  clock.set(3_600_000);
  brain.resume();
  clock.set(3_600_500);
  brain.tick();
  assert.equal(said.length, before);
  assert.notEqual(panel.ticker?.state, 'thinking');
});

test('codex sessions ignored while watching claude; demo events always handled', () => {
  const { brain, said } = rig();
  brain.handle({ hook_event_name: 'UserPromptSubmit', session_id: 'codex:abc', prompt: 'x' });
  assert.equal(said.length, 0);
  brain.handle({ hook_event_name: 'UserPromptSubmit', session_id: 'codex:abc', prompt: 'x', demo: true });
  assert.equal(said.length, 1);
});

test('the first real event says she can see Claude, once', () => {
  const { brain, said } = rig();
  brain.linked = false;
  let linked = 0;
  brain.onLinked = () => { linked += 1; };
  brain.handle(evt('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/a' } }));
  brain.handle(evt('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/b' } }));
  assert.equal(linked, 1);
  assert.equal(said.filter((m) => /connected/i.test(m.line)).length, 1);
});

test('SessionEnd removes the session', () => {
  const { brain } = rig();
  brain.handle(evt('UserPromptSubmit', { prompt: 'x' }));
  assert.ok(brain.sessions.has('s1'));
  brain.handle(evt('SessionEnd', { reason: 'other' }));
  assert.ok(!brain.sessions.has('s1'));
});

test('status() is a line about the work, or an idle line', () => {
  const { brain, clock } = rig();
  assert.equal(typeof brain.status(), 'string');
  clock.set(0);
  brain.handle(evt('UserPromptSubmit', { prompt: 'x' }));
  brain.handle(evt('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/a' } }));
  clock.set(65000);
  assert.match(brain.status(), /penguin-api.*1 action.*1m 05s/);
});
