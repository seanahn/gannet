'use strict';
// Workspaces: the directories Gannet keeps checkouts in, which one a checkout belongs to, and carrying 0.2.0's list
// (folders and .code-workspace files) and the old checkout folder over, once.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeMemento } = require('./stubs.js');
const W = require('../src/workspaces.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gannet-ws-'));

(async () => {
  try {
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home, { recursive: true });

    // the stored list
    {
      const memento = makeMemento();
      const ws = W.createWorkspaces({ memento, home });
      await ws.add('~/x');
      await ws.add(path.join(home, 'x'));
      await ws.add('/b');
      assert.deepStrictEqual(ws.list(), [path.join(home, 'x'), '/b'], 'once each, in the order added');
      assert.deepStrictEqual(memento.get(W.KEY), [path.join(home, 'x'), '/b']);
      await ws.remove('~/x');
      assert.deepStrictEqual(ws.list(), ['/b']);
    }

    // which workspace a checkout belongs to: the deepest listed one
    {
      const list = [home, path.join(home, 'github')];
      assert.strictEqual(W.workspaceOf(path.join(home, 'github', 'perch'), list), path.join(home, 'github'));
      assert.strictEqual(W.workspaceOf(path.join(home, 'other', 'r'), list), home);
      assert.strictEqual(W.workspaceOf('/elsewhere/r', list), null);
      assert.strictEqual(W.workspaceOf(path.join(home + 'x', 'r'), [home]), null, 'a prefix is not a parent');
      assert.strictEqual(W.labelOf(path.join(home, 'github', 'perch'), list, home), '~/github');
      assert.strictEqual(W.labelOf(path.join(home, 'other', 'r'), list, home), '~');
      assert.strictEqual(W.labelOf('/elsewhere/r', list, home), '/elsewhere');
      assert.strictEqual(W.tilde('/git', home), '/git');
    }

    // JSON with comments and trailing commas, as .code-workspace files are
    {
      assert.deepStrictEqual(W.parseJsonc('{ "a": "//x", /* c */ "b": [1,], // d\n }'), { a: '//x', b: [1] });
      assert.deepStrictEqual(W.parseJsonc('{ "a": "x\\"/*y*/" }'), { a: 'x"/*y*/' });
      assert.throws(() => W.parseJsonc('{ "a": [ oops'));
    }

    // carrying 0.2.0's list and the old checkout folder over
    {
      const wdir = path.join(tmp, 'w');
      fs.mkdirSync(wdir);
      const wsFile = path.join(wdir, 'main.code-workspace');
      fs.writeFileSync(wsFile, '{ // team\n "folders": [ {"path": "/git/a"}, {"path": "/git/b"}, {"path": "/home/c"}, ],\n}\n');
      const setFile = path.join(wdir, 'set.code-workspace');
      fs.writeFileSync(setFile, '{ "folders": [] }');
      const badFile = path.join(wdir, 'bad.code-workspace');
      fs.writeFileSync(badFile, '{ "folders": [ oops');
      const F = path.join(tmp, 'f');
      fs.mkdirSync(path.join(home, 'github'));
      const memento = makeMemento({ [W.KEY]: [
        { kind: 'folder', path: F, name: 'f' },
        { kind: 'file', path: wsFile, name: 'main' },
        { kind: 'file', path: setFile, name: 'set', repoFolder: '/r' },
        { kind: 'file', path: badFile, name: 'bad' },
        { kind: 'folder', path: '/git', name: 'git' },
      ] });
      await W.migrate({ memento, home, checkoutFolder: '~/github' });
      const ws = W.createWorkspaces({ memento, home });
      assert.deepStrictEqual(ws.list(), [F, '/git', '/r', wdir, path.join(home, 'github')]);
      assert.strictEqual(memento.get(W.MIGRATED), 3);
      // Review Focus 5: removed after the upgrade, it stays removed
      await ws.remove('~/github');
      await W.migrate({ memento, home, checkoutFolder: '~/github' });
      assert.deepStrictEqual(ws.list(), [F, '/git', '/r', wdir]);
    }

    // a fresh install: nothing listed unless the old checkout folder exists
    {
      const memento = makeMemento();
      await W.migrate({ memento, home: path.join(tmp, 'nohome'), checkoutFolder: undefined });
      assert.deepStrictEqual(W.createWorkspaces({ memento, home }).list(), []);
      assert.strictEqual(memento.get(W.MIGRATED), 3);
    }

    // existence, and git repos
    {
      const repo = path.join(tmp, 'repo');
      fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
      assert.strictEqual(W.exists(home), true);
      assert.strictEqual(W.exists(path.join(tmp, 'nope')), false);
      assert.strictEqual(W.isGitRepo(repo), true);
      assert.strictEqual(W.isGitRepo(home), false);
    }
    console.log('WORKSPACES OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); });
