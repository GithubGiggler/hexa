'use strict';

// What she can do when you ask her in chat (Claude brain only): open a website, an app, a file or
// folder; play, pause or skip your music; set a reminder; look at your screen; or, with your OK,
// use your computer to do a task. Each tool's input is checked here before anything runs (the
// tools stream their input eagerly, so nothing upstream validates it).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const tool = (name, description, properties, required) => ({
  name,
  description,
  input_schema: { type: 'object', properties, required, additionalProperties: false },
  strict: true,
  eager_input_streaming: true,
});

const TOOLS = [
  tool('open_url', 'Open a web page in the user\'s browser. Only http and https.', { url: { type: 'string' } }, ['url']),
  tool('open_app', 'Start an installed application by its name (as in the app menu), e.g. "Firefox", "Dolphin", "Steam".', { name: { type: 'string' } }, ['name']),
  tool('open_path', 'Open a file or folder in the user\'s home with its usual app. ~ is their home.', { path: { type: 'string' } }, ['path']),
  tool('media', 'Control the music or video that is playing (MPRIS): play_pause, next, previous, stop, or status to see what is playing.',
    { action: { type: 'string', enum: ['play_pause', 'next', 'previous', 'stop', 'status'] } }, ['action']),
  tool('set_reminder', 'Remind the user of something in some minutes (1 to 1440).', { minutes: { type: 'integer' }, text: { type: 'string' } }, ['minutes', 'text']),
  tool('look_at_screen', 'Take a screenshot of the user\'s screen to answer a question about what is on it. Only when they ask about their screen.', { question: { type: 'string' } }, ['question']),
  tool('use_computer', 'Do a task on the user\'s computer by using its mouse and keyboard (for things no other tool does). They are asked to confirm first; give the task in one plain sentence.',
    { task: { type: 'string' } }, ['task']),
];

const str = (v, max = 2000) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);

// where to look for the apps in your menu
function appDirs() {
  const home = os.homedir();
  const data = [process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), ...(process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':')];
  return [...new Set([
    ...data.map((d) => path.join(d, 'applications')),
    path.join(home, '.local/share/flatpak/exports/share/applications'),
    '/var/lib/flatpak/exports/share/applications',
  ])];
}

function readDesktop(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const main = text.split(/^\[/m).find((s) => s.startsWith('Desktop Entry]')) || '';
    const get = (k) => (main.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1];
    if (get('NoDisplay') === 'true' || get('Hidden') === 'true' || get('Type') !== 'Application') return null;
    return { file, id: path.basename(file), name: get('Name') || '', generic: get('GenericName') || '', exec: get('Exec') || '' };
  } catch {
    return null;
  }
}

// The app whose name matches best: exact, then starts with, then contains (name or generic name).
function findApp(query, dirs = appDirs()) {
  const q = query.toLowerCase();
  const apps = [];
  for (const dir of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.desktop')); } catch { continue; }
    for (const f of files) {
      const app = readDesktop(path.join(dir, f));
      if (app) apps.push(app);
    }
  }
  const score = (a) => {
    const n = a.name.toLowerCase();
    if (n === q) return 4;
    if (n.startsWith(q)) return 3;
    if (n.includes(q)) return 2;
    if (a.generic.toLowerCase().includes(q) || a.id.toLowerCase().includes(q)) return 1;
    return 0;
  };
  return apps.map((a) => [score(a), a]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0])[0]?.[1] || null;
}

// Exec= without its field codes (%u %F ...), as argv: no shell ever sees it
function execArgv(exec) {
  const argv = [];
  const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
  let m;
  while ((m = re.exec(exec))) argv.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]);
  return argv.filter((a) => !/^%[a-zA-Z]$/.test(a));
}

function launch(app, { run = spawn } = {}) {
  // gtk-launch knows the whole desktop entry spec; else its Exec line, detached
  return new Promise((resolve) => {
    execFile('gtk-launch', [app.id], { timeout: 5000 }, (err) => {
      if (!err) return resolve(true);
      const argv = execArgv(app.exec);
      if (!argv.length) return resolve(false);
      try {
        run(argv[0], argv.slice(1), { detached: true, stdio: 'ignore' }).unref();
        resolve(true);
      } catch {
        resolve(false);
      }
    });
  });
}

// inside your home, after ~ and .. are resolved
function homePath(p, home = os.homedir()) {
  const full = path.resolve(home, p.replace(/^~(?=$|\/)/, home));
  return full === home || full.startsWith(home + path.sep) ? full : null;
}

// ctx: { openExternal, openPath, media, remind, lookAtScreen, useComputer }, from main
function createActions(ctx) {
  const run = {
    async open_url({ url }) {
      const u = str(url);
      let parsed = null;
      try { parsed = u && new URL(u); } catch { /* not a URL */ }
      if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) return { error: 'Only http and https links.' };
      await ctx.openExternal(parsed.href);
      return { ok: `Opened ${parsed.host}.`, label: `OPENS ${parsed.host}` };
    },
    async open_app({ name }) {
      const n = str(name, 100);
      if (!n) return { error: 'No app name.' };
      const app = (ctx.findApp || findApp)(n);
      if (!app) return { error: `No app called "${n}" in the menu.` };
      if (!(await (ctx.launch || launch)(app))) return { error: `${app.name} didn't start.` };
      return { ok: `Started ${app.name}.`, label: `LAUNCHES ${app.name}` };
    },
    async open_path({ path: p }) {
      const full = str(p, 1000) && homePath(p);
      if (!full) return { error: 'Only files and folders in your home.' };
      if (!fs.existsSync(full)) return { error: `${p} doesn't exist.` };
      const err = await ctx.openPath(full);
      return err ? { error: err } : { ok: `Opened ${path.basename(full) || full}.`, label: `OPENS ${path.basename(full)}` };
    },
    async media({ action }) {
      if (!['play_pause', 'next', 'previous', 'stop', 'status'].includes(action)) return { error: 'Not a media action.' };
      if (!ctx.media) return { error: 'No music player I can reach.' };
      const r = await ctx.media(action);
      return r ? { ok: r, label: `MEDIA ${action.replace('_', '/')}` } : { error: 'Nothing is playing.' };
    },
    async set_reminder({ minutes, text }) {
      const m = Number(minutes);
      const t = str(text, 300);
      if (!Number.isInteger(m) || m < 1 || m > 1440 || !t) return { error: 'A reminder needs 1 to 1440 minutes and some text.' };
      ctx.remind(m, t);
      return { ok: `I'll remind you in ${m} min.`, label: `REMINDS in ${m} min` };
    },
    async look_at_screen({ question }) {
      if (!str(question, 500)) return { error: 'What should I look for?' };
      const shot = await ctx.lookAtScreen();
      return shot ? { image: shot, label: 'LOOKS at your screen' } : { error: 'I can\'t see your screen.' };
    },
    async use_computer({ task }) {
      const t = str(task, 500);
      if (!t) return { error: 'What should I do?' };
      const r = await ctx.useComputer(t);
      return r.started ? { ok: 'You said yes: I\'m on it. My steps are on my task card.', label: 'TAKES the controls' } : { error: r.reason };
    },
  };
  return {
    tools: TOOLS,
    async call(name, input) {
      if (!Object.hasOwn(run, name)) return { error: `No tool "${name}".` };
      if (!input || typeof input !== 'object') return { error: 'Bad input.' };
      try {
        return await run[name](input);
      } catch (err) {
        return { error: err.message };
      }
    },
  };
}

module.exports = { createActions, TOOLS, findApp, execArgv, homePath, readDesktop };
