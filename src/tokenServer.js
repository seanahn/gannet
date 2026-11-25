'use strict';
// Tokens for VS Code accounts live only inside VS Code, so each window serves them on a socket only this user can
// open (token-<pid>.sock in a 0700 folder; a named pipe on Windows). git reaches it through the credential helper
// bin/gannet-credential.js, run by a small shim kept in Gannet's global storage, a path that survives updates.
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const MAX_SOCKET_PATH = 100;   // unix socket paths are limited to about 104-108 bytes

function uid() { try { return os.userInfo().uid; } catch { return 'user'; } }

/** The folder the sockets live in: <store>/sockets, or a folder under the temp dir when that path is too long. */
function socketDir(store) {
  const dir = path.join(store, 'sockets');
  return path.join(dir, `token-${process.pid}.sock`).length > MAX_SOCKET_PATH ? path.join(os.tmpdir(), `gannet-${uid()}`) : dir;
}

function startTokenServer({ dir, token }) {
  const win = process.platform === 'win32';
  const sockDir = socketDir(dir);
  const where = win ? `\\\\.\\pipe\\gannet-${os.userInfo().username}-${process.pid}` : path.join(sockDir, `token-${process.pid}.sock`);
  if (!win) {
    fs.mkdirSync(sockDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(sockDir, 0o700);
    fs.rmSync(where, { force: true });
  }
  const server = net.createServer((sock) => {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('error', () => {});
    sock.on('data', async (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      const login = buf.slice(0, nl).trim();
      buf = '';
      try { sock.end(`ok ${await token(login)}\n`); } catch (e) { sock.end(`err ${String(e && e.message || e).replace(/\n/g, ' ')}\n`); }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(where, () => {
      if (!win) fs.chmodSync(where, 0o600);
      resolve({
        path: where,
        close: () => new Promise((r) => server.close(() => { if (!win) fs.rmSync(where, { force: true }); r(); })),
      });
    });
  });
}

/** Writes <dir>/gannet-credential, which runs this VS Code's own Node on the helper; rewritten on every start. */
function writeShim({ dir, execPath, script, socketDir: sockDir }) {
  fs.mkdirSync(dir, { recursive: true });
  const shim = path.join(dir, 'gannet-credential');
  const q = (s) => String(s).replace(/(["\\$`])/g, '\\$1');
  fs.writeFileSync(shim, `#!/bin/sh\n# Written by Gannet on every start: git's credential helper for repos that push as a VS Code account.\nGANNET_SOCKET_DIR="${q(sockDir)}" ELECTRON_RUN_AS_NODE=1 exec "${q(execPath)}" "${q(script)}" "$@"\n`, { mode: 0o700 });
  fs.chmodSync(shim, 0o700);
  return shim;
}

module.exports = { startTokenServer, writeShim, socketDir };
