// The Gannet sidebar page: the workspace directories on top, then the owners and everything under them as rows.
// The extension sends rows a parent at a time; the page remembers what is open and asks for what it lacks.
// Under Node (tests) it only exports its pure parts.
(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const svg = (body, fill) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const ICONS = {
    chevron: svg('<path d="M6 4l4 4-4 4"/>'),
    file: svg('<path d="M4 1.5h5l3 3v10H4z"/><path d="M9 1.5v3h3"/>'),
    organization: svg('<circle cx="5" cy="5.5" r="1.8"/><circle cx="11" cy="5.5" r="1.8"/><path d="M1.8 12.5c.4-2.2 1.6-3.4 3.2-3.4s2.8 1.2 3.2 3.4M7.8 12.5c.4-2.2 1.6-3.4 3.2-3.4s2.8 1.2 3.2 3.4"/>'),
    account: svg('<circle cx="8" cy="5.5" r="2.5"/><path d="M3 14c.6-3 2.5-4.6 5-4.6s4.4 1.6 5 4.6"/>'),
    'github-alt': svg('<path d="M8 1.6c-3.6 0-6.4 2.8-6.4 6.3 0 2.8 1.8 5.2 4.4 6v-1.9c-1.8.4-2.2-.8-2.2-.8-.3-.7-.7-.9-.7-.9-.6-.4 0-.4 0-.4.6 0 1 .7 1 .7.6 1 1.6.7 1.9.5.1-.4.2-.7.4-.8-1.4-.2-2.9-.7-2.9-3.2 0-.7.3-1.3.7-1.7-.1-.2-.3-.8.1-1.7 0 0 .5-.2 1.8.7a6 6 0 013.2 0c1.2-.9 1.8-.7 1.8-.7.3.9.1 1.5.1 1.7.4.4.7 1 .7 1.7 0 2.5-1.5 3-2.9 3.2.2.2.4.6.4 1.1v2.8c2.6-.8 4.4-3.2 4.4-6C14.4 4.4 11.6 1.6 8 1.6z"/>'),
    warning: svg('<path d="M8 1.8L14.6 13.8H1.4z"/><path d="M8 6.2v3.6M8 11.6v.2"/>'),
    'file-submodule': svg('<path d="M4 1.5h5l3 3v10H4z"/><path d="M6.5 9.5h3M6.5 11.5h3"/>'),
    repo: svg('<path d="M4.5 1.5h8v11h-8a1.5 1.5 0 00-1.5 1.5V3a1.5 1.5 0 011.5-1.5z"/><path d="M3 14a1.5 1.5 0 011.5-1.5h8v2h-8A1.5 1.5 0 013 14z"/>'),
    cloud: svg('<path d="M4.5 12.5a3 3 0 01-.3-6 4 4 0 017.6-.4 2.8 2.8 0 01.2 5.6"/><path d="M8 8v6M5.8 11.8L8 14l2.2-2.2"/>'),
    'folder-opened': svg('<path d="M1.5 3.5h4l1.5 1.5h6v8h-11.5z"/>'),
    close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
    add: svg('<path d="M8 3v10M3 8h10"/>'),
    loading: svg('<path d="M8 2a6 6 0 106 6"/>'),
  };

  const iconHtml = (icon) => {
    if (!icon || !ICONS[icon.id]) return '';
    return `<span class="ic${icon.color === 'charts.green' ? ' green' : ''}">${ICONS[icon.id]}</span>`;
  };

  /** One row: indent, then the arrow column (an arrow for a parent, the icon for a leaf), label, description. */
  function rowHtml(row, depth, { open = false, loading = false, focused = false } = {}) {
    const ctx = esc(JSON.stringify({ webviewSection: 'row', viewItem: row.contextValue || '', nodeId: row.id, preventDefaultContextMenuItems: true }));
    const twistie = loading ? `<span class="spin">${ICONS.loading}</span>`
      : row.hasChildren ? `<span class="chev${open ? ' open' : ''}">${ICONS.chevron}</span>`
        : iconHtml(row.icon).replace('class="ic', 'class="lic');
    return `<div class="row${focused ? ' focused' : ''}" role="treeitem" data-id="${esc(row.id)}"`
      + `${row.hasChildren ? ` aria-expanded="${open}"` : ''} data-vscode-context='${ctx}' title="${esc(row.tooltip || '')}"`
      + ` style="padding-left: ${depth * 8 + 4}px">`
      + `<span class="tw">${twistie}</span>${row.hasChildren ? iconHtml(row.icon) : ''}`
      + `<span class="label">${esc(row.label)}</span>${row.description ? `<span class="desc">${esc(row.description)}</span>` : ''}`
      + (row.contextValue === 'repo-remote' ? `<span class="acts"><button class="act" data-act="checkout" title="Check Out">${ICONS.cloud}</button></span>` : '')
      + '</div>';
  }

  /** The workspace panel: one row per directory with its hover buttons, then Add folder…. */
  function workspacesHtml(items) {
    return items.map((w) => `<div class="ws${w.missing ? ' missing' : ''}" data-path="${esc(w.path)}" title="${esc(w.path)}">`
      + `<span class="label">${esc(w.label)}</span>${w.missing ? '<span class="desc">Missing</span>' : ''}<span class="acts">`
      + (w.missing ? '' : `<button class="act" data-act="reveal" title="Reveal in File Manager">${ICONS['folder-opened']}</button>`)
      + `<button class="act" data-act="remove" title="Remove from List">${ICONS.close}</button></span></div>`).join('')
      + `<div class="ws add" data-act="add" title="Add a folder Gannet checks repos out into"><span class="lic">${ICONS.add}</span><span class="label">Add folder…</span></div>`;
  }

  /** The rows on screen, depth first: an open parent's children once they have arrived. */
  function visible(roots, kids, open) {
    const out = [];
    const walk = (rows, depth) => {
      for (const row of rows) {
        out.push({ row, depth });
        if (row.hasChildren && open.has(row.id) && kids.has(row.id)) walk(kids.get(row.id), depth + 1);
      }
    };
    walk(roots, 0);
    return out;
  }

  /** What a key does, as a native tree: move, open, close, go to parent or child, or activate. */
  function move(key, focusId, list, open) {
    const i = list.findIndex((v) => v.row.id === focusId);
    if (i < 0) return list.length && /^Arrow/.test(key) ? { focus: list[0].row.id } : {};
    const { row, depth } = list[i];
    switch (key) {
      case 'ArrowDown': return i + 1 < list.length ? { focus: list[i + 1].row.id } : {};
      case 'ArrowUp': return i > 0 ? { focus: list[i - 1].row.id } : {};
      case 'ArrowRight':
        if (!row.hasChildren) return {};
        if (!open.has(row.id)) return { expand: row.id };
        return list[i + 1] && list[i + 1].depth > depth ? { focus: list[i + 1].row.id } : {};
      case 'ArrowLeft':
        if (row.hasChildren && open.has(row.id)) return { collapse: row.id };
        for (let j = i - 1; j >= 0; j--) if (list[j].depth < depth) return { focus: list[j].row.id };
        return {};
      case 'Enter': case ' ': return { activate: row.id };
      default: return {};
    }
  }

  const api = { esc, ICONS, rowHtml, workspacesHtml, visible, move };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  // ---- in the webview ----
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  const openState = saved.open || {};          // id -> true/false, set by the user; else the row's own default
  let roots = [], kids = new Map(), byId = new Map(), asked = new Set(), loading = new Set(), wsItems = [], focus = saved.focus || null;
  const $ws = document.getElementById('ws'), $tree = document.getElementById('tree');

  const isOpen = (row) => (row.id in openState ? openState[row.id] : !!row.expanded);
  const openSet = () => { const s = new Set(); for (const r of byId.values()) if (r.hasChildren && isOpen(r)) s.add(r.id); return s; };
  const save = () => vscode.setState({ open: openState, focus });

  function render() {
    $ws.innerHTML = workspacesHtml(wsItems);
    const open = openSet();
    const list = visible(roots, kids, open);
    $tree.innerHTML = list.map(({ row, depth }) => rowHtml(row, depth, { open: open.has(row.id), loading: loading.has(row.id), focused: row.id === focus })).join('');
    for (const { row } of list) {   // an open row without its children asks once per redraw
      if (open.has(row.id) && !kids.has(row.id) && !asked.has(row.id)) {
        asked.add(row.id); loading.add(row.id);
        vscode.postMessage({ type: 'expand', id: row.id });
      }
    }
    const f = focus && $tree.querySelector(`[data-id="${CSS.escape(focus)}"]`);
    if (f && document.activeElement === $tree) f.scrollIntoView({ block: 'nearest' });
    return list;
  }

  function toggle(id) { const r = byId.get(id); if (!r) return; openState[id] = !isOpen(r); save(); render(); }
  function activate(id) {
    const r = byId.get(id);
    if (!r) return;
    if (r.hasChildren) toggle(id);
    if (r.clickable) vscode.postMessage({ type: 'click', id });
  }

  window.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.type === 'workspaces') { wsItems = m.items || []; render(); }
    else if (m.type === 'rows') {
      for (const r of m.rows || []) byId.set(r.id, r);
      if (m.parent == null) roots = m.rows || []; else kids.set(m.parent, m.rows || []);
      loading.delete(m.parent);
      render();
    } else if (m.type === 'reset') {
      roots = []; kids = new Map(); byId = new Map(); asked = new Set(); loading = new Set();
      vscode.postMessage({ type: 'ready' });
    }
  });

  $tree.addEventListener('click', (e) => {
    const rowEl = e.target.closest('.row');
    if (!rowEl) return;
    const id = rowEl.dataset.id;
    focus = id; save();
    const act = e.target.closest('[data-act]');
    if (act) { e.stopPropagation(); vscode.postMessage({ type: 'act', act: act.dataset.act, id }); return; }
    activate(id);
    $tree.focus();
  });
  $tree.addEventListener('keydown', (e) => {
    const open = openSet();
    const r = move(e.key, focus, visible(roots, kids, open), open);
    if (!Object.keys(r).length) return;
    e.preventDefault();
    if (r.focus) { focus = r.focus; save(); render(); }
    if (r.expand) { openState[r.expand] = true; save(); render(); }
    if (r.collapse) { openState[r.collapse] = false; save(); render(); }
    if (r.activate) activate(r.activate);
  });
  $ws.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'add') { vscode.postMessage({ type: 'ws', act: 'add' }); return; }
    const row = e.target.closest('.ws');
    vscode.postMessage({ type: 'ws', act: act.dataset.act, path: row.dataset.path });
  });

  vscode.postMessage({ type: 'ready' });
})();
