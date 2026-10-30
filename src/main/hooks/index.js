'use strict';

// The assistants Hexa can watch, and their hook installers, behind one face:
//   install(assistant, { appDir, dataDir }), uninstall(assistant), status(assistant)
// 'claude' is Claude Code (claude.js), 'codex' the OpenAI Codex CLI (codex.js), 'agy' Google
// Antigravity (antigravity.js). Their hooks mark their sessions codex:… and agy:… (Claude's carry
// no prefix), and every event says whose it is in `assistant`.

const path = require('node:path');
const claude = require('./claude');
const codex = require('./codex');
const antigravity = require('./antigravity');

const ASSISTANTS = ['claude', 'codex', 'agy'];
const NAMES = { claude: 'Claude Code', codex: 'Codex', agy: 'Antigravity' };
const ALIASES = { 'claude-code': 'claude', antigravity: 'agy', 'codex-cli': 'codex' };
const INSTALLERS = { claude, codex, agy: antigravity };

// 'Codex', 'antigravity'… -> 'codex', 'agy'; null for anything else.
function assistantOf(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().toLowerCase();
  const id = Object.hasOwn(ALIASES, name) ? ALIASES[name] : name;
  return ASSISTANTS.includes(id) ? id : null;
}

// Whose event it is: the session's prefix says (the same rule as the renderer's brain).
function ownerOf(evt) {
  return /^(codex|agy):/.exec(String(evt?.session_id || ''))?.[1] || 'claude';
}

function installer(assistant) {
  const id = assistantOf(assistant);
  if (!id) throw new Error(`no hooks for "${String(assistant).slice(0, 20)}" (there are ${ASSISTANTS.join(', ')})`);
  return INSTALLERS[id];
}

// appDir: where the app's hooks/ folder is. hasNode: for tests (otherwise looked up).
function install(assistant, { appDir, dataDir, hasNode }) {
  const hooksDir = path.join(appDir, 'hooks');
  if (assistantOf(assistant) === 'claude') return claude.install({ hookSource: path.join(hooksDir, claude.MARK), dataDir, hasNode });
  return installer(assistant).install({ hooksDir, dataDir, hasNode });
}

const uninstall = (assistant) => installer(assistant).uninstall();
const status = (assistant) => installer(assistant).status();

module.exports = { ASSISTANTS, NAMES, assistantOf, ownerOf, install, uninstall, status, installer };
