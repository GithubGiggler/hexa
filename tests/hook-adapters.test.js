'use strict';

// The Codex and Antigravity hooks: their adapters (event in, Claude-shaped event out), and the
// installed commands run the way Codex and Antigravity would run them, against a stand-in for Hexa.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const codexHook = require('../hooks/hexa-codex-hook');
const agyHook = require('../hooks/hexa-agy-hook');
const { slim } = require('../hooks/hexa-hook');

const HOOKS_DIR = path.join(__dirname, '..', 'hooks');

// ---- Codex ----

const cx = (extra) => codexHook.adapt({ session_id: 'th-1', cwd: '/home/u/penguin-api', transcript_path: '/home/u/.codex/sessions/r.jsonl', model: 'gpt-5.5', permission_mode: 'default', ...extra });

test('codex: every session is marked codex:, and its transcript stays behind', () => {
  const e = cx({ hook_event_name: 'SessionStart', source: 'resume' });
  assert.deepEqual(e, { session_id: 'codex:th-1', cwd: '/home/u/penguin-api', permission_mode: 'default', hook_event_name: 'SessionStart', source: 'resume' });
  assert.equal(codexHook.adapt({ hook_event_name: 'Stop' }).session_id, 'codex:default');
  assert.equal(slim(e, { assistant: 'codex' }).assistant, 'codex');
});

