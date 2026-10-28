import test from 'node:test';
import assert from 'node:assert/strict';
import { describeTool } from '../src/renderer/js/labels.js';
import { VERBS } from '../src/renderer/js/lines/en.js';

const d = (tool_name, tool_input = {}) => describeTool({ tool_name, tool_input }, VERBS);

test('files are shown by their name', () => {
  assert.deepEqual(d('Edit', { file_path: '/home/u/p/src/gigs.ts' }), { verb: 'EDITS', target: 'gigs.ts' });
  assert.deepEqual(d('Read', { file_path: '/home/u/p/README.md' }), { verb: 'READS', target: 'README.md' });
  assert.deepEqual(d('NotebookEdit', { notebook_path: '/n/a.ipynb' }), { verb: 'EDITS', target: 'a.ipynb' });
});

test('commands prefer their description', () => {
  assert.deepEqual(d('Bash', { command: 'npm test', description: 'Run tests' }), { verb: 'RUNS', target: 'Run tests' });
  assert.deepEqual(d('Bash', { command: 'npm test' }), { verb: 'RUNS', target: 'npm test' });
});

test('search, web and agents', () => {
  assert.deepEqual(d('Grep', { pattern: 'paginate' }), { verb: 'GREPS', target: '“paginate”' });
  assert.deepEqual(d('Glob', { pattern: 'src/**/*.ts' }), { verb: 'GLOBS', target: 'src/**/*.ts' });
  assert.deepEqual(d('WebFetch', { url: 'https://docs.example.com/a?b' }), { verb: 'FETCHES', target: 'docs.example.com' });
  assert.deepEqual(d('WebSearch', { query: 'x11 input shape' }), { verb: 'SEARCHES', target: 'x11 input shape' });
  assert.deepEqual(d('Agent', { description: 'Find the bug', subagent_type: 'Explore' }), { verb: 'DELEGATES', target: 'Find the bug' });
  assert.deepEqual(d('Skill', { skill: 'pdf' }), { verb: 'SKILL', target: 'pdf' });
});

test('MCP tools read as server › tool, generated server ids dropped', () => {
  assert.deepEqual(d('mcp__github__create_issue'), { verb: 'MCP', target: 'github › create issue' });
  assert.deepEqual(d('mcp__0b1f2c3d-4e5f-6789-abcd-ef0123456789__read'), { verb: 'MCP', target: 'read' });
});

test('unknown tools use the default verb and their own name', () => {
  assert.deepEqual(d('Frobnicate'), { verb: 'USES', target: 'Frobnicate' });
});

test('targets are clipped to 64 characters', () => {
  assert.ok(d('Read', { file_path: '/a/' + 'é'.repeat(100) }).target.length <= 64);
});
