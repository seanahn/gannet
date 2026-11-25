'use strict';
// Pushing as a VS Code account: each VS Code window serves its tokens on a socket only this user can open, and the
// credential helper git runs asks those sockets.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { startTokenServer, writeShim, socketDir } = require('../src/tokenServer.js');

const HELPER = path.join(__dirname, '..', 'bin', 'gannet-credential.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gannet-tok-'));
const run = (cmd, args, input, env = process.env) => new Promise((resolve) => {
  const child = spawn(cmd, args, { env });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (code) => resolve({ code, stdout, stderr }));
  child.stdin.end(input);
});
const helper = (dir, args, input = 'protocol=https\nhost=github.com\n\n') => run(process.execPath, [HELPER, ...args], input, { ...process.env, GANNET_SOCKET_DIR: dir });

(async () => {
  try {
    const store = path.join(tmp, 'globalStorage');
    const tokens = { seanahn: 'vs-sean-token' };
    const server = await startTokenServer({ dir: store, token: async (login) => { if (!tokens[login]) throw new Error(`${login} is signed out of VS Code`); return tokens[login]; } });
    assert.strictEqual(path.dirname(server.path), socketDir(store));
    assert.ok(/token-\d+\.sock$/.test(server.path), server.path);
    assert.strictEqual(fs.statSync(server.path).mode & 0o777, 0o600, 'socket only for this user');
    assert.strictEqual(fs.statSync(path.dirname(server.path)).mode & 0o777, 0o700);

    // a stale socket file from a closed window is removed, and the live one answers
    const stale = path.join(path.dirname(server.path), 'token-0.sock');
    fs.writeFileSync(stale, '');
    let r = await helper(path.dirname(server.path), ['seanahn', 'get']);
    assert.strictEqual(r.code, 0, r.stderr);
    assert.strictEqual(r.stdout, 'username=seanahn\npassword=vs-sean-token\n');
    assert.ok(!fs.existsSync(stale), 'stale socket removed');

    // an account the window cannot serve
    r = await helper(path.dirname(server.path), ['alice', 'get']);
    assert.strictEqual(r.code, 1);
    assert.ok(r.stderr.includes('no VS Code window is serving alice'), r.stderr);
    assert.strictEqual(r.stdout, '');

    // git's store and erase are ignored
    r = await helper(path.dirname(server.path), ['seanahn', 'store']);
    assert.deepStrictEqual([r.code, r.stdout], [0, '']);

    // no window running at all
    await server.close();
    assert.ok(!fs.existsSync(server.path));
    r = await helper(path.dirname(server.path), ['seanahn', 'get']);
    assert.strictEqual(r.code, 1);
    assert.ok(r.stderr.includes('gannet: no VS Code window is serving seanahn — open VS Code, or add the account to gh'), r.stderr);

    // a socket path too long for the OS falls back to a folder under the temp dir
    const deep = path.join(tmp, 'x'.repeat(120));
    assert.strictEqual(socketDir(deep), path.join(os.tmpdir(), 'gannet-' + os.userInfo().uid));

    // the shim runs this VS Code's own Node on the helper, and is rewritten each start
    const shim = writeShim({ dir: store, execPath: '/opt/code/code', script: HELPER, socketDir: socketDir(store) });
    assert.strictEqual(shim, path.join(store, 'gannet-credential'));
    const text = fs.readFileSync(shim, 'utf8');
    assert.ok(text.startsWith('#!/bin/sh\n'));
    assert.ok(text.includes(`GANNET_SOCKET_DIR="${socketDir(store)}"`));
    assert.ok(text.includes(`ELECTRON_RUN_AS_NODE=1 exec "/opt/code/code" "${HELPER}" "$@"`), text);
    assert.strictEqual(fs.statSync(shim).mode & 0o777, 0o700);
    writeShim({ dir: store, execPath: process.execPath, script: HELPER, socketDir: socketDir(store) });
    assert.ok(fs.readFileSync(shim, 'utf8').includes(process.execPath));

    // and the shim really works as git's helper
    const server2 = await startTokenServer({ dir: store, token: async () => 'vs-again' });
    const out = await run(shim, ['seanahn', 'get'], 'host=github.com\n\n');   // not spawnSync: the server is in this process
    assert.strictEqual(out.code, 0, out.stderr);
    assert.strictEqual(out.stdout, 'username=seanahn\npassword=vs-again\n');
    await server2.close();
    console.log('TOKENSERVER OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); });
