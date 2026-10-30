'use strict';

// Live check of talking to her and of her using the computer, with a scripted Claude
// (fake-claude.js) on the hidden desktop: her menu opens her Mainframe; what you type reaches
// it (the overlay takes the keyboard); she answers; asked to do something, she shows her consent
// card, a real click on Start lets her, and her clicks and typing land in a test window, mapped
// from the screenshot she was sent.
//
//   tools/live/hidden-desktop.sh node tools/live/brain.js

const fs = require('node:fs');
const path = require('node:path');
const { downsTo, wait, state, startHexa, display, checks } = require('./lib');

const KEY = { Down: 116, Return: 36 };
const TASK = 'type hexa in the test window';
const call = (fn) => new Promise((res, rej) => fn((e, v) => (e ? rej(e) : res(v))));

(async () => {
  const { check, error, report } = checks();
  const run = process.env.XDG_RUNTIME_DIR;
  // she starts on her Claude brain, allowed to use the computer
  const confDir = path.join(process.env.XDG_CONFIG_HOME, 'hexa');
  fs.mkdirSync(confDir, { recursive: true });
  fs.writeFileSync(path.join(confDir, 'config.json'), JSON.stringify({ welcomed: true, linked: true, brain: 'max', computerUse: true }));
  const script = path.join(run, 'fake-claude.json');
  fs.writeFileSync(script, JSON.stringify({
    chat: [
      { content: [{ type: 'text', text: 'Hi! I can hear you.' }] },
      { content: [{ type: 'text', text: 'On it.' }, { type: 'tool_use', id: 'u1', name: 'use_computer', input: { task: TASK } }], stop: 'tool_use' },
      { content: [{ type: 'text', text: 'Done there.' }] },
    ],
    computer: [
      {
        content: [
          { type: 'thinking', thinking: 'Clicking into the test window.' },
          { type: 'tool_use', id: 'c1', name: 'left_click', toolset_name: 'computer', input: { coordinate: [600, 325] } },
          { type: 'tool_use', id: 'c2', name: 'type', toolset_name: 'computer', input: { text: 'hexa' } },
          { type: 'tool_use', id: 'c3', name: 'key', toolset_name: 'computer', input: { text: 'Return' } },
        ],
        stop: 'tool_use',
      },
      { content: [{ type: 'text', text: 'Typed hexa in the test window.' }] },
    ],
  }));
  const hexa = await startHexa({ env: { HEXA_FAKE_CLAUDE: script } });
  const d = await display();
  try {
    // a test window at (1000, 500), 400×300: its middle is (1200, 650), (600, 325) in a half-size screenshot
    const T = d.X.AllocID();
    d.X.CreateWindow(T, d.root, 1000, 500, 400, 300, 0, 0, 1, 0, { backgroundPixel: 0x223344, eventMask: 0x1 | 0x4 }); // KeyPress, ButtonPress
    d.X.ChangeProperty(0, T, d.X.atoms.WM_NAME, d.X.atoms.STRING, 8, 'hexa test: target');
    d.X.MapWindow(T);
    const got = { keys: 0, clicks: [] };
    d.X.on('event', (ev) => {
      if (ev.wid !== T && ev.event !== T) return;
      if (ev.name === 'KeyPress') got.keys++;
      if (ev.name === 'ButtonPress') got.clicks.push([ev.x, ev.y]);
    });
    await wait(400);
    d.X.ConfigureWindow(T, { x: 1000, y: 500 });
    // the window you're in (on the hidden desktop, keys only reach X windows while one is active)
    d.activate(T);
    await wait(2500); // her boot line
    const geo = await call((cb) => d.X.TranslateCoordinates(T, d.root, 0, 0, cb));

    // her menu: Talk to me (Send to background, Talk to me)
    let s = await state();
    const body = s.hitRects[0];
    d.move(s.display.x + body[0] + body[2] / 2, s.display.y + body[1] + body[3] / 2); await d.sync(); await wait(200);
    d.press(3); await d.sync(); await wait(80); d.release(3); await d.sync(); await wait(600);
    for (let n = await downsTo('Talk to me'); n > 0; n--) { d.key(KEY.Down); await d.sync(); await wait(150); }
    d.key(KEY.Return); await d.sync(); await wait(200);
    await wait(900);
    s = await state();
    check('Talk to me opens her Mainframe', s.mainframe === true);

    const typeLine = async (text) => {
      for (const ch of text) {
        const code = ch === ' ' ? 65 : null;
        if (code) d.key(code);
        else d.typeChar(ch);
        await d.sync();
        await wait(25);
      }
      d.key(KEY.Return); await d.sync();
    };
    await typeLine('hello');
    await wait(1200);
    s = await state();
    check('what you type reaches her, and she answers', /> you:hello/.test(s.chat) && /Hi! I can hear you\./.test(s.chat), JSON.stringify(s.chat.slice(-120)));

    await typeLine(TASK);
    let consent = null;
    for (let i = 0; i < 20 && !consent; i++) {
      await wait(300);
      s = await state();
      consent = s.buttons.find((b) => b.id === 'start');
    }
    check('asked to do something, she asks first (Start / Cancel)', Boolean(consent), s.buttons.map((b) => b.id).join(','));
    if (consent) {
      await wait(800); // her card settles
      s = await state();
      consent = s.buttons.find((b) => b.id === 'start');
      const [x, y, w, h] = consent.rect;
      d.move(s.display.x + x + w / 2, s.display.y + y + h / 2); await d.sync(); await wait(250);
      d.press(1); await d.sync(); await wait(60); d.release(1); await d.sync();
    }
    await wait(4000);
    s = await state();
    // (600, 325) in the half-size screenshot is (1200, 650) on screen: in the window, from its real origin
    const near = got.clicks.some(([cx, cy]) => Math.abs(cx - (1200 - geo.destX)) < 4 && Math.abs(cy - (650 - geo.destY)) < 4);
    check('her click lands where the screenshot said (mapped to your screen)', near, `clicks ${JSON.stringify(got.clicks)} in a window at ${geo.destX},${geo.destY}`);
    check('her typing lands in that window', got.keys >= 5, `${got.keys} key presses`);
    const log = fs.readFileSync(`${script}.log.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const comp = log.filter((r) => r.tools?.includes('computer_toolset_20260801'));
    const firstImg = comp[0]?.messages[0].content.find((b) => b.type === 'image');
    check('she sent Claude a real screenshot first', Boolean(firstImg) && Number(/\d+/.exec(firstImg.source.data)?.[0]) > 2000, firstImg?.source.data);
    const results = comp[1]?.messages.at(-1).content || [];
    check('every computer result echoes the toolset', results.length === 3 && results.every((r) => r.toolset_name === 'computer'));
    check('her task card showed her steps', /Typing "hexa"/.test(s.task) || /Typed hexa/.test(s.chat + s.task), JSON.stringify(s.task.slice(0, 160)));
  } catch (err) {
    error(err);
  }
  d.close();
  await hexa.stop();
  report();
})();
