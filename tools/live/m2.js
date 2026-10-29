'use strict';

// Live check of M2, window awareness: she perches on the window in front while Claude works,
// rides along when it moves, falls when it closes, and points at Claude's window when it needs you
// and you're on another one.
//
//   tools/live/hidden-desktop.sh node tools/live/m2.js

const { wait, state, post, startHexa, display, checks } = require('./lib');

(async () => {
  const { check, error, report } = checks();
  const hexa = await startHexa();
  const d = await display();
  const winOf = (s, id) => s.windows.wins.find((w) => w.id === id);
  try {
    const oy = (await state()).display.y;

    // ---- she perches on the window in front while Claude works ----
    const A = d.open('claude', 300, oy + 520, 1000, 600);
    await wait(900); d.activate(A); await wait(900);
    let s = await state();
    const a = winOf(s, A);
    check('the tracker sees the test window', Boolean(a), a ? `${a.w}×${a.h} at ${a.x},${a.y}` : 'missing');
    check('it is the window in front', s.windows.fg === A, `fg ${s.windows.fg}`);
    await post({ hook_event_name: 'UserPromptSubmit', prompt: 'live test', window_id: A });
    await post({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/x/a.ts' } });
    await wait(2500);
    s = await state();
    check('she perches on it while Claude works', s.perch?.id === A, `perch ${JSON.stringify(s.perch)} mode ${s.mode}`);

    // ---- she rides along ----
    const her = s.pos.x;
    const was = winOf(s, A)?.x;
    d.X.ConfigureWindow(A, { x: 500, y: oy + 480 });
    await wait(900);
    s = await state();
    const moved = (winOf(s, A)?.x ?? NaN) - was;
    check('she rides along when it moves', s.perch?.id === A && Math.abs(moved) > 50 && Math.abs(s.pos.x - her - moved) < 40,
      `window moved ${Math.round(moved)} px, she moved ${Math.round(s.pos.x - her)} px`);

    // ---- she falls when it closes ----
    d.X.DestroyWindow(A);
    await wait(2500);
    s = await state();
    check('she falls off when it closes', !s.perch && s.pos.y >= s.display.height - 40, `mode ${s.mode} y ${Math.round(s.pos.y)}`);

    // ---- she points at Claude's window when it needs you and you're elsewhere ----
    const C = d.open('claude-2', 200, oy + 300, 900, 600);
    const B = d.open('elsewhere', 1500, oy + 300, 800, 600);
    await wait(900); d.activate(C); await wait(800);
    await post({ hook_event_name: 'UserPromptSubmit', prompt: 'live test 2', window_id: C });
    await wait(1500);
    d.activate(B); await wait(900);
    await post({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
    await wait(2800);
    s = await state();
    const c = winOf(s, C);
    check("she points at Claude's window", s.mode === 'point' && s.pointing?.id === C,
      `mode ${s.mode} pointing ${JSON.stringify(s.pointing)}; Claude's at ${c?.x},${c?.y}, fg ${s.windows.fg}`);
    await post({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
    await wait(900);
    s = await state();
    check('she lets go once it is answered', !s.pointing && s.mode !== 'point', `mode ${s.mode}`);
    await post({ hook_event_name: 'Stop', last_assistant_message: 'Done.' });
    d.X.DestroyWindow(C); d.X.DestroyWindow(B);
  } catch (err) {
    error(err);
  }
  d.close();
  await hexa.stop();
  report();
})();
