'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createVoiceInput } = require('../src/main/brain/voice-input');

// fake ffmpeg and whisper-cli on a PATH of their own
function fakeTools({ whisper = true, model = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-voice-test-'));
  const bin = path.join(root, 'bin');
  const data = path.join(root, 'data');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(data, 'whisper'), { recursive: true });
  const script = (name, body) => { fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 }); };
  // ffmpeg: copies the input to the output (last argument)
  script('ffmpeg', 'for a; do last="$a"; done; printf wav > "$last"');
  if (whisper) script('whisper-cli', 'echo "[00:00.000 --> 00:02.000]  Open   the  settings, please."');
  if (model) fs.writeFileSync(path.join(data, 'whisper', 'ggml-base.en.bin'), 'model');
  return { env: { PATH: bin }, data };
}

test('no whisper or no model: no mic button, and why', () => {
  const a = fakeTools({ whisper: false });
  assert.match(createVoiceInput({ dataDir: a.data, env: a.env }).available().why, /whisper\.cpp/);
  const b = fakeTools({ model: false });
  assert.match(createVoiceInput({ dataDir: b.data, env: b.env }).available().why, /ggml/);
  const c = fakeTools();
  assert.equal(createVoiceInput({ dataDir: c.data, env: c.env }).available().ok, true);
});

test('what you said, as text, and the recording isn\'t kept', async () => {
  const t = fakeTools();
  const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('hexa-voice-') && !n.startsWith('hexa-voice-test-')).length;
  const text = await createVoiceInput({ dataDir: t.data, env: t.env }).transcribe(Buffer.from('opus bytes'));
  assert.equal(text, 'Open the settings, please.');
  const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('hexa-voice-') && !n.startsWith('hexa-voice-test-')).length;
  assert.equal(after, before);
  await assert.rejects(createVoiceInput({ dataDir: t.data, env: t.env }).transcribe(Buffer.alloc(0)), /no usable recording/);
});
