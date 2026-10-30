'use strict';

// Live check of the hexa CLI against her: say, react fork, run (a passing and a failing command),
// status. Nothing in it can answer a permission.
//
//   tools/live/hidden-desktop.sh node tools/live/cli.js

const path = require('node:path');
const { execFile } = require('node:child_process');
const { wait, state, startHexa, checks, root } = require('./lib');

const hexaCli = (...args) => new Promise((resolve) => {
  execFile(process.execPath, [path.join(root, 'bin', 'hexa.js'), ...args], { timeout: 30000 }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
});

(async () => {
  const { check, error, report } = checks();
  const hexa = await startHexa();
  try {
    await wait(2500);
    let r = await hexaCli('say', 'hello from the terminal');
    await wait(600);
    let s = await state();
    check('hexa say: she says it', r.code === 0 && s.said === 'hello from the terminal', `exit ${r.code}, said ${JSON.stringify(s.said)}`);
    r = await hexaCli('react', 'fork');
    await wait(700);
    s = await state();
    check('hexa react fork: her Fork', s.forks === 7, `forks ${s.forks}`);
    await wait(7000);
    const run = hexaCli('run', '--', 'sleep', '2');
    await wait(900);
    s = await state();
    check('hexa run: RUNS in her ticker while it runs', /RUNS sleep 2/.test(s.ticker), JSON.stringify(s.ticker));
    r = await run;
    await wait(500);
    s = await state();
    check('and exit 0 when it passes', r.code === 0 && /exit 0/.test(s.said), JSON.stringify(s.said));
    r = await hexaCli('run', '--', 'false');
    await wait(600);
    s = await state();
    check('a failing command: its code, and her reaction', r.code === 1 && /exited with 1/.test(s.said), `exit ${r.code}, said ${JSON.stringify(s.said)}`);
    r = await hexaCli('status', '--json');
    let st = null;
    try { st = JSON.parse(r.stdout); } catch { /* not JSON */ }
    check('hexa status --json', r.code === 0 && st && typeof st === 'object', r.stdout.slice(0, 120));
  } catch (err) {
    error(err);
  }
  await hexa.stop();
  r = await hexaCli('status');
  check('with her gone, status says so (exit 3)', r.code === 3, `exit ${r.code}`);
  report();
})();
var r;
