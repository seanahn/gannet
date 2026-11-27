// The Gannet sidebar page: the workspace directories on top, then the owners and everything under them as rows.
// The extension sends rows a parent at a time; the page remembers what is open and asks for what it lacks.
// Under Node (tests) it only exports its pure parts.
(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const svg = (body, fill) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  // the cat: github-alt from @vscode/codicons (© Microsoft, CC BY 4.0), without the circle; padded to draw ~13 px
  const CAT_D = 'M21.035 5.257c.91 1.092 1.364 2.366 1.364 3.822 0 5.277-3.002 6.824-5.823 7.279.364.637.455 1.365.455 2.093v3.73c0 .455-.273.728-.637.728a.718.718 0 0 1-.728-.728v-3.73a2.497 2.497 0 0 0-.728-2.093l.455-1.183c2.821-.364 5.733-1.274 5.733-6.187 0-1.183-.455-2.275-1.274-3.185l-.182-.727a4.04 4.04 0 0 0 .09-2.73c-.454.09-1.364.273-2.91 1.365l-.547.09a13.307 13.307 0 0 0-6.55 0l-.547-.09C7.57 2.71 6.66 2.437 6.204 2.437c-.273.91-.273 1.91.09 2.73l-.181.727c-.91.91-1.365 2.093-1.365 3.185 0 4.822 2.73 5.823 5.732 6.187l.364 1.183c-.546.546-.819 1.274-.728 2.002v3.821a.718.718 0 0 1-.728.728.718.718 0 0 1-.728-.728V20.18c-3.002.637-4.185-.91-5.095-2.092-.455-.546-.819-1.001-1.274-1.092-.09-.091-.364-.455-.273-.819.091-.364.455-.637.82-.455.91.182 1.455.91 2 1.547.82 1.092 1.639 2.092 4.095 1.547v-.364c-.09-.728.091-1.456.455-2.093-2.73-.546-5.914-2.093-5.914-7.279 0-1.456.455-2.73 1.365-3.822-.273-1.273-.182-2.638.273-3.73l.455-.364C5.749 1.073 7.023.8 9.66 2.437a13.673 13.673 0 0 1 6.642 0C18.851.708 20.216.98 20.398 1.072l.455.364c.455 1.274.546 2.548.182 3.821z';
  const CAT = (at) => `<g transform="translate(${at}) scale(.6)"><path d="${CAT_D}"/></g>`;
  const ICONS = {
    chevron: svg('<path d="M6 4l4 4-4 4"/>'),
    file: svg('<path d="M4 1.5h5l3 3v10H4z"/><path d="M9 1.5v3h3"/>'),
    organization: svg('<circle cx="5" cy="5.5" r="1.8"/><circle cx="11" cy="5.5" r="1.8"/><path d="M1.8 12.5c.4-2.2 1.6-3.4 3.2-3.4s2.8 1.2 3.2 3.4M7.8 12.5c.4-2.2 1.6-3.4 3.2-3.4s2.8 1.2 3.2 3.4"/>'),
    account: svg('<circle cx="8" cy="5.5" r="2.5"/><path d="M3 14c.6-3 2.5-4.6 5-4.6s4.4 1.6 5 4.6"/>'),
    'github-alt': `<svg viewBox="-3 -3 30 30" width="16" height="16" fill="currentColor"><path d="${CAT_D}"/></svg>`,
    warning: svg('<path d="M8 1.8L14.6 13.8H1.4z"/><path d="M8 6.2v3.6M8 11.6v.2"/>'),
    'file-submodule': svg('<path d="M4 1.5h5l3 3v10H4z"/><path d="M6.5 9.5h3M6.5 11.5h3"/>'),
    repo: svg('<path d="M4.5 1.5h8v11h-8a1.5 1.5 0 00-1.5 1.5V3a1.5 1.5 0 011.5-1.5z"/><path d="M3 14a1.5 1.5 0 011.5-1.5h8v2h-8A1.5 1.5 0 013 14z"/>'),
    cloud: svg('<path d="M4.5 12.5a3 3 0 01-.3-6 4 4 0 017.6-.4 2.8 2.8 0 01.2 5.6"/><path d="M8 8v6M5.8 11.8L8 14l2.2-2.2"/>'),
    'folder-opened': svg('<path d="M1.5 3.5h4l1.5 1.5h6v8h-11.5z"/>'),
    close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
    add: svg('<path d="M8 3v10M3 8h10"/>'),
    'new-folder': svg('<path d="M1.5 3.5h4l1.5 1.5h7.5v8h-13z"/><path d="M8 7.5v4M6 9.5h4"/>'),
    'eye-closed': svg('<path d="M1.5 5c1.6 2 3.8 3 6.5 3s4.9-1 6.5-3"/><path d="M3.5 7.1L2.3 8.8M6.2 7.9l-.5 2M9.8 7.9l.5 2M12.5 7.1l1.2 1.7"/>'),
    eye: svg('<path d="M1.5 8c1.6-2.8 3.8-4.2 6.5-4.2s4.9 1.4 6.5 4.2c-1.6 2.8-3.8 4.2-6.5 4.2S3.1 10.8 1.5 8z"/><circle cx="8" cy="8" r="2"/>'),
    loading: svg('<path d="M8 2a6 6 0 106 6"/>'),
  };
  // All repos: two of the codicon cats, one behind and above the other
  ICONS.repos = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">${CAT('9.5 1')}${CAT('0 9.5')}</svg>`;

  const iconHtml = (icon) => {
    if (!icon || !ICONS[icon.id]) return '';
    const tint = icon.color === 'charts.green' ? ' green' : icon.color === 'descriptionForeground' ? ' dim' : '';
    return `<span class="ic${tint}">${ICONS[icon.id]}</span>`;
  };

  /** One row: indent, then the arrow column (an arrow for a parent, the icon for a leaf), label, description. */
  const OWNER = /^(owner|account-)/;
  /** A drag may land here: a new-folder row onto an owner row other than its own. */
  function canDrop(drag, over) {
    if (!drag || !over || drag.contextValue !== 'newfolder' || !OWNER.test(over.contextValue || '')) return false;
    return !String(drag.id).startsWith(over.id + '/');
  }

  function rowHtml(row, depth, { open = false, loading = false, focused = false } = {}) {
    const ctx = esc(JSON.stringify({ webviewSection: 'row', viewItem: row.contextValue || '', nodeId: row.id, preventDefaultContextMenuItems: true }));
    const twistie = loading ? `<span class="spin">${ICONS.loading}</span>`
      : row.hasChildren ? `<span class="chev${open ? ' open' : ''}">${ICONS.chevron}</span>`
        : iconHtml(row.icon).replace('class="ic', 'class="lic');
    return `<div class="row${focused ? ' focused' : ''}" role="treeitem" data-id="${esc(row.id)}"`
      + `${row.hasChildren ? ` aria-expanded="${open}"` : ''} data-vscode-context='${ctx}' title="${esc(row.tooltip || '')}"`
      + (row.contextValue === 'newfolder' ? ' draggable="true"' : '') + (OWNER.test(row.contextValue || '') ? ' data-drop="1"' : '')
      + ` style="padding-left: ${depth * 8 + 4}px">`
      + `<span class="tw">${twistie}</span>${row.hasChildren ? iconHtml(row.icon) : ''}`
      + `<span class="label">${esc(row.label)}</span>${row.description ? `<span class="desc">${esc(row.description)}</span>` : ''}`
      + (/^repo-/.test(row.contextValue || '') ? `<span class="acts"><button class="act" data-act="checkout" title="${row.contextValue === 'repo-remote' ? 'Check Out' : 'Check Out Another Copy'}">${ICONS.cloud}</button></span>` : '')
      + (/^hidden-/.test(row.contextValue || '') ? `<span class="acts"><button class="act" data-act="show" title="${row.contextValue === 'hidden-owner' ? 'Show Owner' : 'Show Account'}">${ICONS.eye}</button></span>` : '')
      + (row.contextValue === 'owner' ? `<span class="acts"><button class="act" data-act="hideOwner" title="Hide Owner">${ICONS['eye-closed']}</button></span>` : '')
      + '</div>';
  }

  /** The workspace panel: one row per directory with its hover buttons, then Add folder…. While a new folder is
   *  being named, its name box (and the check's message) sits under that directory's row, as Explorer's does. */
  function workspacesHtml(items, naming = null) {
    const picking = naming && naming.step === 'owner';
    const choices = () => (naming.owners == null ? '<div class="hint info">Loading owners…</div>'
      : !naming.owners.length ? '<div class="hint error">No GitHub owner to put it under: add an account first.</div>'
      : `<div class="hint info">Put ${esc(naming.name)} under…</div>` + naming.owners.map((o, i) => `<div class="ws pick${i === naming.sel ? ' sel' : ''}" data-i="${i}">`
        + `<span class="lic">${o.description ? ICONS.organization : ICONS.account}</span><span class="label">${esc(o.owner)}</span>${o.description ? `<span class="desc">${esc(o.description)}</span>` : ''}</div>`).join(''));
    const box = (w) => (!naming || naming.path !== w.path ? ''
      : `<div class="ws naming"><span class="lic">${ICONS['new-folder']}</span><input class="name" type="text" spellcheck="false" value="${esc(naming.name)}"${picking ? ' readonly' : ''} aria-label="New folder name"></div>`
        + (picking ? choices() : naming.message ? `<div class="hint ${naming.error ? 'error' : 'info'}">${esc(naming.message)}</div>` : ''));
    return items.map((w) => `<div class="ws${w.missing ? ' missing' : ''}" data-path="${esc(w.path)}" title="${esc(w.path)}">`
      + `<span class="label">${esc(w.label)}</span>${w.missing ? '<span class="desc">Missing</span>' : ''}<span class="acts">`
      + (w.missing ? '' : `<button class="act" data-act="newFolder" title="New Folder…">${ICONS['new-folder']}</button>`)
      + (w.missing || !w.reveal ? '' : `<button class="act" data-act="reveal" title="Reveal">${ICONS['folder-opened']}</button>`)
      + `<button class="act" data-act="remove" title="Remove from List">${ICONS.close}</button></span></div>` + box(w)).join('')
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

  const api = { esc, ICONS, rowHtml, workspacesHtml, visible, move, canDrop };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  // ---- in the webview ----
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  const openState = saved.open || {};          // id -> true/false, set by the user; else the row's own default
  let roots = [], kids = new Map(), byId = new Map(), asked = new Set(), loading = new Set(), wsItems = [], naming = null, focus = saved.focus || null;
  const $ws = document.getElementById('ws'), $tree = document.getElementById('tree');

  const isOpen = (row) => (row.id in openState ? openState[row.id] : !!row.expanded);
  const openSet = () => { const s = new Set(); for (const r of byId.values()) if (r.hasChildren && isOpen(r)) s.add(r.id); return s; };
  const save = () => vscode.setState({ open: openState, focus });

  // the name box survives redraws: the panel is redrawn whenever rows arrive, so the caret is put back
  function drawWs() {
    const input = $ws.querySelector('input.name');
    const had = input && document.activeElement === input ? [input.selectionStart, input.selectionEnd] : null;
    if (naming && !wsItems.some((w) => w.path === naming.path && !w.missing)) naming = null;   // its directory went
    $ws.innerHTML = workspacesHtml(wsItems, naming);
    const box = $ws.querySelector('input.name');
    if (box && (had || naming.focus)) { box.focus(); if (had) box.setSelectionRange(had[0], had[1]); naming.focus = false; }
  }
  function endNaming() { if (naming) { naming = null; drawWs(); } }

  function render() {
    drawWs();
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
    else if (m.type === 'ownerChoices') {
      if (naming && naming.step === 'owner') { naming.owners = m.items || []; naming.sel = 0; drawWs(); }
    }
    else if (m.type === 'nameCheck') {   // only the answer for what is in the box now
      if (naming && naming.path === m.path && naming.name === m.name) { naming.message = m.name ? m.message : null; naming.error = !!m.error; drawWs(); }
    }
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
  // drag a new folder onto another owner row
  let dragId = null;
  const overRow = (e) => { const el = e.target.closest('.row[data-drop]'); return el ? { el, row: byId.get(el.dataset.id) } : null; };
  const clearDrop = () => { for (const el of $tree.querySelectorAll('.row.drop')) el.classList.remove('drop'); };
  $tree.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.row[draggable]');
    if (!el) return;
    dragId = el.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });
  $tree.addEventListener('dragover', (e) => {
    const o = overRow(e);
    clearDrop();
    if (!o || !canDrop(byId.get(dragId), o.row)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    o.el.classList.add('drop');
  });
  $tree.addEventListener('dragleave', (e) => { if (!$tree.contains(e.relatedTarget)) clearDrop(); });
  $tree.addEventListener('drop', (e) => {
    const o = overRow(e);
    clearDrop();
    if (o && canDrop(byId.get(dragId), o.row)) { e.preventDefault(); vscode.postMessage({ type: 'move', id: dragId, to: o.row.id }); }
    dragId = null;
  });
  $tree.addEventListener('dragend', () => { dragId = null; clearDrop(); });

  $ws.addEventListener('click', (e) => {
    const pick = e.target.closest('.ws.pick');
    if (pick) { choose(Number(pick.dataset.i)); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'add') { vscode.postMessage({ type: 'ws', act: 'add' }); return; }
    const row = e.target.closest('.ws');
    if (act.dataset.act === 'newFolder') { naming = { path: row.dataset.path, name: '', message: null, error: false, focus: true }; drawWs(); return; }
    vscode.postMessage({ type: 'ws', act: act.dataset.act, path: row.dataset.path });
  });

  $ws.addEventListener('input', (e) => {
    if (!naming || naming.step === 'owner' || !e.target.matches('input.name')) return;
    naming.name = e.target.value;
    if (!naming.name) { naming.message = null; naming.error = false; drawWs(); return; }
    vscode.postMessage({ type: 'checkName', path: naming.path, name: naming.name });
  });
  $ws.addEventListener('keydown', (e) => {
    if (!naming || !e.target.matches('input.name')) return;
    if (e.key === 'Escape') { e.preventDefault(); endNaming(); return; }
    if (naming.step === 'owner') {
      const n = (naming.owners || []).length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (n) { naming.sel = (naming.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; drawWs(); } return; }
      if (e.key === 'Enter') { e.preventDefault(); choose(naming.sel); }
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!naming.name.trim() || naming.error) return;   // the message says why
    Object.assign(naming, { step: 'owner', owners: null, sel: 0, message: null });
    drawWs();
    vscode.postMessage({ type: 'listOwners' });
  });
  function choose(i) {
    const o = naming && naming.owners && naming.owners[i];
    if (!o) return;
    const { path, name } = naming;
    naming = null; drawWs();
    vscode.postMessage({ type: 'ws', act: 'create', path, name, owner: o.owner, account: o.account });
  }
  // a click on an owner picks it; the name box keeps the focus, so the click is not a click away
  $ws.addEventListener('mousedown', (e) => { if (e.target.closest('.ws.pick')) e.preventDefault(); });
  // clicking elsewhere cancels, as in Explorer's name box; a redraw replacing the box is not a click away
  $ws.addEventListener('focusout', (e) => {
    if (!e.target.matches || !e.target.matches('input.name')) return;
    setTimeout(() => { if (naming && !$ws.contains(document.activeElement)) endNaming(); }, 0);
  });

  vscode.postMessage({ type: 'ready' });
})();
