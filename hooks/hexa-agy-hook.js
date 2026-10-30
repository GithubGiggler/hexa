#!/usr/bin/env node
'use strict';

// Google Antigravity hook -> Hexa. Antigravity runs it for the events in ~/.gemini/config/hooks.json
// with the event's JSON on stdin (https://antigravity.google/docs/hooks); adapt() turns it into
// the Claude Code event Hexa already understands, and hexa-hook.js (copied next to this file)
// sends it to her.
//
// Antigravity expects JSON back from every hook. This one always answers "{}" at once: no decision,
// carry on as usual. It's only installed on events where that's documented to change nothing
// (never PreToolUse, whose answer must carry a decision), and it gives up fast whatever happens.

const path = require('node:path');
const { run } = require('./hexa-hook.js');

const PREFIX = 'agy:';
const REPLY = '{}\n';
// The events it's installed on. Antigravity's payloads don't name their event, so the installer
// puts the name on the command line: hexa-agy-hook.js <event>.
const EVENTS = ['SessionStart', 'PreInvocation', 'PostToolUse', 'Stop'];

const str = (v) => (typeof v === 'string' ? v : undefined);

// Antigravity's tool, as the Claude Code tool Hexa knows how to describe. Only names and paths go
// on: never a file's content, a message or a prompt.
function tool(call) {
  const name = str(call?.name) || '';
  const args = call?.args && typeof call.args === 'object' ? call.args : {};
  switch (name) {
    case 'run_command': return { tool_name: 'Bash', tool_input: { command: str(args.CommandLine) || '' } };
    case 'view_file': return { tool_name: 'Read', tool_input: { file_path: str(args.AbsolutePath) } };
    case 'write_to_file': return { tool_name: 'Write', tool_input: { file_path: str(args.TargetFile) } };
    case 'replace_file_content':
    case 'multi_replace_file_content':
      return { tool_name: 'Edit', tool_input: { file_path: str(args.TargetFile) } };
    case 'grep_search': return { tool_name: 'Grep', tool_input: { pattern: str(args.Query) } };
    case 'find_by_name': return { tool_name: 'Glob', tool_input: { pattern: str(args.Pattern) } };
    case 'list_dir': return { tool_name: 'Glob', tool_input: { pattern: str(args.DirectoryPath) } };
    case 'search_web': return { tool_name: 'WebSearch', tool_input: { query: str(args.query) } };
    case 'read_url_content': return { tool_name: 'WebFetch', tool_input: { url: str(args.Url) } };
    case 'invoke_subagent': {
      const first = Array.isArray(args.Subagents) ? args.Subagents[0] : null;
      return { tool_name: 'Agent', tool_input: { description: str(first?.Role) || str(first?.TypeName) } };
    }
    default: return { tool_name: name, tool_input: {} };
  }
}

// event: the name from the command line (a payload that names its own event wins).
function adapt(evt, event) {
  if (!evt || typeof evt !== 'object') return null;
  const name = str(evt.hookEventName) || event;
  const base = { session_id: PREFIX + (str(evt.conversationId) || 'default') };
  // transcriptPath is left out: Antigravity's isn't the format Hexa reads token counts from
  const cwd = Array.isArray(evt.workspacePaths) ? evt.workspacePaths.find((p) => typeof p === 'string' && path.isAbsolute(p)) : undefined;
  if (cwd) base.cwd = cwd;
  switch (name) {
    case 'SessionStart':
      return { ...base, hook_event_name: 'SessionStart', source: 'startup' };
    case 'PreInvocation':
      // before each model call: the first one of a run is the start of a task (Antigravity's
      // payloads carry no prompt text)
      return evt.invocationNum === 0 ? { ...base, hook_event_name: 'UserPromptSubmit' } : null;
    case 'PostToolUse': {
      // it ran, or it failed (PreToolUse is never installed: her ticker moves once a tool is done)
      const error = str(evt.error);
      if (error) return { ...base, hook_event_name: 'PostToolUseFailure', error, ...tool(evt.toolCall) };
      return { ...base, hook_event_name: 'PreToolUse', ...tool(evt.toolCall) };
    }
    case 'Stop': {
      const error = str(evt.error);
      if (error || evt.terminationReason === 'error') return { ...base, hook_event_name: 'StopFailure', error: error || 'error' };
      return { ...base, hook_event_name: 'Stop' };
    }
    default:
      return null;
  }
}

module.exports = { adapt, tool, EVENTS, PREFIX, REPLY };
if (require.main === module) run((evt) => adapt(evt, process.argv[2]), { assistant: 'agy', reply: REPLY });
