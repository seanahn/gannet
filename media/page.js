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
    // github-alt from @vscode/codicons (© Microsoft, CC BY 4.0): the cat without the circle, as the tree drew it
    'github-alt': '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M21.035 5.257c.91 1.092 1.364 2.366 1.364 3.822 0 5.277-3.002 6.824-5.823 7.279.364.637.455 1.365.455 2.093v3.73c0 .455-.273.728-.637.728a.718.718 0 0 1-.728-.728v-3.73a2.497 2.497 0 0 0-.728-2.093l.455-1.183c2.821-.364 5.733-1.274 5.733-6.187 0-1.183-.455-2.275-1.274-3.185l-.182-.727a4.04 4.04 0 0 0 .09-2.73c-.454.09-1.364.273-2.91 1.365l-.547.09a13.307 13.307 0 0 0-6.55 0l-.547-.09C7.57 2.71 6.66 2.437 6.204 2.437c-.273.91-.273 1.91.09 2.73l-.181.727c-.91.91-1.365 2.093-1.365 3.185 0 4.822 2.73 5.823 5.732 6.187l.364 1.183c-.546.546-.819 1.274-.728 2.002v3.821a.718.718 0 0 1-.728.728.718.718 0 0 1-.728-.728V20.18c-3.002.637-4.185-.91-5.095-2.092-.455-.546-.819-1.001-1.274-1.092-.09-.091-.364-.455-.273-.819.091-.364.455-.637.82-.455.91.182 1.455.91 2 1.547.82 1.092 1.639 2.092 4.095 1.547v-.364c-.09-.728.091-1.456.455-2.093-2.73-.546-5.914-2.093-5.914-7.279 0-1.456.455-2.73 1.365-3.822-.273-1.273-.182-2.638.273-3.73l.455-.364C5.749 1.073 7.023.8 9.66 2.437a13.673 13.673 0 0 1 6.642 0C18.851.708 20.216.98 20.398 1.072l.455.364c.455 1.274.546 2.548.182 3.821z"/></svg>',
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
      + (/^repo-/.test(row.contextValue || '') ? `<span class="acts"><button class="act" data-act="checkout" title="${row.contextValue === 'repo-remote' ? 'Check Out' : 'Check Out Another Copy'}">${ICONS.cloud}</button></span>` : '')
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
