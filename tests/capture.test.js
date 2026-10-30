'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCapture, fitScale } = require('../src/main/platform/linux/capture');
const { createSecrets } = require('../src/main/secrets');

test('screenshots fit 1280×800: 2560×1440 comes out at half', () => {
  assert.equal(fitScale(2560, 1440), 0.5);
  assert.equal(fitScale(1024, 768), 1);
});

function fakeImage(w, h, log) {
  return {
    getSize: () => ({ width: w, height: h }),
    toPNG: () => Buffer.from(`png ${w}x${h}`),
    crop: (r) => { log.push(['crop', r]); return fakeImage(r.width, r.height, log); },
    resize: ({ width, height }) => { log.push(['resize', width, height]); return fakeImage(width, height, log); },
  };
}

test('capture, map back, and zoom on the second screen', async () => {
  const log = [];
  const display = { id: 7, bounds: { x: 2560, y: 0, width: 2560, height: 1440 }, scaleFactor: 1 };
  const cap = createCapture({
    desktopCapturer: { getSources: async ({ thumbnailSize }) => { log.push(['grab', thumbnailSize]); return [{ display_id: '3', thumbnail: fakeImage(1, 1, log) }, { display_id: '7', thumbnail: fakeImage(thumbnailSize.width, thumbnailSize.height, log) }]; } },
    getDisplay: () => display,
    cursor: () => ({ x: 2560 + 200, y: 100 }),
  });
  const shot = await cap.capture();
  assert.deepEqual([shot.width, shot.height], [1280, 720]);
  assert.deepEqual(cap.toScreen([640, 360]), [2560 + 1280, 720], 'the middle of the shot is the middle of that screen');
  assert.deepEqual(cap.cursor(), [100, 50]);
  const zoom = await cap.capture({ region: [100, 100, 300, 200] });
  assert.deepEqual(log.find((l) => l[0] === 'crop')[1], { x: 200, y: 200, width: 400, height: 200 });
  assert.deepEqual([zoom.width, zoom.height], [400, 200]);
});

test('the API key: kept only with a keyring, encrypted, readable only by you', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-key-'));
  const safe = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'kwallet6', encryptString: (s) => Buffer.from(`enc:${s}`), decryptString: (b) => b.toString().slice(4) };
  const secrets = createSecrets({ safe, dir });
  assert.throws(() => secrets.save('hello'), /doesn't look like/);
  secrets.save('sk-ant-api03-abcdefghijklmnop');
  assert.equal(secrets.load(), 'sk-ant-api03-abcdefghijklmnop');
  const file = path.join(dir, 'claude-key.bin');
  assert.ok(!fs.readFileSync(file, 'utf8').startsWith('sk-ant'), 'not in the clear');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  secrets.clear();
  assert.equal(secrets.load(), null);
  const plain = createSecrets({ safe: { ...safe, getSelectedStorageBackend: () => 'basic_text' }, dir });
  assert.throws(() => plain.save('sk-ant-api03-abcdefghijklmnop'), /No keyring/);
});
