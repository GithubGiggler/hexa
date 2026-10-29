'use strict';

// Live check of her right-click menu: a right-click on her opens it, the release of that same
// click never picks an item (she stands at the bottom of the screen, so the menu opens upwards and
// its last item, Quit, ends up right under the pointer), and a click anywhere else closes it.
// (Escape doesn't: the overlay never takes keyboard focus, so keys go to the window you're in.)
//
//   tools/live/hidden-desktop.sh node tools/live/menu.js

const { wait, state, alive, startHexa, display, checks } = require('./lib');

(async () => {
  const { check, error, report } = checks();
  const hexa = await startHexa();
  const d = await display();
  try {
    if (!d.hasInput) throw new Error('no XTEST extension on this display');
    const s = await state();
    const body = s.hitRects[0];
    const x = s.display.x + body.x + body.w / 2;
    const y = s.display.y + body.y + body.h / 2;
    const before = await d.mapped();

    // a right-click held a moment, the pointer drifting up a little before the release: a hand
    d.move(x, y); await d.sync(); await wait(300);
    d.press(3); await d.sync(); await wait(450);
    d.move(x, y - 14); await d.sync(); await wait(150);
    d.release(3); await d.sync(); await wait(800);

    const stillHere = await alive();
    check('the release of the right-click picks nothing (she is still running)', stillHere);
    if (stillHere) {
      const now = await d.mapped();
      check('her menu is open', now.length > before.length, `${before.length} → ${now.length} windows shown`);
      d.move(s.display.x + 120, s.display.y + 120); await d.sync(); await wait(150);
      d.press(1); await d.sync(); d.release(1); await d.sync(); await wait(500);
      check('a click elsewhere closes it', (await d.mapped()).length === before.length);
      check('she is still running', await alive());
    }
  } catch (err) {
    error(err);
  }
  d.close();
  if (await alive()) await hexa.stop();
  report();
})();
