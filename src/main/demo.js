// Portions ported from capri-desktop v0.4.3 (MIT), see NOTICE.
'use strict';

// A fake but realistic Claude Code session, played by the tray's "Play demo" and `npm run demo`,
// then her showcase (her own tricks, app.js). Each step: [delay before it, in ms, event].
// None of it counts as real: every event says demo: true.

const SESSION = 'demo-session';
const CWD = '/home/you/projects/penguin-api';

const step = (delay, evt) => [delay, { session_id: SESSION, cwd: CWD, demo: true, ...evt }];
const tool = (tool_name, tool_input) => ({ hook_event_name: 'PreToolUse', tool_name, tool_input });

const STEPS = [
  step(0, { hook_event_name: 'SessionStart', source: 'startup' }),
  step(2500, { hook_event_name: 'UserPromptSubmit', prompt: 'Add a /search endpoint with paging and tests' }),
  step(1800, tool('Read', { file_path: `${CWD}/src/routes/index.ts` })),
  step(900, tool('Read', { file_path: `${CWD}/src/routes/users.ts` })),
  step(900, tool('Grep', { pattern: 'paginate' })),
  step(1100, tool('WebFetch', { url: 'https://expressjs.com/en/guide/routing.html' })),
  step(1500, { hook_event_name: 'SubagentStart', agent_type: 'Explore' }),
  step(2600, { hook_event_name: 'SubagentStop', agent_type: 'Explore' }),
  step(900, tool('Read', { file_path: `${CWD}/src/db/query.ts` })),
  step(1200, tool('Edit', { file_path: `${CWD}/src/routes/search.ts` })),
  step(1300, tool('Edit', { file_path: `${CWD}/src/routes/index.ts` })),
  step(1100, tool('Write', { file_path: `${CWD}/tests/search.test.ts` })),
  step(1300, tool('Bash', { command: 'npm test', description: 'Run the tests' })),
  step(2200, {
    hook_event_name: 'PostToolUseFailure',
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
    error: `> penguin-api@1.0.0 test\n> node --test\n\nError: Cannot find module 'zod'\nRequire stack:\n- ${CWD}/src/routes/search.ts`,
  }),
  step(2600, tool('Edit', { file_path: `${CWD}/package.json` })),
  step(1300, tool('Bash', { command: 'npm install zod', description: 'Install zod' })),
  step(1600, tool('Bash', { command: 'npm test', description: 'Run the tests' })),
  step(2400, { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }),
  step(4000, tool('Bash', { command: 'git push', description: 'Push to main' })),
  step(1500, {
    hook_event_name: 'Stop',
    last_assistant_message: 'I added **GET /search** with cursor paging and six tests, and installed zod for the query schema. Everything passes and the branch is pushed.',
  }),
  step(6000, { hook_event_name: 'HexaShowcase' }),
];

// Sends the steps one after the other; speed > 1 plays it faster (tests). Returns a cancel function.
function playDemo(send, { speed = 1 } = {}) {
  const timers = [];
  let at = 0;
  for (const [delay, evt] of STEPS) {
    at += delay / speed;
    timers.push(setTimeout(() => send(evt), at));
  }
  return () => timers.forEach(clearTimeout);
}

module.exports = { STEPS, playDemo };
