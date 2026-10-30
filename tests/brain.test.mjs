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

test('the alert clears even if Hexa is mid-move toward the pointer', () => {
  const { brain, hexa } = rig();
  brain.handle(evt('UserPromptSubmit', { prompt: 'x' }));
  brain.handle(evt('Notification', { notification_type: 'permission_prompt' }));
  hexa.mode = 'teleport';
  hexa.alerting = true;
  brain.handle(evt('PermissionDenied', { tool_name: 'Bash' })); // an event that doesn't set a mode itself
  assert.equal(hexa.mode, 'work');
});

test("Claude's window comes from the hook's process tree, else the window in front at the prompt", () => {
  const { brain } = rig();
  brain.onWindows({ fg: 70, wins: [] });
  brain.handle(evt('UserPromptSubmit', { prompt: 'x', window_id: 55 }));
  assert.equal(brain.sessions.get('s1').window, 55);
  brain.handle({ ...evt('UserPromptSubmit', { prompt: 'y' }), session_id: 's2' });
  assert.equal(brain.sessions.get('s2').window, 70);
});

test('an answer that lands while you are on another window is shown whole, until you are back', async () => {
  const { brain, said, calls, clock } = rig();
  clock.set(0);
  brain.onWindows({ fg: 55, wins: [] });
  brain.handle(evt('UserPromptSubmit', { prompt: 'x', window_id: 55 }));
  brain.onWindows({ fg: 99, wins: [] }); // you went elsewhere
  clock.set(5000);
  await brain.handle(evt('Stop', { last_assistant_message: 'Done.\n\n- one\n- two' }));
  const msg = said.at(-1);
  assert.equal(msg.kind, 'done');
  assert.equal(msg.reply, 'Done.\n\n- one\n- two');
  assert.equal(msg.hold, null);
  brain.onWindows({ fg: 55, wins: [] }); // back on Claude's window
  assert.ok(calls.some((c) => c[0] === 'clearKind' && c[1] === 'done'));
});

test('on Claude\'s own window, the answer is just the short line', async () => {
  const { brain, said, clock } = rig();
  clock.set(0);
  brain.onWindows({ fg: 55, wins: [] });
  brain.handle(evt('UserPromptSubmit', { prompt: 'x', window_id: 55 }));
  clock.set(5000);
  await brain.handle(evt('Stop', { last_assistant_message: 'All done here.' }));
  assert.equal(said.at(-1).reply, undefined);
});

