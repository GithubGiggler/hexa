#!/usr/bin/env node
'use strict';

// Hexa's Claude Code hooks from the command line.
//
//   node scripts/hooks.js install            adds them to ~/.claude/settings.json
//   node scripts/hooks.js uninstall          removes them
//   node scripts/hooks.js status
//   node scripts/hooks.js --print-settings   prints a settings file for `claude --settings <file>`

const path = require('node:path');
const paths = require('../src/main/paths');
const claude = require('../src/main/hooks/claude');

const hookSource = path.join(__dirname, '..', 'hooks', 'hexa-hook.js');
const dataDir = paths.dataDir();

try {
  switch (process.argv[2]) {
    case 'install': {
      const r = claude.install({ hookSource, dataDir });
      console.log(`Hexa hooks installed for ${r.events} events in ${r.file}`);
      console.log(`Command: ${r.command}`);
      console.log('Start a new Claude Code session for them to take effect.');
      break;
    }
    case 'uninstall': {
      const r = claude.uninstall();
      console.log(r.removed ? `Hexa hooks removed from ${r.file}` : `No Hexa hooks found in ${r.file}`);
      break;
    }
    case 'status': {
      const r = claude.status();
      if (r.error) console.log(r.error);
      else console.log(r.installed ? `Installed (${r.events.join(', ')}) in ${r.file}` : `Not installed (${r.file})`);
      break;
    }
    case '--print-settings':
      console.log(JSON.stringify(claude.settingsSnippet({ hookSource, dataDir }), null, 2));
      break;
    default:
      console.log('Usage: node scripts/hooks.js install | uninstall | status | --print-settings');
      process.exitCode = 2;
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
