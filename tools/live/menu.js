'use strict';

// Live check of her right-click menu (drawn by her in the overlay): a right-click on her opens it,
// and the release of that same click picks nothing (she stands at the bottom of the screen, so
// her menu opens upwards and Quit is its last item); Escape closes it (main grabs the menu's keys
// while it's open: the overlay never has keyboard focus), and so does a click anywhere else; the
// arrows and Enter pick an item. Saves a capture of it open.
//
//   tools/live/hidden-desktop.sh node tools/live/menu.js

const { downsTo, wait, state, alive, request, startHexa, display, checks } = require('./lib');

const KEY = { Escape: 9, Down: 116, Return: 36 }; // evdev keycodes, as Xwayland uses

(async () => {
  const { check, error, report } = checks();
  const hexa = await startHexa();
  const d = await display();
  try {
    if (!d.hasInput) throw new Error('no XTEST extension on this display');
    let s = await state();
    const body = s.hitRects[0];
    const at = { x: s.display.x + body[0] + body[2] / 2, y: s.display.y + body[1] + body[3] / 2 };
    const rightClick = async () => {
      // held a moment, the pointer drifting up a little before the release: a hand
      d.move(at.x, at.y); await d.sync(); await wait(300);
      d.press(3); await d.sync(); await wait(450);
      d.move(at.x, at.y - 14); await d.sync(); await wait(150);
      d.release(3); await d.sync(); await wait(700);
    };
    const key = async (name) => { d.key(KEY[name]); await d.sync(); await wait(250); };

    await rightClick();
    check('the release of the right-click picks nothing (she is still running)', await alive());
    s = await state();
    check('her menu is open', s.menu === true, `menu ${s.menu}`);
    const shot = await request('GET', '/debug/capture');
    check('a capture of it', shot?.ok === true, shot?.file);
    await key('Escape');
    check('Escape closes it', (await state()).menu === false);

    await rightClick();
    d.move(s.display.x + 120, s.display.y + 120); await d.sync(); await wait(150);
    d.press(1); await d.sync(); d.release(1); await d.sync(); await wait(500);
    check('a click elsewhere closes it', (await state()).menu === false);

    await rightClick();
    const before = (await state()).pos;
    for (let n = await downsTo('Teleport'); n > 0; n--) await key('Down');
    await key('Return');
    await wait(2600);
    s = await state();
    check('the arrows and Enter pick Teleport', s.menu === false && Math.hypot(s.pos.x - before.x, s.pos.y - before.y) > 20,
      `menu ${s.menu}, moved ${Math.round(Math.hypot(s.pos.x - before.x, s.pos.y - before.y))} px`);
    check('she is still running', await alive());
  } catch (err) {
    error(err);
  }
  d.close();
  if (await alive()) await hexa.stop();
  report();
})();
