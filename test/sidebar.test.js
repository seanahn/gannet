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
    const sidebar = new GannetSidebar({ vscode, tree: fx.tree, workspaces: fx.workspaces, home: fx.home, extensionUri: vscode.Uri.file('/ext'), canReveal: (p) => p === gh || p === gone });
    assert.strictEqual(GannetSidebar.viewType, 'gannet.main');
    vscode.window.registerWebviewViewProvider(GannetSidebar.viewType, sidebar);
    const view = vscode._resolveView('gannet.main');
    assert.strictEqual(view.webview.options.enableScripts, true);
    assert.ok(view.webview.html.includes('Content-Security-Policy'));
    assert.ok(view.webview.html.includes('/ext/media/page.js'));
    await view._send({ type: 'ready' });
    assert.deepStrictEqual(view._posted[0], { type: 'workspaces', items: [{ path: gh, label: '~/github', missing: false, reveal: true }, { path: gone, label: '~/gone', missing: true, reveal: false }] }, 'a missing directory is never revealed');
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

    // Final review: an answer that arrives after a redraw is dropped, not posted or remembered
    {
      let fire, hold;
      const A = { kind: 'info', label: 'a' }, old = { kind: 'info', label: 'old' };
      const slow = {
        onDidChangeTreeData: (f) => { fire = f; },
        getTreeItem: (n) => ({ label: n.label, collapsibleState: n === A ? 1 : 0 }),
        getChildren: (n) => (n ? new Promise((r) => { hold = r; }) : Promise.resolve([A])),
      };
      const sb = new GannetSidebar({ vscode, tree: slow, workspaces: fx.workspaces, home: fx.home, extensionUri: vscode.Uri.file('/ext') });
      vscode.window.registerWebviewViewProvider('gannet.slow', sb);
      const v = vscode._resolveView('gannet.slow');
      await v._send({ type: 'ready' });
      const aId = v._posted.at(-1).rows[0].id;
      const pending = v._send({ type: 'expand', id: aId });
      fire();                                   // the tree changed while A's children were on their way
      hold([old]);
      await pending;
      assert.deepStrictEqual(v._posted.at(-1), { type: 'reset' }, 'the late answer is not posted');
      assert.strictEqual(sb.resolve({ nodeId: aId + '/i:old' }), undefined, 'nor remembered');
    }
    // 0.5.0: New Folder from the panel; a drop moves a new folder onto an owner, and nothing else moves
    await view._send({ type: 'ws', act: 'create', path: gh, name: 'newthing' });
    assert.deepStrictEqual(rec.executed.at(-1), { id: 'gannet.newFolder', args: [{ path: gh, name: 'newthing' }] });
    const nCheck = view._posted.length;
    await view._send({ type: 'checkName', path: gh, name: 'x' });
    assert.strictEqual(view._posted.length, nCheck, 'no checker: no answer');
    {
      const ownerA = { kind: 'owner', owner: 'c3-e', account: { login: 'c3-sahn' }, own: false };
      const ownerB = { kind: 'owner', owner: 'seanahn', account: { login: 'seanahn' }, own: true };
      const nfNode = { kind: 'newFolder', owner: 'c3-e', account: ownerA.account, rec: { path: '/w/x', owner: 'c3-e', account: 'c3-sahn' }, pending: null };
      const repoNode = { kind: 'repo', account: ownerA.account, repo: { fullName: 'c3-e/hub', name: 'hub' } };
      const small = {
        onDidChangeTreeData: () => {},
        getTreeItem: (n) => ({ label: n.owner || (n.rec && 'x') || n.repo.name, collapsibleState: n.kind === 'owner' ? 1 : 0, contextValue: n.kind === 'owner' ? 'owner' : n.kind === 'newFolder' ? 'newfolder' : 'repo-remote' }),
        getChildren: async (n) => (!n ? [ownerA, ownerB] : n === ownerA ? [nfNode, repoNode] : []),
      };
      const sb = new GannetSidebar({ vscode, tree: small, workspaces: fx.workspaces, home: fx.home, extensionUri: vscode.Uri.file('/ext'), checkName: (dir, name) => (name === '..' ? { ok: false, message: 'no' } : name === 'old' ? { ok: true, adopt: true } : { ok: true, adopt: false }) });
      vscode.window.registerWebviewViewProvider('gannet.dnd', sb);
      const v = vscode._resolveView('gannet.dnd');
      await v._send({ type: 'ready' });
      const [rA, rB] = v._posted.at(-1).rows;
      await v._send({ type: 'expand', id: rA.id });
      const [rNf, rRepo] = v._posted.at(-1).rows;
      for (const [name, message, error] of [['..', 'no', true], ['old', 'old exists: it will be put under an owner', false], ['fresh', null, false]]) {
        await v._send({ type: 'checkName', path: '/w', name });
        assert.deepStrictEqual(v._posted.at(-1), { type: 'nameCheck', path: '/w', name, message, error });
      }
      await v._send({ type: 'move', id: rNf.id, to: rB.id });
      assert.strictEqual(rec.executed.at(-1).id, 'gannet.moveNewFolder');
      assert.strictEqual(rec.executed.at(-1).args[0], nfNode);
      assert.strictEqual(rec.executed.at(-1).args[1], ownerB);
      const ran2 = rec.executed.length;
      await v._send({ type: 'move', id: rRepo.id, to: rB.id });
      await v._send({ type: 'move', id: rNf.id, to: rRepo.id });
      await v._send({ type: 'move', id: 'nope', to: rB.id });
      await v._send({ type: 'move', id: rNf.id, to: 'nope' });
      assert.strictEqual(rec.executed.length, ran2, 'Review Focus 2: nothing else moves');
    }
    console.log('SIDEBAR OK');
  } finally { fx.cleanup(); }
})().catch((e) => { console.error(e); process.exit(1); });
