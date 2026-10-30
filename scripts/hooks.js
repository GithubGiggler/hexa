#!/usr/bin/env node
'use strict';

// Hexa's hooks from the command line, without the app running.
//
//   node scripts/hooks.js install [--assistant claude|codex|agy]   adds them (Claude Code's by default:
//                                                                 ~/.claude/settings.json)
//   node scripts/hooks.js uninstall [--assistant …]                removes them
//   node scripts/hooks.js status [--assistant …]
//   node scripts/hooks.js --print-settings                         prints a settings file for
//                                                                 `claude --settings <file>`

const path = require('node:path');
const paths = require('../src/main/paths');
const claude = require('../src/main/hooks/claude');
const assistants = require('../src/main/hooks');

const appDir = path.join(__dirname, '..');
const hookSource = path.join(appDir, 'hooks', 'hexa-hook.js');
const dataDir = paths.dataDir();
const NEXT = {
  claude: 'Start a new Claude Code session for them to take effect.',
  codex: 'Codex runs only the hooks you trust: start a new Codex session, type /hooks and trust Hexa’s.',
  agy: 'Restart Antigravity (or start a new conversation) for them to take effect.',
};

const args = process.argv.slice(2);
const at = args.findIndex((a) => a === '--assistant' || a.startsWith('--assistant='));
const named = at === -1 ? 'claude' : args[at].includes('=') ? args[at].split('=')[1] : args[at + 1];
const assistant = assistants.assistantOf(named);

try {
  if (!assistant) throw new Error(`--assistant takes ${assistants.ASSISTANTS.join(', ')}`);
  switch (args[0]) {
    case 'install': {
      const r = assistants.install(assistant, { appDir, dataDir });
      console.log(`Hexa hooks installed for ${r.events} events in ${r.file}`);
      console.log(`Command: ${r.command}`);
      console.log(NEXT[assistant]);
      if (r.warning) console.log(`Note: ${r.warning}`);
      break;
    }
    case 'uninstall': {
      const r = assistants.uninstall(assistant);
      console.log(r.removed ? `Hexa hooks removed from ${r.file}` : `No Hexa hooks found in ${r.file}`);
      break;
    }
    case 'status': {
      const r = assistants.status(assistant);
      if (r.error) console.log(r.error);
      else console.log(r.installed ? `Installed (${r.events.join(', ')}) in ${r.file}` : `Not installed (${r.file})`);
      if (r.warning) console.log(`Note: ${r.warning}`);
      break;
    }
    case '--print-settings':
      console.log(JSON.stringify(claude.settingsSnippet({ hookSource, dataDir }), null, 2));
      break;
    default:
      console.log('Usage: node scripts/hooks.js install | uninstall | status [--assistant claude|codex|agy] | --print-settings');
      process.exitCode = 2;
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
