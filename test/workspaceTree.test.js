'use strict';
// The Workspaces view: the listed workspaces, this window's first; each one's folders, repos marked as such.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fakeVscode, installVscode, makeMemento } = require('./stubs.js');
const vscode = fakeVscode();
installVscode(vscode);
const { createWorkspaces } = require('../src/workspaces.js');
const { createLocalRepos } = require('../src/localRepos.js');
const { WorkspaceTree } = require('../src/workspaceTree.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gannet-wstree-'));

(async () => {
  try {
    const home = path.join(tmp, 'home');
    const A = path.join(home, 'work');                 // a folder workspace
    fs.mkdirSync(A, { recursive: true });
    const B = path.join(tmp, 'b.code-workspace');      // a file workspace
    const r1 = path.join(tmp, 'r1');
    fs.mkdirSync(path.join(r1, '.git'), { recursive: true });
    fs.writeFileSync(path.join(r1, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/o/r1.git\n');
    fs.writeFileSync(path.join(r1, 'README.md'), 'r');
    fs.mkdirSync(path.join(tmp, 'plain'));
    fs.writeFileSync(B, JSON.stringify({ folders: [{ path: 'r1' }, { path: 'plain' }, { path: 'gone' }] }));
    const bad = path.join(tmp, 'bad.code-workspace');
    fs.writeFileSync(bad, '{ nope');

    const workspaces = createWorkspaces({ memento: makeMemento(), home });
    const local = createLocalRepos({ memento: makeMemento(), home });
    await workspaces.add({ kind: 'folder', path: A, name: 'work' });
    await workspaces.add({ kind: 'file', path: B, name: 'b' });
    let current = { kind: 'file', path: B, name: 'b' };
    const tree = new WorkspaceTree({ vscode, workspaces, local, current: () => current, home });
    const item = (n) => tree.getTreeItem(n);

    // this window's first, marked; the rest show their path, ~ for home
    let roots = await tree.getChildren();
    assert.deepStrictEqual(roots.map((n) => item(n).label), ['b', 'work']);
    assert.strictEqual(item(roots[0]).description, '● this window');
    assert.strictEqual(item(roots[0]).contextValue, 'workspace-file-current');
    assert.strictEqual(item(roots[1]).description, '~/work');
    assert.strictEqual(item(roots[1]).contextValue, 'workspace-folder');
    assert.deepStrictEqual(item(roots[0]).command, { command: 'gannet.openWorkspace', title: 'Open', arguments: [roots[0]] });
    assert.strictEqual(item(roots[0]).iconPath.id, 'folder-library');
    assert.strictEqual(item(roots[1]).iconPath.id, 'root-folder');

    // an untitled window says how to get listed
    current = { untitled: true };
    roots = await tree.getChildren();
    assert.strictEqual(item(roots.at(-1)).label, 'Untitled workspace — save it to list it');

    // a file workspace's folders: a repo, a plain folder, a missing one
    const kids = await tree.getChildren(roots.find((n) => item(n).label === 'b'));
    assert.deepStrictEqual(kids.map((n) => item(n).label), ['r1', 'plain', 'gone']);
    const [repo, plain, gone] = kids;
    assert.strictEqual(repo.kind, 'wsrepo');
    assert.strictEqual(repo.fullName, 'o/r1');
    assert.strictEqual(item(repo).contextValue, 'repo-local-foreign');
    await local.remember('o/r1', { path: r1, login: 'sean', byGannet: true });
    assert.strictEqual(item(repo).contextValue, 'repo-local');
    assert.ok(/sean/.test(item(repo).description), item(repo).description);
    assert.deepStrictEqual((await tree.getChildren(repo)).map((n) => item(n).label), ['README.md'], '.git hidden');
    assert.strictEqual(plain.kind, 'disk');
    assert.strictEqual(item(plain).collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    assert.deepStrictEqual((await tree.getChildren(gone)).map((n) => item(n).label), ['Not found on disk']);

    // missing, and unreadable, workspaces
    await workspaces.add({ kind: 'folder', path: path.join(tmp, 'vanished'), name: 'vanished' });
    await workspaces.add({ kind: 'file', path: bad, name: 'bad' });
    roots = await tree.getChildren();
    const vanished = roots.find((n) => item(n).label === 'vanished');
    assert.strictEqual(item(vanished).description, 'Missing');
    assert.strictEqual(item(vanished).contextValue, 'workspace-missing');
    assert.strictEqual(item(vanished).collapsibleState, vscode.TreeItemCollapsibleState.None);
    assert.deepStrictEqual(await tree.getChildren(vanished), []);
    const badNode = roots.find((n) => item(n).label === 'bad');
    assert.deepStrictEqual((await tree.getChildren(badNode)).map((n) => item(n).label), [`Cannot read ${bad}`]);

    let fired = 0;
    tree.onDidChangeTreeData(() => fired++);
    tree.refresh();
    assert.strictEqual(fired, 1);
    console.log('WORKSPACETREE OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); });
