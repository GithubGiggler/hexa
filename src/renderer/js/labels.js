// Portions ported from capri-desktop v0.4.3 (MIT), see NOTICE.

// What the ticker over her head says about a tool call: a verb and what it acts on,
// like "EDITS gigs.ts" or "RUNS npm test".

import { basename, clip } from './util.js';

export function describeTool(evt, verbs) {
  const name = evt.tool_name || '';
  const input = evt.tool_input || {};
  let verb = verbs[name] || verbs.default;
  let target = '';

  switch (name) {
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit':
      target = basename(input.file_path); break;
    case 'NotebookEdit':
      target = basename(input.notebook_path); break;
    case 'Bash':
      target = input.description || input.command; break;
    case 'Grep':
      target = input.pattern ? `“${input.pattern}”` : ''; break;
    case 'Glob':
      target = input.pattern; break;
    case 'WebFetch':
      try { target = new URL(input.url).host; } catch { target = input.url; }
      break;
    case 'WebSearch':
      target = input.query; break;
    case 'Agent': case 'Task':
      target = input.description || input.subagent_type; break;
    case 'Skill':
      target = input.skill; break;
    default:
      if (name.startsWith('mcp__')) {
        // mcp__server__tool -> "server › tool", long generated server ids dropped
        const [, server = '', ...rest] = name.split('__');
        const tool = rest.join('__').replace(/_/g, ' ');
        const nice = /^[0-9a-f-]{20,}$/i.test(server) ? '' : server.replace(/^ccd_/, '');
        verb = 'MCP';
        target = nice ? `${nice} › ${tool}` : tool;
      } else {
        target = name;
      }
  }
  return { verb, target: clip(String(target || ''), 64) };
}
