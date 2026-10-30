'use strict';

// Live check of the sessions HUD: two Claude sessions bring up a chip each, and a click on a chip
// makes her point at that session's window. Saves a capture.
//
//   tools/live/hidden-desktop.sh node tools/live/hud.js

const { wait, state, post, request, startHexa, display, checks } = require('./lib');

(async () => {
  const { check, error, report } = checks();
  const hexa = await startHexa();
  const d = await display();
  try {
    const oy = (await state()).display.y;
    const A = d.open('claude: api', 200, oy + 300, 900, 600);
    const B = d.open('claude: web', 1300, oy + 300, 900, 600);
    await wait(900);
    d.activate(A); await wait(500);
    await post({ session_id: 'one', cwd: '/home/you/projects/penguin-api', hook_event_name: 'UserPromptSubmit', prompt: 'a', window_id: A });
    await post({ session_id: 'one', cwd: '/home/you/projects/penguin-api', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/p/gigs.ts' } });
    await post({ session_id: 'two', cwd: '/home/you/projects/penguin-web', hook_event_name: 'UserPromptSubmit', prompt: 'b', window_id: B });
    await post({ session_id: 'two', cwd: '/home/you/projects/penguin-web', hook_event_name: 'Stop', last_assistant_message: 'The page builds now.' });
    await wait(2600);
    let s = await state();
    check('two sessions: the HUD is up', s.hud.length === 1 && s.hud[0][3] > 40, JSON.stringify(s.hud));
    const shot = await request('GET', '/debug/capture');
    check('a capture of it', shot?.ok === true, shot?.file);
    // the chips are stacked: the second one is in the lower half
    const [x, y, w, h] = s.hud[0];
    d.move(s.display.x + x + w / 2, s.display.y + y + h * 0.75); await d.sync(); await wait(200);
    d.press(1); await d.sync(); await wait(60); d.release(1); await d.sync();
    await wait(2600);
    s = await state();
    check('a click on a chip: she points at that session\'s window', s.pointing && (s.pointing.id === A || s.pointing.id === B),
      `pointing ${JSON.stringify(s.pointing)} mode ${s.mode}`);
    d.X.DestroyWindow(A); d.X.DestroyWindow(B);
  } catch (err) {
    error(err);
  }
  d.close();
  await hexa.stop();
  report();
})();