test('codex: its events as the Claude Code events Hexa knows', () => {
  assert.equal(cx({ hook_event_name: 'UserPromptSubmit', turn_id: 'u', prompt: 'Fix it' }).prompt, 'Fix it');
  const pre = cx({ hook_event_name: 'PreToolUse', turn_id: 'u', tool_name: 'Bash', tool_use_id: 'c1', tool_input: { command: 'npm test' } });
  assert.deepEqual([pre.hook_event_name, pre.tool_name, pre.tool_input, pre.tool_use_id], ['PreToolUse', 'Bash', { command: 'npm test' }, 'c1']);
  const post = cx({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'c1', tool_input: { command: 'npm test' }, tool_response: { output: 'x'.repeat(5000) } });
  assert.equal(post.hook_event_name, 'PostToolUse');
  assert.equal(post.tool_response, undefined, 'its output stays here');
  const ask = cx({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm -rf build', description: 'Remove the build folder' } });
  assert.deepEqual([ask.hook_event_name, ask.notification_type, ask.message, ask.tool_name], ['Notification', 'permission_prompt', 'Remove the build folder', 'Bash']);
  assert.equal(cx({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls', description: null } }).message, 'Codex needs your permission to use Bash');
  const stop = cx({ hook_event_name: 'Stop', turn_id: 'u', stop_hook_active: false, last_assistant_message: 'Done.' });
  assert.deepEqual([stop.hook_event_name, stop.last_assistant_message], ['Stop', 'Done.']);
  const sub = cx({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'explorer' });
  assert.deepEqual([sub.hook_event_name, sub.agent_type], ['SubagentStart', 'explorer']);
  assert.equal(cx({ hook_event_name: 'SubagentStop', agent_type: 'explorer', agent_transcript_path: '/t' }).agent_transcript_path, undefined);
  assert.equal(cx({ hook_event_name: 'PreCompact', trigger: 'auto' }).trigger, 'auto');
  const stopped = cx({ hook_event_name: 'Interrupt', turn_id: 'u' });
  assert.deepEqual([stopped.hook_event_name, stopped.is_interrupt], ['PostToolUseFailure', true]);
  assert.equal(cx({ hook_event_name: 'SessionEnd', reason: 'other' }).hook_event_name, 'SessionEnd');
});

test('codex: what Hexa has no use for is dropped', () => {
  assert.equal(cx({ hook_event_name: 'PostCompact', trigger: 'auto' }), null);
  assert.equal(cx({ hook_event_name: 'SomethingNew' }), null);
  assert.equal(codexHook.adapt(null), null);
  assert.equal(codexHook.adapt({ session_id: 'x' }), null);
});

test('codex: a patch reads as the file it edits, and none of its content goes on', () => {
  const patch = '*** Begin Patch\n*** Update File: src/gigs.ts\n@@\n-const secret = 1;\n+const secret = 2;\n*** End Patch\n';
  const e = cx({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: patch } });
  assert.deepEqual([e.tool_name, e.tool_input], ['Edit', { file_path: 'src/gigs.ts', files: 1 }]);
  assert.ok(!JSON.stringify(slim(e, { assistant: 'codex' })).includes('secret'));
  const added = cx({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Add File: notes.md\n+hi\n*** End Patch' } });
  assert.deepEqual([added.tool_name, added.tool_input.file_path], ['Write', 'notes.md']);
  const many = codexHook.patchFiles({ command: '*** Update File: a.ts\n*** Delete File: b.ts\n*** Update File: a.ts\n' });
  assert.deepEqual(many, { files: ['a.ts', 'b.ts'], adds: 0 });
  assert.deepEqual(cx({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: {} }).tool_input, {});
});

test('codex: a command given as argv reads as you’d type it', () => {
  assert.equal(codexHook.commandText('npm test'), 'npm test');
  assert.equal(codexHook.commandText(['bash', '-lc', 'npm test && npm run lint']), 'npm test && npm run lint');
  assert.equal(codexHook.commandText(['/bin/zsh', '-c', 'ls']), 'ls');
  assert.equal(codexHook.commandText(['git', 'status']), 'git status');
  assert.equal(codexHook.commandText([1, 2]), '');
  assert.equal(codexHook.commandText(undefined), '');
});

test('codex: older versions’ names for the shell are Bash too', () => {
  const e = cx({ hook_event_name: 'PreToolUse', tool_name: 'exec_command', tool_input: { cmd: 'cargo test' } });
  assert.deepEqual([e.tool_name, e.tool_input], ['Bash', { command: 'cargo test' }]);
  assert.equal(cx({ hook_event_name: 'PreToolUse', tool_name: 'shell_command', tool_input: { command: ['sh', '-c', 'make'] } }).tool_input.command, 'make');
});

test('codex: MCP and other tools keep their names', () => {
  const e = cx({ hook_event_name: 'PreToolUse', tool_name: 'mcp__github__create_issue', tool_input: { title: 'Bug' } });
  assert.deepEqual([e.tool_name, e.tool_input], ['mcp__github__create_issue', { title: 'Bug' }]);
});

// ---- Antigravity ----

const common = { conversationId: 'ec33', workspacePaths: ['/workspace/project'], transcriptPath: '~/.gemini/antigravity/brain/ec33/t.jsonl', artifactDirectoryPath: '~/x', modelName: 'gemini' };
const ag = (event, extra) => agyHook.adapt({ ...common, ...extra }, event);

test('agy: sessions are marked agy:, the workspace is the cwd, the transcript stays behind', () => {
  assert.deepEqual(ag('SessionStart', {}), { session_id: 'agy:ec33', cwd: '/workspace/project', hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(agyHook.adapt({ workspacePaths: ['relative/dir'] }, 'SessionStart').cwd, undefined);
  assert.equal(agyHook.adapt({}, 'SessionStart').session_id, 'agy:default');
});

test('agy: the first model call of a run starts a task; the later ones are nothing', () => {
  assert.equal(ag('PreInvocation', { invocationNum: 0, initialNumSteps: 3 }).hook_event_name, 'UserPromptSubmit');
  assert.equal(ag('PreInvocation', { invocationNum: 2, initialNumSteps: 9 }), null);
});

test('agy: a tool that ran moves her ticker; one that failed is a failure', () => {
  const ran = ag('PostToolUse', { toolCall: { name: 'run_command', args: { CommandLine: 'npm test', Cwd: '/workspace/project' } }, stepIdx: 19, error: '' });
  assert.deepEqual([ran.hook_event_name, ran.tool_name, ran.tool_input], ['PreToolUse', 'Bash', { command: 'npm test' }]);
  const failed = ag('PostToolUse', { toolCall: { name: 'run_command', args: { CommandLine: 'npm test' } }, error: 'npm ERR! Test failed' });
  assert.deepEqual([failed.hook_event_name, failed.tool_name, failed.error], ['PostToolUseFailure', 'Bash', 'npm ERR! Test failed']);
});

test('agy: its tools as Claude Code’s, names and paths only (never a file’s content or a message)', () => {
  const t = (name, args) => agyHook.tool({ name, args });
  assert.deepEqual(t('view_file', { AbsolutePath: '/w/a.ts', StartLine: 1 }), { tool_name: 'Read', tool_input: { file_path: '/w/a.ts' } });
  assert.deepEqual(t('write_to_file', { TargetFile: '/w/b.ts', CodeContent: 'const secret = 1;' }), { tool_name: 'Write', tool_input: { file_path: '/w/b.ts' } });
  assert.deepEqual(t('replace_file_content', { TargetFile: '/w/c.ts', ReplacementContent: 'secret' }), { tool_name: 'Edit', tool_input: { file_path: '/w/c.ts' } });
  assert.deepEqual(t('multi_replace_file_content', { TargetFile: '/w/d.ts', ReplacementChunks: ['secret'] }), { tool_name: 'Edit', tool_input: { file_path: '/w/d.ts' } });
  assert.deepEqual(t('grep_search', { Query: 'paginate', SearchPath: '/w' }), { tool_name: 'Grep', tool_input: { pattern: 'paginate' } });
  assert.deepEqual(t('find_by_name', { Pattern: '*.ts' }), { tool_name: 'Glob', tool_input: { pattern: '*.ts' } });
  assert.deepEqual(t('list_dir', { DirectoryPath: '/w/src' }), { tool_name: 'Glob', tool_input: { pattern: '/w/src' } });
  assert.deepEqual(t('search_web', { query: 'x11 input shape' }), { tool_name: 'WebSearch', tool_input: { query: 'x11 input shape' } });
  assert.deepEqual(t('read_url_content', { Url: 'https://docs.example.com/a' }), { tool_name: 'WebFetch', tool_input: { url: 'https://docs.example.com/a' } });
  assert.deepEqual(t('invoke_subagent', { Subagents: [{ Prompt: 'secret', Role: 'Reviewer' }] }), { tool_name: 'Agent', tool_input: { description: 'Reviewer' } });
  assert.deepEqual(t('send_message', { Recipient: 'x', Message: 'secret' }), { tool_name: 'send_message', tool_input: {} });
  assert.deepEqual(agyHook.tool(undefined), { tool_name: '', tool_input: {} });
});

test('agy: the end of a run is a Stop, or a StopFailure when it ended in an error', () => {
  assert.equal(ag('Stop', { executionNum: 1, terminationReason: 'model_stop', error: '', fullyIdle: true }).hook_event_name, 'Stop');
  const bad = ag('Stop', { terminationReason: 'error', error: 'quota exceeded' });
  assert.deepEqual([bad.hook_event_name, bad.error], ['StopFailure', 'quota exceeded']);
  assert.equal(ag('Stop', { terminationReason: 'error', error: '' }).hook_event_name, 'StopFailure');
});

test('agy: an event it isn’t installed on, or no event at all, is nothing', () => {
  assert.equal(ag('PreToolUse', { toolCall: { name: 'run_command', args: {} } }), null);
  assert.equal(ag('PostInvocation', { invocationNum: 0 }), null);
  assert.equal(ag(undefined, {}), null);
  assert.equal(agyHook.adapt('nope', 'Stop'), null);
  assert.equal(agyHook.adapt({ ...common, hookEventName: 'Stop' }, 'SessionStart').hook_event_name, 'Stop', 'a payload naming its event wins');
});

// ---- the installed hooks, run as their assistants run them ----

function listen(sock) {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.end('{"ok":true}');
    });
  });
  return new Promise((resolve) => server.listen(sock, () => resolve({ server, received })));
}

// The command line from the hooks file, through a shell, the event on stdin.
function runCommand(command, input, env) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn('/bin/sh', ['-c', command], { env: { ...process.env, ...env } });
    let stdout = '';
    child.stdout.on('data', (s) => { stdout += s; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, ms: Date.now() - started }));
    child.stdin.end(input);
  });
}

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-adapt-'));
  process.env.CODEX_HOME = path.join(root, 'codex');
  process.env.HEXA_GEMINI_DIR = path.join(root, 'gemini');
  return { root, dataDir: path.join(root, 'data'), socket: path.join(root, 'hexa.sock') };
}

