'use strict';

// hexa:// serves the renderer its files without opening file:// to it:
//   hexa://app/<path>           the app's own files (renderer, packs, fonts)
//   hexa://sounds/<file>        your custom sounds, in ~/.local/share/hexa/sounds/
//   hexa://packs/<id>/<file>    your character packs, in ~/.local/share/hexa/packs/
// Anything that would leave its folder is refused before it's ever resolved.

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PRIVILEGES = { scheme: 'hexa', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } };

function inside(base, parts) {
  const full = path.resolve(base, ...parts);
  return full.startsWith(base + path.sep) ? full : null;
}

// The file a hexa:// URL stands for, or null. Parsed by hand: the URL parser would quietly fold
// "../" away, and a request that tries it shouldn't be served at all.
function resolveHexaUrl(url, { appDir, dataDir }) {
  const m = /^hexa:\/\/([a-z]+)\/(.*)$/i.exec(String(url));
  if (!m) return null;
  const host = m[1].toLowerCase();
  const raw = m[2].split(/[?#]/)[0];
  let segments;
  try {
    segments = raw.split('/').map((s) => decodeURIComponent(s));
  } catch {
    return null;
  }
  // a decoded segment may still hide a slash ("..%2F..") or a NUL
  segments = segments.flatMap((s) => s.split(/[\\/]/));
  if (segments.some((s) => s === '..' || s.includes('\0'))) return null;
  segments = segments.filter((s) => s && s !== '.');
  if (!segments.length) return null;
  if (host === 'app') return inside(path.resolve(appDir), segments);
  if (host === 'sounds') return inside(path.resolve(dataDir, 'sounds'), segments);
  if (host === 'packs') return inside(path.resolve(dataDir, 'packs'), segments);
  return null;
}

// Before app ready.
function registerPrivileged(protocol) {
  protocol.registerSchemesAsPrivileged([PRIVILEGES]);
}

// After app ready.
function registerHexaProtocol({ protocol, net, appDir, dataDir }) {
  protocol.handle('hexa', (req) => {
    const file = resolveHexaUrl(req.url, { appDir, dataDir });
    if (!file) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString()).catch(() => new Response('not found', { status: 404 }));
  });
}

module.exports = { resolveHexaUrl, registerPrivileged, registerHexaProtocol, PRIVILEGES };
