'use strict';

// The D-Bus session bus for notifications, Do Not Disturb and music, or null when there isn't one
// (a bare X session, ssh, a container): she then simply goes without them.

const fs = require('node:fs');
const path = require('node:path');

function sessionBusAddress(env = process.env, exists = fs.existsSync) {
  if (env.DBUS_SESSION_BUS_ADDRESS) return env.DBUS_SESSION_BUS_ADDRESS;
  // systemd's per-user bus, for sessions that never exported the variable
  const runtime = env.XDG_RUNTIME_DIR;
  const socket = runtime && path.isAbsolute(runtime) ? path.join(runtime, 'bus') : null;
  return socket && exists(socket) ? `unix:path=${socket}` : null;
}

function openSessionBus({ env = process.env, exists = fs.existsSync, dbus = null, log = console } = {}) {
  const busAddress = sessionBusAddress(env, exists);
  if (!busAddress) return null;
  try {
    const bus = (dbus || require('dbus-next')).sessionBus({ busAddress });
    // without a listener a lost connection would be an uncaught exception
    bus.on('error', (err) => log.warn?.(`[hexa] session bus: ${err.message}`));
    return bus;
  } catch (err) {
    log.warn?.(`[hexa] no session bus: ${err.message}`);
    return null;
  }
}

module.exports = { sessionBusAddress, openSessionBus };
