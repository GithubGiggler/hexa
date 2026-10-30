'use strict';

// Talking to her out loud, on your machine only: what you say is recorded by her page, turned into
// 16 kHz mono WAV by ffmpeg, and into text by whisper.cpp (whisper-cli, or whisper-cpp as some
// distros name it) with a ggml model you downloaded. Nothing leaves the machine; without whisper
// or a model there's simply no mic button.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const BINARIES = ['whisper-cli', 'whisper-cpp'];
const MAX_AUDIO = 10 * 1024 * 1024; // about ten minutes of opus; far more than a sentence

function onPath(name, PATH = process.env.PATH || '') {
  for (const dir of PATH.split(':')) {
    if (!dir) continue;
    const full = path.join(dir, name);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return full;
    } catch { /* not here */ }
  }
  return null;
}

// the model: HEXA_WHISPER_MODEL, else the first ggml-*.bin in ~/.local/share/hexa/whisper/
function findModel(dataDir, env = process.env) {
  if (env.HEXA_WHISPER_MODEL && fs.existsSync(env.HEXA_WHISPER_MODEL)) return env.HEXA_WHISPER_MODEL;
  const dir = path.join(dataDir, 'whisper');
  try {
    const f = fs.readdirSync(dir).filter((n) => /^ggml-.*\.bin$/.test(n)).sort()[0];
    return f ? path.join(dir, f) : null;
  } catch {
    return null;
  }
}

const run = (file, args, opts) => new Promise((resolve, reject) => {
  execFile(file, args, { timeout: 120000, maxBuffer: 4 * 1024 * 1024, ...opts }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().split('\n').pop())) : resolve(String(stdout))));
});

function createVoiceInput({ dataDir, env = process.env }) {
  const find = () => ({
    whisper: BINARIES.map((b) => onPath(b, env.PATH)).find(Boolean) || null,
    ffmpeg: onPath('ffmpeg', env.PATH),
    model: findModel(dataDir, env),
  });
  return {
    // { ok, why }: why there's no mic button
    available() {
      const f = find();
      if (!f.whisper) return { ok: false, why: 'Install whisper.cpp (whisper-cli) to talk to me out loud.' };
      if (!f.model) return { ok: false, why: `Put a whisper model (ggml-*.bin) in ${path.join(dataDir, 'whisper')}.` };
      if (!f.ffmpeg) return { ok: false, why: 'Install ffmpeg to talk to me out loud.' };
      return { ok: true };
    },
    // audio: what her page recorded (webm/opus). Resolves the text.
    async transcribe(audio, { lang = 'auto' } = {}) {
      const f = find();
      if (!f.whisper || !f.model || !f.ffmpeg) throw new Error('voice isn\'t set up');
      const buf = Buffer.from(audio);
      if (!buf.length || buf.length > MAX_AUDIO) throw new Error('no usable recording');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-voice-'));
      try {
        const input = path.join(dir, 'in.webm');
        const wav = path.join(dir, 'in.wav');
        fs.writeFileSync(input, buf, { mode: 0o600 });
        // WebM only, files only: nothing her page sends can make ffmpeg read anything else
        await run(f.ffmpeg, ['-nostdin', '-loglevel', 'error', '-protocol_whitelist', 'file', '-f', 'webm', '-i', input, '-ar', '16000', '-ac', '1', '-f', 'wav', wav]);
        const out = await run(f.whisper, ['-m', f.model, '-f', wav, '-nt', '-np', '-l', lang]);
        return out.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
      } finally {
        fs.rmSync(dir, { recursive: true, force: true }); // your voice isn't kept
      }
    },
  };
}

module.exports = { createVoiceInput, findModel, onPath };
