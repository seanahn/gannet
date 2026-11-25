'use strict';
// The read-only gannet: file system: files of a repo that is only on GitHub, opened in an editor.
const assert = require('assert');
const { fakeVscode, installVscode } = require('./stubs.js');
const vscode = fakeVscode();
installVscode(vscode);
const { GitHubError } = require('../src/github.js');
const { GannetFs, toUri, fromUri } = require('../src/fsProvider.js');

async function rejects(p) { try { await p; } catch (e) { return e; } throw new Error('expected a rejection'); }

(async () => {
  // URIs round-trip names with spaces, '#', '?', '%' and non-ASCII
  {
    const u = toUri(vscode, 'seanahn', 'o', 'r', 'dir/a b#?%é.txt');
    assert.strictEqual(u.scheme, 'gannet');
    assert.strictEqual(u.authority, 'seanahn');
    assert.deepStrictEqual(fromUri(vscode.Uri.parse(u.toString())), { login: 'seanahn', owner: 'o', repo: 'r', path: 'dir/a b#?%é.txt' });
    assert.deepStrictEqual(fromUri(toUri(vscode, 'l', 'o', 'r', '')), { login: 'l', owner: 'o', repo: 'r', path: '' });
  }
  // reading, listing, stat
  const calls = [];
  let fail = null;
  const client = {
    readFile: async (o, r, p) => { calls.push(['read', o, r, p]); if (fail) throw fail; return new TextEncoder().encode('content of ' + p); },
    listDir: async (o, r, p) => { calls.push(['list', o, r, p]); if (fail) throw fail; return { entries: [{ name: 'a.js', path: (p ? p + '/' : '') + 'a.js', type: 'file', size: 3 }, { name: 'lib', path: (p ? p + '/' : '') + 'lib', type: 'dir', size: 0 }], truncated: false }; },
  };
  const forgotten = [];
  const gfs = new GannetFs({ vscode, clientFor: (login) => { assert.strictEqual(login, 'seanahn'); return client; }, accounts: { forget: (l) => forgotten.push(l) } });
  const uri = toUri(vscode, 'seanahn', 'o', 'r', 'src/a b.js');
  assert.strictEqual(new TextDecoder().decode(await gfs.readFile(uri)), 'content of src/a b.js');
  assert.deepStrictEqual(calls.at(-1), ['read', 'o', 'r', 'src/a b.js']);
  assert.deepStrictEqual(await gfs.readDirectory(toUri(vscode, 'seanahn', 'o', 'r', 'src')), [['a.js', vscode.FileType.File], ['lib', vscode.FileType.Directory]]);
  assert.strictEqual((await gfs.stat(toUri(vscode, 'seanahn', 'o', 'r', 'src/a.js'))).type, vscode.FileType.File);
  assert.strictEqual((await gfs.stat(toUri(vscode, 'seanahn', 'o', 'r', 'src/lib'))).type, vscode.FileType.Directory);
  assert.strictEqual((await gfs.stat(toUri(vscode, 'seanahn', 'o', 'r', ''))).type, vscode.FileType.Directory, 'the repo root');
  assert.strictEqual((await gfs.stat(toUri(vscode, 'seanahn', 'o', 'r', 'src/a.js'))).size, 3);
  assert.strictEqual((await rejects(gfs.stat(toUri(vscode, 'seanahn', 'o', 'r', 'src/nope')))).code, 'FileNotFound');

  // errors mapped
  fail = new GitHubError('auth', 401, 'Bad credentials');
  let e = await rejects(gfs.readFile(uri));
  assert.strictEqual(e.code, 'NoPermissions');
  assert.ok(e.message.includes('signed out of seanahn'), e.message);
  assert.deepStrictEqual(forgotten, ['seanahn']);
  fail = new GitHubError('sso', 403, 'SSO', { ssoUrl: 'https://x' });
  e = await rejects(gfs.readFile(uri));
  assert.strictEqual(e.code, 'NoPermissions');
  assert.ok(e.message.includes('o needs SSO authorization'), e.message);
  fail = new GitHubError('notFound', 404, 'Not Found');
  assert.strictEqual((await rejects(gfs.readFile(uri))).code, 'FileNotFound');
  fail = new GitHubError('rate', 403, 'API rate limit exceeded');
  e = await rejects(gfs.readFile(uri));
  assert.strictEqual(e.code, 'Unavailable');
  assert.ok(e.message.includes('rate limit'), e.message);

  // nothing can be written
  for (const op of [() => gfs.writeFile(uri, new Uint8Array(), { create: true, overwrite: true }), () => gfs.delete(uri), () => gfs.rename(uri, uri), () => gfs.createDirectory(uri)]) {
    assert.strictEqual((await rejects(Promise.resolve().then(op))).code, 'NoPermissions');
  }
  assert.ok(typeof gfs.onDidChangeFile === 'function');
  assert.ok(gfs.watch(uri) && typeof gfs.watch(uri).dispose === 'function');
  console.log('FSPROVIDER OK');
})().catch((e) => { console.error(e); process.exit(1); });