test('the installed Codex hook: says nothing, exits 0, and Hexa hears a codex: event', async () => {
  const codex = require('../src/main/hooks/codex');
  const { dataDir, socket } = sandbox();
  codex.install({ hooksDir: HOOKS_DIR, dataDir, hasNode: false }); // runs on this node, as the AppImage would
  const { command } = JSON.parse(fs.readFileSync(codex.hooksPath(), 'utf8')).hooks.PreToolUse[0].hooks[0];
  const { server, received } = await listen(socket);
  try {
    const event = { session_id: 'th-1', cwd: '/home/u/p', hook_event_name: 'PreToolUse', model: 'gpt-5.5', turn_id: 'u', tool_name: 'Bash', tool_use_id: 'c1', tool_input: { command: ['bash', '-lc', 'npm test'] } };
    const r = await runCommand(command, JSON.stringify(event), { HEXA_SOCKET: socket });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '', 'Codex reads plain stdout as context: nothing');
    assert.equal(received.length, 1);
    const got = received[0];
    assert.deepEqual([got.session_id, got.assistant, got.hook_event_name, got.tool_name, got.tool_input], ['codex:th-1', 'codex', 'PreToolUse', 'Bash', { command: 'npm test' }]);
    assert.equal(typeof got.ppid, 'number');
    // PostCompact: nothing sent at all
    await runCommand(command, JSON.stringify({ session_id: 'th-1', hook_event_name: 'PostCompact' }), { HEXA_SOCKET: socket });
    assert.equal(received.length, 1);
  } finally {
    server.close();
  }
});

