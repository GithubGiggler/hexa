#!/usr/bin/env node
'use strict';

// OpenAI Codex CLI hook -> Hexa. Codex runs it for each event in ~/.codex/hooks.json (or
// $CODEX_HOME/hooks.json) with the event's JSON on stdin; adapt() turns it into the Claude Code
// event Hexa already understands, and hexa-hook.js (copied next to this file) sends it to her.
// Codex hooks are documented at https://developers.openai.com/codex/hooks.
// Same rule as Claude's hook: no output (Codex reads plain stdout as context), exit 0, give up fast.

const { run } = require('./hexa-hook.js');

const PREFIX = 'codex:';

// Bash's command as you'd type it: Codex may hand it over as argv (["bash", "-lc", "npm test"]).
function commandText(command) {
  if (typeof command === 'string') return command;
  if (!Array.isArray(command) || !command.every((c) => typeof c === 'string')) return '';
  const flag = command.length - 2;
  if (flag >= 1 && ['-c', '-lc'].includes(command[flag]) && /(^|\/)(ba|z|da|k)?sh$/.test(command[0])) return command[flag + 1];
  return command.join(' ');
}

// The files an apply_patch touches, from its "*** Update File: path" lines. Only their names go on.
function patchFiles(input) {
  const text = [input?.command, input?.patch, input?.input].find((v) => typeof v === 'string') || '';
  const files = [];
  let adds = 0;
  for (const m of text.matchAll(/^\*\*\* (Add|Update|Delete) File: (.+?)\s*$/gm)) {
    if (m[1] === 'Add') adds += 1;
    if (!files.includes(m[2])) files.push(m[2]);
  }
  return { files, adds };
}

// Bash, as Codex calls it now; older versions said exec_command or shell_command, with the command
// in `cmd`.
const SHELL = new Set(['Bash', 'exec_command', 'shell_command', 'shell', 'local_shell']);

// Codex's tool, as the Claude Code tool Hexa knows how to describe ("RUNS npm test", "EDITS a.ts").
function tool(evt) {
  const name = typeof evt.tool_name === 'string' ? evt.tool_name : '';
  const input = evt.tool_input && typeof evt.tool_input === 'object' ? evt.tool_input : {};
  if (SHELL.has(name)) {
    const out = { command: commandText(input.command ?? input.cmd) };
    if (typeof input.description === 'string') out.description = input.description;
    return { tool_name: 'Bash', tool_input: out };
  }
  if (name === 'apply_patch') {
    // the patch itself stays here: Hexa only needs to know which file
    const { files, adds } = patchFiles(input);
    const only = files.length === 1;
    return { tool_name: only && adds === 1 ? 'Write' : 'Edit', tool_input: files.length ? { file_path: files[0], files: files.length } : {} };
  }
  return { tool_name: name, tool_input: input };
}

function adapt(evt) {
  if (!evt || typeof evt !== 'object' || typeof evt.hook_event_name !== 'string') return null;
  const id = typeof evt.session_id === 'string' && evt.session_id ? evt.session_id : 'default';
  // transcript_path is left out: Codex's isn't the format Hexa reads token counts from
  const base = { session_id: PREFIX + id };
  if (typeof evt.cwd === 'string') base.cwd = evt.cwd;
  if (typeof evt.permission_mode === 'string') base.permission_mode = evt.permission_mode;
  const name = evt.hook_event_name;
  switch (name) {
    case 'SessionStart':
      return { ...base, hook_event_name: name, source: evt.source };
    case 'UserPromptSubmit':
      return { ...base, hook_event_name: name, prompt: evt.prompt };
    case 'PreToolUse':
    case 'PostToolUse':
      return { ...base, hook_event_name: name, tool_use_id: evt.tool_use_id, ...tool(evt) };
    case 'PermissionRequest': {
      // Codex is asking you (its hook here runs in the background and never answers): Claude's
      // "needs your permission" notification
      const t = tool(evt);
      const what = typeof evt.tool_input?.description === 'string' && evt.tool_input.description
        ? evt.tool_input.description
        : `Codex needs your permission to use ${t.tool_name || 'a tool'}`;
      return { ...base, hook_event_name: 'Notification', notification_type: 'permission_prompt', message: what, ...t };
    }
    case 'Stop':
      return { ...base, hook_event_name: name, last_assistant_message: evt.last_assistant_message };
    case 'SubagentStart':
    case 'SubagentStop':
      return { ...base, hook_event_name: name, agent_id: evt.agent_id, agent_type: evt.agent_type };
    case 'PreCompact':
      return { ...base, hook_event_name: name, trigger: evt.trigger };
    case 'Interrupt':
      // you stopped the turn: what Claude Code says with an interrupted tool (no Stop follows)
      return { ...base, hook_event_name: 'PostToolUseFailure', is_interrupt: true };
    case 'SessionEnd':
      return { ...base, hook_event_name: name, reason: evt.reason };
    default:
      return null; // PostCompact, and whatever Codex adds next: nothing Hexa would do with it
  }
}

module.exports = { adapt, commandText, patchFiles, PREFIX };
if (require.main === module) run(adapt, { assistant: 'codex' });
