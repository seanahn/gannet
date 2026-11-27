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
console.log('PAGE OK');
