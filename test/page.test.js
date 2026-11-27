'use strict';
// The sidebar page's pure parts: escaping, row and workspace HTML, which rows show, and keyboard moves.
const assert = require('assert');
const P = require('../media/page.js');

// Review Focus 3
assert.strictEqual(P.esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
const h = P.rowHtml({ id: 'r/e:<b>', label: '<b>', description: 'a&b', tooltip: '"t"', icon: { id: 'file' }, hasChildren: false, expanded: false, contextValue: 'file', clickable: true }, 2, {});
assert.ok(!h.includes('<b>') && h.includes('&lt;b&gt;') && h.includes('a&amp;b'));
assert.ok(/padding-left:\s*20px/.test(h));
const unattr = (a) => a.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const ctx = JSON.parse(unattr(h.match(/data-vscode-context='([^']*)'/)[1]));
assert.deepStrictEqual(ctx, { webviewSection: 'row', viewItem: 'file', nodeId: 'r/e:<b>', preventDefaultContextMenuItems: true });
const folder = P.rowHtml({ id: 'd', label: 'src', icon: null, hasChildren: true }, 0, { open: false });
assert.ok(folder.includes(P.ICONS.chevron) && !folder.includes(P.ICONS.file));
assert.ok(P.rowHtml({ id: 'r', label: 'perch', icon: { id: 'github-alt' }, hasChildren: true, contextValue: 'repo-remote' }, 1, {}).includes('data-act="checkout"'));
for (const cv of ['repo-local', 'repo-local-foreign', 'repo-multi']) {   // checked out: the button checks out another copy
  const h = P.rowHtml({ id: 'r', label: 'perch', icon: { id: 'github-alt' }, hasChildren: true, contextValue: cv }, 1, {});
  assert.ok(h.includes('data-act="checkout"') && h.includes('title="Check Out Another Copy"'), cv);
}
assert.ok(P.rowHtml({ id: 'r', label: 'perch', hasChildren: true, contextValue: 'repo-remote' }, 1, {}).includes('title="Check Out"'));
assert.ok(!P.rowHtml({ id: 'c', label: '/git/perch', hasChildren: true, contextValue: 'checkout-local' }, 2, {}).includes('data-act="checkout"'));
assert.ok(P.rowHtml({ id: 'r', label: 'x', hasChildren: true }, 0, { loading: true }).includes(P.ICONS.loading));
assert.ok(P.rowHtml({ id: 'r', label: 'perch', icon: { id: 'github-alt', color: 'charts.green' }, hasChildren: true }, 0, {}).includes('green'));
assert.ok(P.rowHtml({ id: 'r', label: 'x', icon: { id: 'no-such-icon' }, hasChildren: false }, 0, {}).includes('x'), 'an unknown icon draws nothing');
// Reveal only where the extension says it can show the directory (a remote one outside the window cannot)
const ws = P.workspacesHtml([{ path: '/git', label: '/git', missing: false, reveal: true }, { path: '/far', label: '~/far', missing: false, reveal: false },
  { path: '/old', label: '~/old', missing: true, reveal: false }]);
assert.strictEqual((ws.match(/data-act="reveal"/g) || []).length, 1);
assert.strictEqual((ws.match(/data-act="remove"/g) || []).length, 3);
assert.ok(ws.includes('Missing') && ws.includes('Add folder…'));
// visible rows and keys
const R = (id, hasChildren = true) => ({ id, label: id, hasChildren });
const kids = new Map([['a', [R('a/1', false), R('a/2')]], ['a/2', [R('a/2/x', false)]]]);
const roots = [R('a'), R('b')];
const open = new Set(['a', 'a/2', 'gone']);   // Review Focus 4: an open id nobody has is harmless
assert.deepStrictEqual(P.visible(roots, kids, open).map((v) => [v.row.id, v.depth]), [['a', 0], ['a/1', 1], ['a/2', 1], ['a/2/x', 2], ['b', 0]]);
const list = P.visible(roots, kids, open);
assert.deepStrictEqual(P.move('ArrowDown', 'a/2/x', list, open), { focus: 'b' });
assert.deepStrictEqual(P.move('ArrowLeft', 'a/2/x', list, open), { focus: 'a/2' });
assert.deepStrictEqual(P.move('ArrowLeft', 'a/2', list, open), { collapse: 'a/2' });
assert.deepStrictEqual(P.move('ArrowRight', 'b', list, open), { expand: 'b' });
assert.deepStrictEqual(P.move('ArrowRight', 'a', list, open), { focus: 'a/1' });
assert.deepStrictEqual(P.move('Enter', 'a/1', list, open), { activate: 'a/1' });
assert.deepStrictEqual(P.move(' ', 'a/1', list, open), { activate: 'a/1' });
assert.deepStrictEqual(P.move('ArrowUp', 'a', list, open), {});
assert.deepStrictEqual(P.move('ArrowDown', null, list, open), { focus: 'a' }, 'nothing focused: the first row');
const html = require('../src/page.js').pageHtml({ cspSource: 'vscode-res:', scriptUri: 'vscode-res:/p.js', nonce: 'N1' });
assert.ok(html.includes("script-src 'nonce-N1'") && html.includes('<script nonce="N1" src="vscode-res:/p.js">'));
assert.ok(html.includes('id="ws"') && html.includes('id="tree"'));
// the repo icon is codicon github-alt, the cat with no circle (VS Code's own `github` is the round mark)
assert.ok(P.ICONS['github-alt'].includes('M21.035 5.257'), 'codicon github-alt');
// the cat draws at about 13 px inside the 16 px icon box (Sean: "can you make the icon smaller")
assert.ok(P.ICONS['github-alt'].includes('viewBox="-3 -3 30 30"'), 'padded viewBox');
// All repos: two small codicon cats, one behind the other (Sean: "small 2 cats icon")
assert.strictEqual((P.ICONS.repos.match(/M21\.035 5\.257/g) || []).length, 2, 'two cats');
// 0.5.0: New Folder on each live workspace; new-folder rows drag, owner rows take the drop; the dim cat
const ws2 = P.workspacesHtml([{ path: '/git', label: '/git', missing: false, reveal: true }, { path: '/old', label: '~/old', missing: true, reveal: false }]);
assert.strictEqual((ws2.match(/data-act="newFolder"/g) || []).length, 1);
assert.ok(ws2.includes('title="New Folder…"'));
assert.ok(ws2.indexOf('data-act="newFolder"') < ws2.indexOf('data-act="reveal"'), 'before Reveal');
// the name is typed in place: an input under its workspace row, the check's message under it
const two = [{ path: '/git', label: '/git', missing: false, reveal: true }, { path: '/w', label: '~/w', missing: false, reveal: true }];
const nm = P.workspacesHtml(two, { path: '/git', name: 'a"b', message: null });
assert.strictEqual((nm.match(/<input /g) || []).length, 1);
assert.ok(nm.includes('class="name"') && nm.includes('value="a&quot;b"'), 'the typed name, escaped');
assert.ok(nm.indexOf('data-path="/git"') < nm.indexOf('<input ') && nm.indexOf('<input ') < nm.indexOf('data-path="/w"'), 'under its own row');
assert.ok(!nm.includes('class="hint'));
assert.ok(P.workspacesHtml(two, { path: '/w', name: '..', message: '".." is not a folder name.', error: true }).includes('<div class="hint error">&quot;..&quot; is not a folder name.</div>'));
assert.ok(P.workspacesHtml(two, { path: '/w', name: 'old', message: 'old exists', error: false }).includes('<div class="hint info">old exists</div>'));
assert.ok(!P.workspacesHtml(two).includes('<input '), 'no input unless naming');
// then the owner is picked in place: the name stays shown, the owner rows under it, one selected
const owners = [{ owner: 'c3-e', account: 'c3-sahn', description: 'via c3-sahn' }, { owner: 'seanahn', account: 'seanahn', description: null }];
const op = P.workspacesHtml(two, { path: '/git', name: 'newthing', step: 'owner', owners, sel: 1 });
assert.ok(op.includes('readonly') && op.includes('value="newthing"'), 'the name, kept');
assert.strictEqual((op.match(/class="ws pick/g) || []).length, 2);
assert.ok(op.includes('<div class="ws pick" data-i="0"') && op.includes('<div class="ws pick sel" data-i="1"'));
assert.ok(op.includes('<span class="label">c3-e</span><span class="desc">via c3-sahn</span>'));
assert.ok(op.includes('<div class="hint info">Put newthing under…</div>'));
assert.ok(op.indexOf('data-i="1"') < op.indexOf('data-path="/w"'), 'under its own row');
assert.ok(P.workspacesHtml(two, { path: '/git', name: 'n', step: 'owner', owners: [], sel: 0 }).includes('<div class="hint error">'), 'no owner to put it under');
assert.ok(P.workspacesHtml(two, { path: '/git', name: 'n', step: 'owner', owners: null, sel: 0 }).includes('Loading owners'), 'while they are read');
// an owner row (not your own account) hides with the eye on hover; nothing else has it
const ownerRow = { id: 'o:seanahn:bpmn2', label: 'bpmn2', hasChildren: true, contextValue: 'owner' };
assert.ok(P.rowHtml(ownerRow, 0, {}).includes(`<span class="acts"><button class="act" data-act="hideOwner" title="Hide Owner">${P.ICONS['eye-closed']}</button></span>`));
assert.ok(P.ICONS['eye-closed'].startsWith('<svg'));
for (const cv of ['account-vscode', 'account-gh', 'repo-remote', 'newfolder', 'group-all']) assert.ok(!P.rowHtml({ id: 'x', label: 'x', contextValue: cv }, 0, {}).includes('hideOwner'), cv);
// a hidden owner or account comes back with the open eye
assert.ok(P.rowHtml({ id: 'hidden/h:bpmn2', label: 'bpmn2', contextValue: 'hidden-owner' }, 1, {}).includes(`<button class="act" data-act="show" title="Show Owner">${P.ICONS.eye}</button>`));
assert.ok(P.rowHtml({ id: 'hidden/a:x', label: 'x', contextValue: 'hidden-account' }, 1, {}).includes('data-act="show" title="Show Account"'));
assert.ok(P.ICONS.eye.startsWith('<svg') && P.ICONS.eye !== P.ICONS['eye-closed']);
const nfRow = { id: 'o:c3-sahn:c3-e/n:/w/x', label: 'x', hasChildren: true, contextValue: 'newfolder', icon: { id: 'github-alt', color: 'descriptionForeground' } };
const ownerE = { id: 'o:c3-sahn:c3-e', label: 'c3-e', hasChildren: true, contextValue: 'owner' };
const ownerS = { id: 'o:seanahn:seanahn', label: 'seanahn', hasChildren: true, contextValue: 'account-vscode' };
const repoR = { id: 'o:seanahn:seanahn/r:seanahn/perch', label: 'perch', hasChildren: true, contextValue: 'repo-remote' };
assert.ok(P.rowHtml(nfRow, 1, {}).includes('draggable="true"'));
assert.ok(!P.rowHtml(repoR, 1, {}).includes('draggable'));
assert.ok(P.rowHtml(ownerE, 0, {}).includes('data-drop="1"') && P.rowHtml(ownerS, 0, {}).includes('data-drop="1"'));
assert.ok(!P.rowHtml(repoR, 1, {}).includes('data-drop'));
assert.ok(P.rowHtml(nfRow, 1, {}).includes('class="ic dim"') || P.rowHtml(nfRow, 1, {}).includes('ic dim'), 'dim cat');
// Review Focus 2
assert.strictEqual(P.canDrop(nfRow, ownerS), true);
assert.strictEqual(P.canDrop(nfRow, ownerE), false, 'its own owner');
assert.strictEqual(P.canDrop(repoR, ownerE), false);
assert.strictEqual(P.canDrop(nfRow, repoR), false);
assert.strictEqual(P.canDrop(null, ownerE), false);
console.log('PAGE OK');
