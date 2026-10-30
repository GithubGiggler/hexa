'use strict';

// Stages her best-known moments on the hidden desktop and captures each (her overlay only, with
// the test windows' rectangles noted), for the README: docs/images/*.png are made from these by
// tools/compose-shots.sh. Uses the scripted Claude for the chat.
//
//   HEXA_LIVE_DIR=<dir> tools/live/hidden-desktop.sh node tools/live/screenshots.js   (-> <dir>/shots)

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { downsTo, wait, state, post, request, startHexa, display, root } = require('./lib');

// into the hidden desktop's results folder (its /tmp is private): $HEXA_LIVE_DIR/shots outside
const out = path.join(path.dirname(process.env.XDG_STATE_HOME), 'shots');
const KEY = { Down: 116, Return: 36, Escape: 9 };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const run = process.env.XDG_RUNTIME_DIR;
  const confDir = path.join(process.env.XDG_CONFIG_HOME, 'hexa');
  fs.mkdirSync(confDir, { recursive: true });
  fs.writeFileSync(path.join(confDir, 'config.json'), JSON.stringify({ welcomed: true, linked: true, brain: 'max', wander: false, possess: false }));
  const script = path.join(run, 'fake-claude.json');
  fs.writeFileSync(script, JSON.stringify({ chat: [{ content: [{ type: 'text', text: 'Hi! Claude\'s been busy in penguin-api: 14 actions, 3 files. Want the short version?' }] }], computer: [] }));
  const hexa = await startHexa({ env: { HEXA_FAKE_CLAUDE: script } });
  const d = await display();
  const manifest = {};
  const shot = async (name, wins = []) => {
    const r = await request('GET', '/debug/capture');
    fs.copyFileSync(r.file, path.join(out, `${name}.png`));
    fs.rmSync(r.file, { force: true });
    manifest[name] = { wins, state: await state() };
    console.log('shot', name);
  };
  const rightClickHer = async () => {
    const s = await state();
    const b = s.hitRects[0];
    d.move(s.display.x + b[0] + b[2] / 2, s.display.y + b[1] + b[3] / 2); await d.sync(); await wait(200);
    d.press(3); await d.sync(); await wait(80); d.release(3); await d.sync(); await wait(700);
  };
  const pick = async (label) => {
    for (let n = await downsTo(label); n > 0; n--) { d.key(KEY.Down); await d.sync(); await wait(120); }
    d.key(KEY.Return); await d.sync();
  };
  try {
    await wait(3500);
    // a window to work in
    const W = d.open('claude', 700, 560, 1150, 620);
    await wait(900); d.activate(W); await wait(600);
    const win = { x: 700, y: 560, w: 1150, h: 620, title: 'claude — ~/projects/penguin-api' };

    await post({ session_id: 'one', cwd: '/home/you/projects/penguin-api', hook_event_name: 'UserPromptSubmit', prompt: 'Add a /search endpoint', window_id: W });
    await post({ session_id: 'one', cwd: '/home/you/projects/penguin-api', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/p/src/gigs.ts' } });
    await wait(3200);
    await shot('work', [win]);

    await post({ session_id: 'two', cwd: '/home/you/projects/penguin-web', hook_event_name: 'UserPromptSubmit', prompt: 'b' });
    await post({ session_id: 'two', cwd: '/home/you/projects/penguin-web', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm run build' } });
    await wait(1500);
    await shot('hud', [win]);
    await post({ session_id: 'two', hook_event_name: 'Stop', last_assistant_message: 'Built.' });
    await post({ session_id: 'one', hook_event_name: 'Stop', last_assistant_message: 'Added /search with tests.' });
    await wait(9000);

    // her permission card
    const hook = spawn(process.execPath, [path.join(root, 'hooks', 'hexa-permission-hook.js')]);
    hook.stdin.end(JSON.stringify({ hook_event_name: 'PermissionRequest', session_id: 'one', cwd: '/home/you/projects/penguin-api', tool_name: 'Bash', tool_input: { command: 'npm test -- --watch=false' }, permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' }] }));
    await wait(4500);
    await shot('permission', [win]);
    await new Promise((r) => hook.on('close', r));
    await wait(1500);

    await rightClickHer();
    await shot('menu', [win]);
    await pick('Watch my window');
    await wait(3200);
    await shot('lurk', [win]);

    await rightClickHer();
    await pick('Fork');
    await wait(2700);
    await shot('fork', [win]);
    await wait(6000);

    await rightClickHer();
    await pick('Talk to me');
    await wait(1200);
    for (const ch of 'hi') { d.typeChar(ch); await d.sync(); await wait(30); }
    d.key(KEY.Return); await d.sync();
    await wait(2500);
    await shot('mainframe', [win]);
  } catch (err) {
    console.error('ERROR', err.stack);
  }
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
  d.close();
  await hexa.stop();
})();
