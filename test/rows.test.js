'use strict';
// Rows: the tree model's nodes as plain rows with stable ids, for the webview.
const assert = require('assert');
const { fakeVscode, installVscode } = require('./stubs.js');
const vscode = fakeVscode();
installVscode(vscode);
const { makeTreeFixture } = require('./fixture.js');
const { createRowStore, childIds, nodeKey } = require('../src/rows.js');

(async () => {
  const fx = await makeTreeFixture(vscode);
  try {
    const store = createRowStore(fx.tree);
    const root = await store.root();
    assert.deepStrictEqual(root.map((r) => r.id), ['o:c3-sahn:c3-e', 'o:c3-sahn:c3-sahn', 'o:seanahn:seanahn']);
    const e = root[0];
    assert.strictEqual(e.label, 'c3-e');
    assert.strictEqual(e.description, 'via c3-sahn');
    assert.deepStrictEqual(e.icon, { id: 'organization', color: undefined });
    assert.strictEqual(e.expanded, true);
    assert.strictEqual(e.hasChildren, true);
    assert.strictEqual(e.contextValue, 'owner');
    assert.strictEqual(typeof e.tooltip, 'string');
    assert.strictEqual(store.node(e.id).owner, 'c3-e');
    const kids = await store.children(e.id);
    assert.ok(kids.every((r) => r.id.startsWith(e.id + '/')));
    assert.strictEqual(kids.at(-1).id, e.id + '/all');
    assert.strictEqual(kids.at(-1).label, 'All repos');
    // a checked-out repo: green Octocat; its folders no icon, files the generic icon
    const perch = (await store.children('o:seanahn:seanahn')).find((r) => r.label === 'perch');
    assert.strictEqual(perch.id, 'o:seanahn:seanahn/r:seanahn/perch');
    assert.deepStrictEqual(perch.icon, { id: 'github-alt', color: 'charts.green' });
    const files = await store.children(perch.id);
    assert.strictEqual(files.find((r) => r.label === 'src').icon, null);
    assert.strictEqual(files.find((r) => r.label === 'src').hasChildren, true);
    assert.deepStrictEqual(files.find((r) => r.label === 'a.txt').icon, { id: 'file' });
    assert.strictEqual(files.find((r) => r.label === 'a.txt').clickable, true);
    assert.strictEqual(files.find((r) => r.label === 'src').clickable, false);
    assert.strictEqual(store.item(files.find((r) => r.label === 'a.txt').id).command.command, 'vscode.open');
    // Review Focus 1: an unknown id
    assert.strictEqual(await store.children('o:nobody:nobody/x'), null);
    assert.strictEqual(store.node('nope'), undefined);
    // Review Focus 5: colliding keys get suffixes
    assert.deepStrictEqual(childIds('p', [{ kind: 'info', label: 'x' }, { kind: 'info', label: 'x' }, { kind: 'group' }]), ['p/i:x', 'p/i:x#2', 'p/all']);
    assert.deepStrictEqual(childIds(null, [{ kind: 'error' }]), ['x']);
    assert.strictEqual(nodeKey({ kind: 'repo', repo: { fullName: 'C3-E/Hub' } }), 'r:c3-e/hub');
    // Review Focus 2: a failing child list gives the error row, not a throw
    const sahn = (await store.children('o:c3-sahn:c3-sahn')).find((r) => r.label === 'notes');
    const err = await store.children(sahn.id);
    assert.strictEqual(err.length, 1);
    assert.deepStrictEqual(err[0].icon, { id: 'warning', color: undefined });
    assert.strictEqual(err[0].label, 'Signed out');
    // clear forgets the ids handed out
    store.clear();
    assert.strictEqual(store.node(perch.id), undefined);
    console.log('ROWS OK');
  } finally { fx.cleanup(); }
})().catch((e) => { console.error(e); process.exit(1); });
