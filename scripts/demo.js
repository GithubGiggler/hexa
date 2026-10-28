#!/usr/bin/env node
'use strict';

// Plays the demo session to a running Hexa over her socket, as Claude Code's hooks would.
//   npm run demo          (HEXA_DEMO_SPEED=4 plays it four times faster)

const http = require('node:http');
const paths = require('../src/main/paths');
const { STEPS } = require('../src/main/demo');

const socketPath = paths.socketPath();
const speed = Number(process.env.HEXA_DEMO_SPEED) || 1;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request({
      socketPath, path, method, timeout: 2000,
      headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {},
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(data);
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  try {
    await request('GET', '/health');
  } catch {
    console.error("Hexa isn't running: start her with npm start");
    process.exit(1);
  }
  console.log(`Playing the demo (${STEPS.length} events)…`);
  for (const [delay, evt] of STEPS) {
    await wait(delay / speed);
    await request('POST', '/event', evt).catch((err) => console.error(`  ${evt.hook_event_name}: ${err.message}`));
  }
  console.log('Done.');
})();
