'use strict';
// The Workspaces view: a small settings panel listing the directories Gannet checks repos out into.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fakeVscode, installVscode, makeMemento } = require('./stubs.js');
const vscode = fakeVscode();
installVscode(vscode);
const { createWorkspaces } = require('../src/workspaces.js');
const { WorkspaceTree } = require('../src/workspaceTree.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gannet-wstree-'));

(async () => {
  try {
    const home = path.join(tmp, 'home');
    const gh = path.join(home, 'github');
    fs.mkdirSync(gh, { recursive: true });
    const gone = path.join(tmp, 'gone');
    const workspaces = createWorkspaces({ memento: makeMemento(), home });
    await workspaces.add(gh);
    await workspaces.add(gone);
    const tree = new WorkspaceTree({ vscode, workspaces, home });
    const item = (n) => tree.getTreeItem(n);

    const roots = await tree.getChildren();
    assert.deepStrictEqual(roots.map((n) => item(n).label), ['~/github', gone], 'in the order added, ~ for home');
    assert.deepStrictEqual(roots.map((n) => item(n).description), [undefined, 'Missing']);
    assert.deepStrictEqual(roots.map((n) => item(n).contextValue), ['workspace', 'workspace-missing']);
    assert.deepStrictEqual(roots.map((n) => item(n).tooltip), [gh, gone]);
    assert.ok(roots.every((n) => item(n).collapsibleState === vscode.TreeItemCollapsibleState.None), 'nothing expands');
    assert.strictEqual(item(roots[0]).iconPath.id, 'root-folder');
    assert.deepStrictEqual(await tree.getChildren(roots[0]), []);

    let fired = 0;
    tree.onDidChangeTreeData(() => fired++);
    tree.refresh();
    assert.strictEqual(fired, 1);
    console.log('WORKSPACETREE OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); });
