'use strict';
// Workspaces: the list Gannet keeps, which workspace this window has, and reading and editing .code-workspace files.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jsonc = require('jsonc-parser');
const { makeMemento, Uri } = require('./stubs.js');
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
      await ws.add({ kind: 'folder', path: path.join(home, 'x'), name: 'x' });
      await ws.add({ kind: 'folder', path: '~/x', name: 'x' });
      assert.strictEqual(ws.list().length, 1, 'the same path once');
      assert.strictEqual(ws.get('~/x').path, path.join(home, 'x'));
      await ws.add({ kind: 'file', path: '/a/f.code-workspace', name: 'f' });
      await ws.setRepoFolder('/a/f.code-workspace', '/git');
      assert.strictEqual(W.createWorkspaces({ memento, home }).get('/a/f.code-workspace').repoFolder, '/git', 'persisted');
      await ws.remove('~/x');
      assert.deepStrictEqual(ws.list().map((w) => w.name), ['f']);
    }

    // this window's workspace
    {
      const plain = path.join(tmp, 'plain');
      const repo = path.join(tmp, 'repo');
      fs.mkdirSync(plain);
      fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
      const folder = (p) => ({ uri: Uri.file(p) });
      assert.deepStrictEqual(W.currentWorkspace({ workspaceFile: Uri.file('/a/f.code-workspace'), workspaceFolders: [] }), { kind: 'file', path: '/a/f.code-workspace', name: 'f' });
      assert.deepStrictEqual(W.currentWorkspace({ workspaceFile: Uri.parse('untitled:Untitled-1'), workspaceFolders: [folder(plain), folder(repo)] }), { untitled: true });
      assert.deepStrictEqual(W.currentWorkspace({ workspaceFolders: [folder(plain)] }), { kind: 'folder', path: plain, name: 'plain' });
      assert.strictEqual(W.currentWorkspace({ workspaceFolders: [folder(repo)] }), null, 'one repo opened alone is not a workspace');
      assert.strictEqual(W.currentWorkspace({ workspaceFolders: [folder(plain), folder(repo)] }), null);
      assert.strictEqual(W.currentWorkspace({ workspaceFolders: undefined }), null);
      assert.strictEqual(W.isGitRepo(repo), true);
      assert.strictEqual(W.isGitRepo(plain), false);
    }

    // reading and editing a workspace file with comments and trailing commas (Review Focus 1, 2, 4)
    {
      const dir = path.join(tmp, 'w');
      fs.mkdirSync(dir);
      const file = path.join(dir, 'main.code-workspace');
      fs.writeFileSync(file, '{ // c\n "folders": [ {"path": "."}, {"path": "../x"}, {"uri": "vscode-remote://h/p"}, ],\n "settings": {"a": 1}, }\n');
      assert.deepStrictEqual(W.readFolders(file), [dir, path.join(tmp, 'x')]);
      assert.strictEqual(await W.addFolderToFile(file, path.join(dir, 'new')), 'added');
      assert.strictEqual(await W.addFolderToFile(file, '/elsewhere/r'), 'added');
      const text = fs.readFileSync(file, 'utf8');
      assert.ok(text.includes('// c'), 'comment kept');
      const parsed = jsonc.parse(text);
      assert.strictEqual(parsed.folders.length, 5);
      assert.deepStrictEqual(parsed.folders.slice(3), [{ path: 'new' }, { path: '/elsewhere/r' }]);
      assert.deepStrictEqual(parsed.settings, { a: 1 });
      assert.strictEqual(await W.addFolderToFile(file, path.join(dir, 'new')), 'present');
      assert.strictEqual(await W.addFolderToFile(file, path.join(tmp, 'x')), 'present', 'listed as ../x');
      await assert.rejects(W.addFolderToFile(path.join(tmp, 'gone.code-workspace'), '/r'));
      const bad = path.join(tmp, 'bad.code-workspace');
      fs.writeFileSync(bad, '{ "folders": [ oops');
      assert.throws(() => W.readFolders(bad));
      await assert.rejects(W.addFolderToFile(bad, '/r'));
    }

    // a new workspace file
    {
      const dir = path.join(tmp, 'new');
      fs.mkdirSync(dir);
      const f = W.createWorkspaceFile(dir, 'team');
      assert.strictEqual(f, path.join(dir, 'team.code-workspace'));
      assert.strictEqual(fs.readFileSync(f, 'utf8'), '{\n\t"folders": [],\n\t"settings": {}\n}\n');
      assert.throws(() => W.createWorkspaceFile(dir, 'team'));
    }

    // where new clones go
    {
      const dir = path.join(tmp, 'rf');
      fs.mkdirSync(dir);
      const f = path.join(dir, 'w.code-workspace');
      fs.writeFileSync(f, JSON.stringify({ folders: [{ path: '/git/a' }, { path: '/home/c' }, { path: '/git/b' }] }));
      assert.strictEqual(W.repoFolderOf({ kind: 'file', path: f }), '/git');
      assert.strictEqual(W.repoFolderOf({ kind: 'file', path: f, repoFolder: '/elsewhere' }), '/elsewhere');
      fs.writeFileSync(f, JSON.stringify({ folders: [{ path: '/b/x' }, { path: '/a/y' }] }));
      assert.strictEqual(W.repoFolderOf({ kind: 'file', path: f }), '/b', 'a tie goes to the first');
      fs.writeFileSync(f, JSON.stringify({ folders: [] }));
      assert.strictEqual(W.repoFolderOf({ kind: 'file', path: f }), dir);
      assert.strictEqual(W.repoFolderOf({ kind: 'file', path: path.join(dir, 'gone.code-workspace') }), dir);
      assert.strictEqual(W.repoFolderOf({ kind: 'folder', path: '/s/home' }), '/s/home');
    }

    // a folder workspace's folders; existence
    {
      const dir = path.join(tmp, 'fw');
      for (const n of ['Beta', 'alpha', '.hidden', 'x.gannet-partial-1']) fs.mkdirSync(path.join(dir, n), { recursive: true });
      fs.writeFileSync(path.join(dir, 'file.txt'), '');
      assert.deepStrictEqual(W.foldersOf({ kind: 'folder', path: dir }), [path.join(dir, 'alpha'), path.join(dir, 'Beta')]);
      assert.strictEqual(W.exists({ kind: 'folder', path: dir }), true);
      assert.strictEqual(W.exists({ kind: 'folder', path: path.join(tmp, 'nope') }), false);
      assert.strictEqual(W.exists({ kind: 'file', path: path.join(tmp, 'w', 'main.code-workspace') }), true);
    }
    console.log('WORKSPACES OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); });
