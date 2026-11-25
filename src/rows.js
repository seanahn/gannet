'use strict';
// Rows: the tree model's nodes as plain objects the webview draws. Each row has an id made from its parent's id and
// its own key, so the page can remember what is open and a right-click can name the row it was on.

function nodeKey(node) {
  switch (node.kind) {
    case 'owner': return `o:${node.account.login}:${node.owner}`.toLowerCase();
    case 'group': return 'all';
    case 'repo': return `r:${node.repo.fullName.toLowerCase()}`;
    case 'checkout': return `c:${node.checkout.path}`;
    case 'entry': return `e:${node.entry.path}`;
    case 'disk': return `d:${require('path').basename(node.path)}`;
    case 'info': return `i:${node.label}`;
    case 'error': return 'x';
    default: return node.kind || '?';
  }
}

/** Ids for one parent's children, a repeated key getting #2, #3… */
function childIds(parentId, nodes) {
  const seen = new Map();
  return nodes.map((n) => {
    const k = nodeKey(n);
    const c = (seen.get(k) || 0) + 1;
    seen.set(k, c);
    const key = c > 1 ? `${k}#${c}` : k;
    return parentId ? `${parentId}/${key}` : key;
  });
}

function iconOf(p) {
  if (!p || p.id === 'folder') return null;   // folders draw only their arrow
  if (p.id === 'file') return { id: 'file' };
  return { id: p.id, color: p.color && p.color.id };
}

function toRow(item, id) {
  const label = typeof item.label === 'string' ? item.label : (item.label && item.label.label) || '';
  const tooltip = typeof item.tooltip === 'string' ? item.tooltip : (item.tooltip && item.tooltip.value) || '';
  return {
    id, label, description: item.description || '', tooltip, icon: iconOf(item.iconPath),
    hasChildren: !!item.collapsibleState, expanded: item.collapsibleState === 2,
    contextValue: item.contextValue || '', clickable: !!item.command,
  };
}

/** Rows by id for one drawing of the tree. An answer that started before clear() is dropped: null, not stale rows. */
function createRowStore(tree) {
  let nodes = new Map(), items = new Map(), gen = 0;
  const rows = (parentId, list) => childIds(parentId, list).map((id, i) => {
    const item = tree.getTreeItem(list[i]);
    nodes.set(id, list[i]);
    items.set(id, item);
    return toRow(item, id);
  });
  return {
    async root() {
      const g = gen, list = await tree.getChildren();
      return g === gen ? rows(null, list) : null;
    },
    async children(id) {
      const node = nodes.get(id);
      if (!node) return null;
      const g = gen, list = await tree.getChildren(node);
      return g === gen ? rows(id, list) : null;
    },
    node: (id) => nodes.get(id),
    item: (id) => items.get(id),
    clear() { nodes = new Map(); items = new Map(); gen++; },
  };
}

module.exports = { nodeKey, childIds, toRow, createRowStore };