test('the installed Antigravity hook: answers {} at once, and Hexa hears an agy: event named by its command', async () => {
  const agy = require('../src/main/hooks/antigravity');
  const { dataDir, socket } = sandbox();
  agy.install({ hooksDir: HOOKS_DIR, dataDir, hasNode: false });
  const entry = JSON.parse(fs.readFileSync(agy.hooksPath(), 'utf8')).hexa;
  const { server, received } = await listen(socket);
  try {
    const post = { ...common, toolCall: { name: 'write_to_file', args: { TargetFile: '/workspace/project/a.ts', CodeContent: 'const secret = 1;' } }, stepIdx: 3, error: '' };
    const r = await runCommand(entry.PostToolUse[0].hooks[0].command, JSON.stringify(post), { HEXA_SOCKET: socket });
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.stdout), {}, 'no decision: carry on as usual');
    assert.equal(received.length, 1);
    assert.deepEqual([received[0].session_id, received[0].assistant, received[0].hook_event_name, received[0].tool_name], ['agy:ec33', 'agy', 'PreToolUse', 'Write']);
    assert.ok(!JSON.stringify(received[0]).includes('secret'));
    await runCommand(entry.Stop[0].command, JSON.stringify({ ...common, executionNum: 1, terminationReason: 'model_stop', error: '', fullyIdle: true }), { HEXA_SOCKET: socket });
    assert.equal(received[1].hook_event_name, 'Stop');
  } finally {
    server.close();
  }
});

test('Hexa not running, or stdin not JSON: both hooks still exit 0 fast, and Antigravity still gets its {}', async () => {
  const { socket } = sandbox(); // nothing listens there
  const agyScript = path.join(HOOKS_DIR, 'hexa-agy-hook.js');
  const codexScript = path.join(HOOKS_DIR, 'hexa-codex-hook.js');
  for (const input of [JSON.stringify({ ...common }), 'not json', '']) {
    const a = await runCommand(`"${process.execPath}" "${agyScript}" SessionStart`, input, { HEXA_SOCKET: socket });
    assert.deepEqual([a.code, a.stdout], [0, '{}\n']);
    assert.ok(a.ms < 2500, `took ${a.ms} ms`);
    const c = await runCommand(`"${process.execPath}" "${codexScript}"`, input, { HEXA_SOCKET: socket });
    assert.deepEqual([c.code, c.stdout], [0, '']);
    assert.ok(c.ms < 2500, `took ${c.ms} ms`);
  }
});
