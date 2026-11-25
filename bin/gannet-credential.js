#!/usr/bin/env node
'use strict';
// git's credential helper for a repo that pushes as a VS Code account: `gannet-credential <login> get`.
// Asks each running VS Code window's Gannet for the token over its socket; dead sockets are removed.
const fs = require('fs');
const net = require('net');
const path = require('path');

const [login, action] = process.argv.slice(2);
if (action !== 'get' || !login) process.exit(0);   // store and erase: Gannet keeps nothing

function ask(where) {
  return new Promise((resolve) => {
    const sock = net.connect(where);
    let buf = '';
    const done = (v) => { clearTimeout(timer); sock.destroy(); resolve(v); };
    const timer = setTimeout(() => done({ fail: 'timeout' }), 3000);
    sock.setEncoding('utf8');
    sock.on('connect', () => sock.write(login + '\n'));
    sock.on('data', (d) => { buf += d; });
    sock.on('end', () => done(buf.startsWith('ok ') ? { token: buf.slice(3).trim() } : { fail: buf.slice(4).trim() || 'no answer' }));
    sock.on('error', (e) => done({ dead: ['ECONNREFUSED', 'ENOENT', 'ENOTSOCK'].includes(e.code), fail: e.code }));
  });
}

(async () => {
  process.stdin.resume();
  process.stdin.on('data', () => {});   // git's request; only the host matters, and the repo's config scopes it
  const dir = process.env.GANNET_SOCKET_DIR || '';
  let socks = [];
  try { socks = fs.readdirSync(dir).filter((n) => /^token-\d+\.sock$/.test(n)).sort().map((n) => path.join(dir, n)); } catch { socks = []; }
  for (const s of socks) {
    const r = await ask(s);
    if (r.token) { process.stdout.write(`username=${login}\npassword=${r.token}\n`); process.exit(0); }
    if (r.dead) { try { fs.rmSync(s, { force: true }); } catch { /* another helper got there first */ } }
  }
  process.stderr.write(`gannet: no VS Code window is serving ${login} — open VS Code, or add the account to gh\n`);
  process.exit(1);
})();
