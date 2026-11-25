'use strict';
// The sidebar webview provider: answers the page from the tree model, runs clicks and buttons, and names the row a
// right-click was on.
const assert = require('assert');
const path = require('path');
const { fakeVscode, installVscode } = require('./stubs.js');
const vscode = fakeVscode();
installVscode(vscode);
const { makeTreeFixture } = require('./fixture.js');
const { GannetSidebar } = require('../src/sidebar.js');

(async () => {
  const fx = await makeTreeFixture(vscode);
  try {
    const rec = vscode._rec;
    const gh = path.join(fx.home, 'github'), gone = path.join(fx.home, 'gone');
    await fx.workspaces.add(gone);
    const sidebar = new GannetSidebar({ vscode, tree: fx.tree, workspaces: fx.workspaces, home: fx.home, extensionUri: vscode.Uri.file('/ext') });
    assert.strictEqual(GannetSidebar.viewType, 'gannet.main');
    vscode.window.registerWebviewViewProvider(GannetSidebar.viewType, sidebar);
    const view = vscode._resolveView('gannet.main');
    assert.strictEqual(view.webview.options.enableScripts, true);
    assert.ok(view.webview.html.includes('Content-Security-Policy'));
    assert.ok(view.webview.html.includes('/ext/media/page.js'));
    await view._send({ type: 'ready' });
    assert.deepStrictEqual(view._posted[0], { type: 'workspaces', items: [{ path: gh, label: '~/github', missing: false }, { path: gone, label: '~/gone', missing: true }] });
    assert.strictEqual(view._posted[1].type, 'rows');
    assert.strictEqual(view._posted[1].parent, null);
    const owner = view._posted[1].rows[0];
    assert.strictEqual(owner.label, 'c3-e');
    await view._send({ type: 'expand', id: owner.id });
    assert.strictEqual(view._posted.at(-1).parent, owner.id);
    // Review Focus 1: unknown ids and messages are ignored
    const n = view._posted.length, ran = rec.executed.length;
    await view._send({ type: 'expand', id: 'o:x:x/zzz' });
    await view._send({ type: 'click', id: 'o:x:x/zzz' });
    await view._send({ type: 'act', act: 'checkout', id: 'o:x:x/zzz' });
    await view._send({ type: 'nonsense' });
    await view._send(null);
    assert.strictEqual(view._posted.length, n);
    assert.strictEqual(rec.executed.length, ran);
    // a click runs the item's own command with its own arguments
    const sean = view._posted[1].rows.find((r) => r.label === 'seanahn');
    await view._send({ type: 'expand', id: sean.id });
    const seanKids = view._posted.at(-1).rows;
    const perchRow = seanKids.find((r) => r.label === 'perch');
    await view._send({ type: 'expand', id: perchRow.id });
    const file = view._posted.at(-1).rows.find((r) => r.icon && r.icon.id === 'file');
    await view._send({ type: 'click', id: file.id });
    assert.strictEqual(rec.executed.at(-1).id, 'vscode.open');
    assert.strictEqual(rec.executed.at(-1).args[0].fsPath, path.join(fx.perch, 'a.txt'));
    // the cloud button and the workspace panel
    const repoRemote = seanKids.find((r) => r.contextValue === 'repo-remote');
    await view._send({ type: 'act', act: 'checkout', id: repoRemote.id });
    assert.strictEqual(rec.executed.at(-1).id, 'gannet.checkout');
    assert.strictEqual(rec.executed.at(-1).args[0].repo.fullName, 'seanahn/' + repoRemote.label);
    await view._send({ type: 'ws', act: 'remove', path: gh });
    assert.deepStrictEqual(rec.executed.at(-1), { id: 'gannet.removeWorkspace', args: [{ path: gh }] });
    await view._send({ type: 'ws', act: 'reveal', path: gh });
    assert.deepStrictEqual(rec.executed.at(-1), { id: 'gannet.revealWorkspace', args: [{ path: gh }] });
    await view._send({ type: 'ws', act: 'add' });
    assert.deepStrictEqual(rec.executed.at(-1), { id: 'gannet.addWorkspace', args: [] });
    // a right-click's context names the row
    assert.strictEqual(sidebar.resolve({ webviewSection: 'row', nodeId: owner.id }).owner, 'c3-e');
    assert.strictEqual(sidebar.resolve({ nodeId: 'gone' }), undefined);
    const node = sidebar.resolve({ nodeId: owner.id });
    assert.strictEqual(sidebar.resolve(node), node, 'a node passes through');
    assert.strictEqual(sidebar.resolve(undefined), undefined);
    // workspaces again on request
    sidebar.refreshWorkspaces();
    assert.strictEqual(view._posted.at(-1).type, 'workspaces');
    // a change redraws: reset, ids handed out before are forgotten
    fx.tree.redraw();
    assert.deepStrictEqual(view._posted.at(-1), { type: 'reset' });
    assert.strictEqual(sidebar.resolve({ nodeId: file.id }), undefined);
    console.log('SIDEBAR OK');
  } finally { fx.cleanup(); }
})().catch((e) => { console.error(e); process.exit(1); });
