'use strict';

// Live check of answering permissions from her: the real permission hook asks, her card comes up
// with its buttons, a real click on Allow (X input) answers, and the hook prints the allow
// decision. Then: no click at all, and the hook prints nothing once her wait is over.
//
//   tools/live/hidden-desktop.sh node tools/live/permission.js

const path = require('node:path');
const { spawn } = require('node:child_process');
const { wait, state, startHexa, display, checks, root } = require('./lib');

const HOOK = path.join(root, 'hooks', 'hexa-permission-hook.js');
const INPUT = {
  hook_event_name: 'PermissionRequest', session_id: 'live', cwd: '/home/you/projects/penguin-api',
  tool_name: 'Bash', tool_input: { command: 'npm test' },
  permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }], behavior: 'allow', destination: 'localSettings' }],
};

function hook() {
  const child = spawn(process.execPath, [HOOK]);
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  const done = new Promise((resolve) => child.on('close', (code) => resolve({ code, out })));
  child.stdin.end(JSON.stringify(INPUT));
  return done;
}

(async () => {
  const { check, error, report } = checks();
  const hexa = await startHexa();
  const d = await display();
  try {
    await wait(3000); // her boot line typed out
    const asked = hook();
    // she comes to your pointer first: read the buttons once her card has stopped moving
    let s = await state();
    let last = '';
    for (let i = 0; i < 20; i++) {
      await wait(300);
      s = await state();
      const now = JSON.stringify(s.buttons);
      if (s.buttons.length && now === last && s.mode === 'alert') break;
      last = now;
    }
    const ids = s.buttons.map((b) => b.id);
    check('her card is up with its buttons', ids.join(',') === 'allow,always,deny,ask', ids.join(','));
    const allow = s.buttons.find((b) => b.id === 'allow');
    if (allow) {
      const [x, y, w, h] = allow.rect;
      d.move(s.display.x + x + w / 2, s.display.y + y + h / 2); await d.sync(); await wait(250);
      d.press(1); await d.sync(); await wait(60); d.release(1); await d.sync();
    }
    const r = await Promise.race([asked, wait(5000).then(() => null)]);
    let decision = null;
    try { decision = JSON.parse(r?.out || 'null')?.hookSpecificOutput?.decision; } catch { /* no output */ }
    check('a real click on Allow: the hook prints allow', decision?.behavior === 'allow', r ? `exit ${r.code}, ${r.out || 'no output'}` : 'still waiting');
    s = await state();
    check('the card is gone', s.buttons.length === 0);

    const started = Date.now();
    const unanswered = await hook();
    const secs = Math.round((Date.now() - started) / 1000);
    check('no click: after her wait, no output (Claude asks as usual)', unanswered.code === 0 && unanswered.out === '' && secs >= 9 && secs <= 13, `${secs} s, output "${unanswered.out}"`);
    s = await state();
    check('and that card is gone too', s.buttons.length === 0);
  } catch (err) {
    error(err);
  }
  d.close();
  await hexa.stop();
  report();
})();
