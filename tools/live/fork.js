'use strict';

// Live check of her Fork, picked from her menu with the keyboard: seven copies come out, a
// capture of them in their lattice, and all of them are reaped back.
//
//   tools/live/hidden-desktop.sh node tools/live/fork.js

const { wait, state, request, startHexa, display, checks } = require('./lib');

const KEY = { Down: 116, Return: 36 };

(async () => {
  const { check, error, report } = checks();
  const hexa = await startHexa();
  const d = await display();
  try {
    await wait(3000); // her boot line typed out
    let s = await state();
    const body = s.hitRects[0];
    d.move(s.display.x + body[0] + body[2] / 2, s.display.y + body[1] + body[3] / 2); await d.sync(); await wait(200);
    d.press(3); await d.sync(); await wait(80); d.release(3); await d.sync(); await wait(600);
    for (const k of ['Down', 'Down', 'Down', 'Down', 'Return']) { d.key(KEY[k]); await d.sync(); await wait(200); } // Hide, Teleport, Watch, Fork
    await wait(2700);
    s = await state();
    check('seven copies out', s.forks === 7, `forks ${s.forks}`);
    const shot = await request('GET', '/debug/capture');
    check('a capture of them', shot?.ok === true, shot?.file);
    await wait(5000);
    check('all reaped back', (await state()).forks === 0);
  } catch (err) {
    error(err);
  }
  d.close();
  await hexa.stop();
  report();
})();