test("a permission prompt while you're on another window: she points at Claude's window instead", () => {
  const { brain, hexa, calls } = rig();
  hexa.canPoint = () => true;
  hexa.pointAt = (...a) => { calls.push(['pointAt', ...a]); return Promise.resolve(true); };
  hexa.stopPointing = () => calls.push(['stopPointing']);
  brain.onWindows({ fg: 55, wins: [{ id: 55, x: 100, y: 100, w: 800, h: 600, max: false }] });
  brain.handle(evt('UserPromptSubmit', { prompt: 'x', window_id: 55 }));
  brain.onWindows({ fg: 99, wins: [{ id: 99, x: 1000, y: 100, w: 800, h: 600, max: false }, { id: 55, x: 100, y: 100, w: 800, h: 600, max: false }] });
  brain.handle(evt('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }));
  const point = calls.find((c) => c[0] === 'pointAt');
  assert.ok(point, 'pointed');
  assert.equal(point[1].id, 55);
  assert.equal(point[2].label, 'CLAUDE');
  assert.ok(!calls.some((c) => c[0] === 'comeToPointer'));
  brain.handle(evt('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }));
  assert.ok(calls.some((c) => c[0] === 'stopPointing'), 'lets go once answered');
});

test("claudeWindow is the window of the session you talked to last", () => {
  const { brain, clock } = rig();
  brain.onWindows({ fg: 55, wins: [{ id: 55, x: 0, y: 0, w: 500, h: 400 }, { id: 66, x: 600, y: 0, w: 500, h: 400 }] });
  clock.set(0);
  brain.handle(evt('UserPromptSubmit', { prompt: 'a', window_id: 55 }));
  clock.set(1000);
  brain.handle({ ...evt('UserPromptSubmit', { prompt: 'b', window_id: 66 }), session_id: 's2' });
  assert.equal(brain.claudeWindow().id, 66);
});

// ---- final review fixes: turns that end without a Stop, and sleep/resume ----

test('an interrupted tool ends the turn: no thinking counter, she goes idle', () => {
  const { brain, panel, calls, clock } = rig();
  clock.set(0);
  brain.handle(evt('UserPromptSubmit', { prompt: 'x' }));
  brain.handle(evt('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'sleep 99' } }));
  brain.handle(evt('PostToolUseFailure', { tool_name: 'Bash', is_interrupt: true }));
  assert.equal(brain.sessions.get('s1').working, false);
  assert.ok(calls.some((c) => c[0] === 'setMode' && c[1] === 'idle'));
  clock.set(60000);
  brain.tick();
  assert.notEqual(panel.ticker?.state, 'thinking');
});

test("Claude's idle prompt ends the turn and clears an unanswered alert", () => {
  const { brain, calls } = rig();
  brain.handle(evt('UserPromptSubmit', { prompt: 'x' }));
  brain.handle(evt('Notification', { notification_type: 'permission_prompt' }));
  brain.handle(evt('Notification', { notification_type: 'idle_prompt' }));
  const s = brain.sessions.get('s1');
  assert.equal(s.working, false);
  assert.equal(s.waiting, false);
  assert.ok(calls.some((c) => c[0] === 'clearKind' && c[1] === 'alert'));
});

test('a session silent for 30 minutes stops counting as working', () => {
  const { brain, panel, clock } = rig();
  clock.set(0);
  brain.handle(evt('UserPromptSubmit', { prompt: 'x' }));
  for (let t = 1000; t <= 31 * 60 * 1000; t += 1000) {
    clock.set(t);
    brain.tick();
  }
  assert.equal(brain.sessions.get('s1').working, false);
  assert.equal(panel.ticker, null);
});

test('a tick that comes after a long gap (the PC slept) restarts the quiet timers by itself', () => {
  const { brain, panel, said, clock } = rig();
  clock.set(0);
  brain.handle(evt('UserPromptSubmit', { prompt: 'x' }));
  clock.set(1000);
  brain.handle(evt('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/a' } }));
  brain.tick();
  const before = said.length;
  clock.set(3_600_000); // the tick fires before the resume signal arrives
  brain.tick();
  assert.equal(said.length, before, 'no thinking lines');
  assert.notEqual(panel.ticker?.state, 'thinking');
});

test('resume() puts the real ticker back if the thinking one was showing', () => {
  const { brain, panel, clock } = rig();
  clock.set(0);
  brain.handle(evt('UserPromptSubmit', { prompt: 'x' }));
  brain.handle(evt('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/a/b.ts' } }));
  for (let t = 1000; t <= 20000; t += 1000) {
    clock.set(t);
    brain.tick();
  }
  assert.equal(panel.ticker.state, 'thinking');
  brain.resume();
  assert.deepEqual(panel.ticker, { verb: 'READS', target: 'b.ts', state: 'work' });
});

test('the first-contact line stays up: the same event does not wipe it with its own line', () => {
  const { brain, said } = rig();
  brain.linked = false;
  brain.handle(evt('SessionStart', { source: 'startup' }));
  assert.match(said.at(-1).line, /connected/i, 'the last thing said is that she can see Claude');
  assert.equal(said.filter((m) => /connected/i.test(m.line)).length, 1);
});

test('a missed Read or Edit is not a crash: no knockback, just the ticker', () => {
  const { brain, calls, played, panel } = rig();
  brain.handle(evt('PostToolUseFailure', { tool_name: 'Edit', tool_input: { file_path: '/p/a.ts' }, error: 'String to replace not found in file.' }));
  assert.ok(!calls.some((c) => c[0] === 'knockback'));
  assert.ok(!played.includes('error'));
  assert.equal(panel.ticker.state, 'error');
});

test('the HUD gets what it needs: an error flag, when she finished, how long it took, the last answer', () => {
  const { brain, clock } = rig();
  clock.set(1000);
  brain.handle(evt('UserPromptSubmit', { prompt: 'x' }));
  brain.handle(evt('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } }));
  brain.handle(evt('PostToolUseFailure', { tool_name: 'Bash', error: 'Error: 3 failed' }));
  const s = brain.sessions.get('s1');
  assert.equal(s.error, true);
  brain.handle(evt('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/p/a.ts' } }));
  assert.equal(s.error, false, 'it moved on');
  clock.set(61000);
  brain.handle(evt('Stop', { last_assistant_message: 'Fixed the three tests.' }));
  assert.equal(s.doneAt, 61000);
  assert.equal(s.lastDuration, 60000);
  assert.equal(s.reply, 'Fixed the three tests.');
});

test('focusSession: she points at that session\'s window and brings its last answer', () => {
  const { brain, hexa, said } = rig();
  const pointed = [];
  hexa.canPoint = () => true;
  hexa.pointAt = (rect, opts) => { pointed.push([rect.id, opts.label]); return Promise.resolve(true); };
  brain.onWindows({ fg: 9, wins: [{ id: 7, x: 100, y: 100, w: 800, h: 600 }, { id: 9, x: 1000, y: 100, w: 800, h: 600 }] });
  brain.handle(evt('UserPromptSubmit', { prompt: 'x', window_id: 7 }));
  brain.handle(evt('Stop', { last_assistant_message: 'All done here.' }));
  brain.focusSession('s1');
  assert.deepEqual(pointed, [[7, 'penguin-api']]);
  assert.equal(said.at(-1).reply, 'All done here.');
  assert.equal(brain.focusSession('nope'), false);
});

test('pointing from the HUD stops by itself a few seconds later', () => {
  const { brain, hexa, clock } = rig();
  let stopped = 0;
  hexa.canPoint = () => true;
  hexa.pointAt = () => Promise.resolve(true);
  hexa.stopPointing = () => { stopped++; };
  brain.onWindows({ fg: 9, wins: [{ id: 7, x: 100, y: 100, w: 800, h: 600 }] });
  brain.handle(evt('UserPromptSubmit', { prompt: 'x', window_id: 7 }));
  brain.focusSession('s1');
  clock.set(5000); brain.tick();
  assert.equal(stopped, 0);
  clock.set(6500); brain.tick();
  assert.equal(stopped, 1);
});

test('a long job: the victory, then her Fork', async () => {
  const { brain, hexa, clock } = rig();
  let forked = 0;
  hexa.fork = () => { forked++; return Promise.resolve(true); };
  brain.handle(evt('UserPromptSubmit', { prompt: 'x' }));
  for (let i = 0; i < 50; i++) brain.handle(evt('PreToolUse', { tool_name: 'Read', tool_input: { file_path: `/p/${i}.ts` } }));
  clock.set(60000);
  await brain.handle(evt('Stop', { last_assistant_message: 'Done.' }));
  assert.equal(forked, 1);
  const short = rig();
  short.hexa.fork = () => { forked++; return Promise.resolve(true); };
  short.brain.handle(evt('UserPromptSubmit', { prompt: 'x' }));
  for (let i = 0; i < 5; i++) short.brain.handle(evt('PreToolUse', { tool_name: 'Read', tool_input: { file_path: `/p/${i}.ts` } }));
  short.clock.set(60000);
  await short.brain.handle(evt('Stop', { last_assistant_message: 'Done.' }));
  assert.equal(forked, 1, 'a short job: no Fork');
});

const CARD = { id: 'p-1', session_id: 's1', cwd: '/home/u/projects/penguin-api', project: 'penguin-api', tool_name: 'Bash', tool_input: { command: 'npm test' }, canAlways: true, always: 'Bash(npm test)', waitMs: 10000 };

test('a permission request: she comes to you with a card (Allow, Always allow, Deny, Ask in Claude)', () => {
  const { brain, calls, said, played } = rig();
  const answers = [];
  brain.answerPermission = (id, choice) => answers.push([id, choice]);
  brain.onPermissionAsk(CARD);
  assert.ok(has(calls, 'comeToPointer'));
  assert.ok(played.includes('alert'));
  const card = said.at(-1);
  assert.equal(card.kind, 'alert');
  assert.equal(card.quote, 'RUNS npm test');
  assert.deepEqual(card.actions.map((a) => a.id), ['allow', 'always', 'deny', 'ask']);
  assert.match(card.actions[1].label, /Bash\(npm test\)/);
  card.onAction('allow');
  assert.deepEqual(answers, [['p-1', 'allow']]);
  // the panel closed without a choice (clicked away): Claude asks as usual
  const again = rig();
  const a2 = [];
  again.brain.answerPermission = (id, choice) => a2.push([id, choice]);
  again.brain.onPermissionAsk(CARD);
  again.said.at(-1).onDismiss();
  assert.deepEqual(a2, [['p-1', 'ask']]);
});

test('no Always allow button without a suggestion', () => {
  const { brain, said } = rig();
  brain.onPermissionAsk({ ...CARD, canAlways: false, always: '' });
  assert.deepEqual(said.at(-1).actions.map((a) => a.id), ['allow', 'deny', 'ask']);
});

test('with her card up, the permission Notification doesn\'t alert twice; the card going ends the wait', () => {
  const { brain, calls, panel } = rig();
  brain.onPermissionAsk(CARD);
  const before = calls.filter((c) => c[0] === 'comeToPointer').length;
  brain.handle(evt('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }));
  assert.equal(calls.filter((c) => c[0] === 'comeToPointer').length, before);
  brain.onPermissionGone('p-1');
  assert.ok(calls.some((c) => c[0] === 'clearKind' && c[1] === 'alert'));
  assert.equal(brain.sessions.get('s1').waiting, false);
  assert.ok(panel);
});

test('Do Not Disturb: Claude needing you lights her up, but she doesn\'t come or make a sound', () => {
  const { brain, hexa, calls, played } = rig();
  let waiting = null;
  hexa.markWaiting = (on) => { waiting = on; };
  brain.quiet = true;
  brain.handle(evt('UserPromptSubmit', { prompt: 'x' }));
  brain.handle(evt('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission' }));
  assert.equal(waiting, true);
  assert.ok(!has(calls, 'comeToPointer'));
  assert.ok(!played.includes('alert'));
  brain.handle(evt('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }));
  assert.equal(waiting, false, 'answered: she goes back to normal');
});

test('a permission card that goes unanswered gives her ticker back (no WAITING left behind)', () => {
  const { brain, panel } = rig();
  brain.handle(evt('UserPromptSubmit', { prompt: 'x' }));
  brain.handle(evt('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/p/a.ts' } }));
  brain.onPermissionAsk(CARD);
  assert.equal(panel.ticker.state, 'waiting');
  brain.onPermissionGone('p-1');
  assert.deepEqual(panel.ticker, { verb: 'READS', target: 'a.ts', state: 'work' }, 'back to what Claude was doing');
  const idle = rig();
  idle.brain.answerPermission = () => {};
  idle.brain.onPermissionAsk(CARD);
  idle.said.at(-1).onAction('deny');
  assert.equal(idle.panel.ticker, null, 'nothing going on: no ticker');
});

test('another AI in front for 20 s: she notices, once in a while, and not under Do Not Disturb', () => {
  const { brain, clock } = rig();
  const noticed = [];
  brain.onJealous = (ai) => noticed.push(ai);
  brain.onWindows({ fg: 3, fgAi: 'chatgpt', wins: [] });
  clock.set(10000); brain.tick();
  assert.deepEqual(noticed, []);
  clock.set(21000); brain.tick();
  assert.deepEqual(noticed, ['chatgpt']);
  clock.set(60000); brain.tick();
  assert.deepEqual(noticed, ['chatgpt'], 'not again soon');
  brain.onWindows({ fg: 4, fgAi: 'claude', wins: [] }); // the one she watches isn't a rival
  clock.set(15 * 60000); brain.tick();
  assert.deepEqual(noticed, ['chatgpt']);
  const quiet = rig();
  quiet.brain.quiet = true;
  const n2 = [];
  quiet.brain.onJealous = (ai) => n2.push(ai);
  quiet.brain.onWindows({ fg: 3, fgAi: 'gemini', wins: [] });
  quiet.clock.set(30000); quiet.brain.tick();
  assert.deepEqual(n2, []);
});
