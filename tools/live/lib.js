'use strict';

// What the live scenarios share: starting Hexa, talking to her socket, test windows and synthetic
// input on the X display. Meant for the hidden desktop (hidden-desktop.sh); on a real one the test
// windows and the fake pointer would be yours to watch.

const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const x11 = require('x11');

const root = path.resolve(__dirname, '..', '..');
const sock = () => `${process.env.XDG_RUNTIME_DIR}/hexa/hexa.sock`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (fn) => new Promise((resolve, reject) => fn((err, v) => (err ? reject(err) : resolve(v))));

function request(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const r = http.request({
      socketPath: sock(), path: p, method,
      headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {},
    }, (res) => {
      let t = '';
      res.on('data', (c) => { t += c; });
      res.on('end', () => resolve(t ? JSON.parse(t) : null));
    });
    r.on('error', reject);
    r.end(data);
  });
}

const state = () => request('GET', '/debug/state');
const post = (evt) => request('POST', '/event', { session_id: 'live', cwd: '/home/you/projects/live-test', demo: true, ...evt });
const alive = () => request('GET', '/health').then(() => true, () => false);

// Hexa from this checkout, in dev mode (her debug routes on). Resolves once her socket answers.
async function startHexa() {
  const electron = path.join(root, 'node_modules', '.bin', 'electron');
  const child = spawn(electron, ['.', '--dev'], { cwd: root, stdio: 'ignore' });
  const gone = new Promise((r) => child.once('exit', r));
  for (let i = 0; i < 80; i++) {
    if (await alive()) {
      await wait(3000); // her boot act
      return { child, gone, stop: () => { child.kill('SIGTERM'); return gone; } };
    }
    await wait(250);
  }
  child.kill('SIGKILL');
  throw new Error('Hexa did not answer on her socket');
}

// The X display, with what the scenarios do on it.
async function display() {
  const d = await call((cb) => x11.createClient(cb));
  const X = d.client;
  const rootWin = d.screen[0].root;
  const ACTIVE = await call((cb) => X.InternAtom(false, '_NET_ACTIVE_WINDOW', cb));
  const Test = await call((cb) => X.require('xtest', cb)).catch(() => null);
  return {
    X,
    root: rootWin,
    // a plain top-level window. The window manager places new windows itself (KWin centres
    // them), so it's asked again for (x, y) once mapped.
    open(name, x, y, w, h) {
      const wid = X.AllocID();
      X.CreateWindow(wid, rootWin, x, y, w, h, 0, 0, 1, 0, { backgroundPixel: 0x1d2440 });
      X.ChangeProperty(0, wid, X.atoms.WM_NAME, X.atoms.STRING, 8, `hexa test: ${name}`);
      X.MapWindow(wid);
      setTimeout(() => X.ConfigureWindow(wid, { x, y }), 300);
      return wid;
    },
    // as a pager asks for it (source 2): the window manager honours it
    activate(wid) {
      const b = Buffer.alloc(32);
      b.writeUInt8(33, 0); b.writeUInt8(32, 1); b.writeUInt32LE(wid, 4); b.writeUInt32LE(ACTIVE, 8);
      b.writeUInt32LE(2, 12);
      X.SendEvent(rootWin, false, (1 << 19) | (1 << 20), b);
    },
    // synthetic input (XTEST); button 1 is left, 3 is right
    hasInput: Boolean(Test),
    move(x, y) { Test.FakeInput(Test.MotionNotify, 0, 0, rootWin, Math.round(x), Math.round(y)); },
    press(button) { Test.FakeInput(Test.ButtonPress, button, 0, rootWin, 0, 0); },
    release(button) { Test.FakeInput(Test.ButtonRelease, button, 0, rootWin, 0, 0); },
    key(code) {
      Test.FakeInput(Test.KeyPress, code, 0, rootWin, 0, 0);
      Test.FakeInput(Test.KeyRelease, code, 0, rootWin, 0, 0);
    },
    // top-level windows the server is showing right now
    async mapped() {
      const tree = await call((cb) => X.QueryTree(rootWin, cb));
      const shown = [];
      for (const w of tree.children) {
        const a = await call((cb) => X.GetWindowAttributes(w, cb)).catch(() => null);
        if (a && a.mapState === 2) shown.push(w);
      }
      return shown;
    },
    sync: () => call((cb) => X.GetInputFocus(cb)),
    close() { try { X.terminate(); } catch { /* gone */ } },
  };
}

// PASS/FAIL lines; exit status 1 when anything failed.
function checks() {
  const lines = [];
  let failed = false;
  return {
    check(name, ok, detail = '') {
      if (!ok) failed = true;
      lines.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
    },
    error(err) { failed = true; lines.push(`ERROR ${err.stack || err.message}`); },
    report() {
      console.log(lines.join('\n'));
      process.exitCode = failed ? 1 : 0;
    },
  };
}

module.exports = { wait, request, state, post, alive, startHexa, display, checks, root };
