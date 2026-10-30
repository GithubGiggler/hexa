'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { noticeFor, createNotices } = require('../src/main/notices');

const CWD = '/home/you/projects/penguin-api';

test('Claude needs you: the permission prompt and the question dialogs', () => {
  assert.deepEqual(noticeFor({ hook_event_name: 'Notification', notification_type: 'permission_prompt', cwd: CWD, message: 'Claude needs your permission to use Bash' }),
    { kind: 'alert', title: 'Claude needs you', body: 'penguin-api: Claude needs your permission to use Bash' });
  assert.equal(noticeFor({ hook_event_name: 'Notification', notification_type: 'elicitation_dialog', cwd: CWD }).title, 'Claude has a question');
  assert.equal(noticeFor({ hook_event_name: 'Notification', notification_type: 'idle_prompt', cwd: CWD }), null);
});

test('a job done, and a failed Bash command (not one you interrupted)', () => {
  assert.deepEqual(noticeFor({ hook_event_name: 'Stop', cwd: CWD, last_assistant_message: 'secret plans' }), { kind: 'done', title: 'Claude is done', body: 'penguin-api' });
  assert.deepEqual(noticeFor({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'npm test' }, cwd: CWD }),
    { kind: 'failed', title: 'A command failed', body: 'penguin-api: npm test' });
  assert.equal(noticeFor({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'x', description: 'Run the tests' } }).body, 'Run the tests');
  assert.equal(noticeFor({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', is_interrupt: true }), null);
  assert.equal(noticeFor({ hook_event_name: 'PostToolUseFailure', tool_name: 'Edit' }), null);
});

test('everything else, and the demo, is not worth a notification', () => {
  for (const name of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'SessionStart', 'SessionEnd', 'SubagentStop', 'HexaSay']) {
    assert.equal(noticeFor({ hook_event_name: name, cwd: CWD }), null, name);
  }
  assert.equal(noticeFor({ hook_event_name: 'Stop', demo: true }), null);
  assert.equal(noticeFor(null), null);
});

test('the reply text never goes into a notification', () => {
  const n = noticeFor({ hook_event_name: 'Stop', cwd: CWD, last_assistant_message: 'the API key is hunter2' });
  assert.ok(!JSON.stringify(n).includes('hunter2'));
});

test('other assistants by name', () => {
  assert.equal(noticeFor({ hook_event_name: 'Stop', assistant: 'codex' }).title, 'Codex is done');
});

function rig(isAway = true) {
  const sent = [];
  let next = 100;
  let awayNow = isAway;
  const notices = createNotices({
    notify: async (n) => { sent.push(n); return n.replaces || ++next; },
    away: () => awayNow,
  });
  return { notices, sent, setAway: (v) => { awayNow = v; } };
}

test('while she’s here and Do Not Disturb is off: nothing', async () => {
  const { notices, sent } = rig(false);
  assert.equal(await notices.see({ hook_event_name: 'Stop', session_id: 'a' }), null);
  assert.deepEqual(sent, []);
});

test('while she’s away: one notification, with Show and only Show, never critical', async () => {
  const { notices, sent } = rig(true);
  const id = await notices.see({ hook_event_name: 'Notification', notification_type: 'permission_prompt', session_id: 'a', cwd: CWD, message: 'Claude needs your permission to use Bash' });
  assert.equal(id, 101);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].actions, [{ id: 'show', label: 'Show' }]);
  assert.equal(sent[0].defaultAction, 'show');
  assert.equal(sent[0].urgency, 'normal');
  assert.equal(sent[0].replaces, 0);
  assert.ok(!JSON.stringify(sent[0]).match(/allow|approve|deny/i));
});

test('a session’s newer news replaces its older; another session gets its own', async () => {
  const { notices, sent } = rig(true);
  const first = await notices.see({ hook_event_name: 'Notification', notification_type: 'permission_prompt', session_id: 'a' });
  await notices.see({ hook_event_name: 'Stop', session_id: 'a' });
  await notices.see({ hook_event_name: 'Stop', session_id: 'b' });
  assert.equal(sent[1].replaces, first);
  assert.equal(sent[2].replaces, 0);
  await notices.see({ hook_event_name: 'SessionEnd', session_id: 'a' });
  await notices.see({ hook_event_name: 'Stop', session_id: 'a' });
  assert.equal(sent[3].replaces, 0);
});

test('a notification that could not be sent is not remembered', async () => {
  const sent = [];
  const notices = createNotices({ notify: async (n) => { sent.push(n); return null; }, away: () => true });
  await notices.see({ hook_event_name: 'Stop', session_id: 'a' });
  await notices.see({ hook_event_name: 'Stop', session_id: 'a' });
  assert.equal(sent[1].replaces, 0);
});

test('only the assistant she watches brings news, named as itself', async () => {
  const sent = [];
  const { ownerOf } = require('../src/main/hooks');
  const notices = createNotices({ notify: async (n) => { sent.push(n); return 1; }, away: () => true, follows: (evt) => ownerOf(evt) === 'codex' });
  assert.equal(await notices.see({ hook_event_name: 'Stop', session_id: 'claude-session', assistant: 'claude', cwd: CWD }), null);
  await notices.see({ hook_event_name: 'Stop', session_id: 'codex:abc', assistant: 'codex', cwd: CWD });
  assert.deepEqual(sent.map((n) => n.title), ['Codex is done']);
  assert.equal(noticeFor({ hook_event_name: 'Notification', notification_type: 'permission_prompt', assistant: 'agy' }).title, 'Antigravity needs you');
});
