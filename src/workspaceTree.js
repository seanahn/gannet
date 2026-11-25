'use strict';
// The Workspaces view: the workspaces Gannet knows on this machine, this window's first. A workspace lists its
// folders from disk; a folder whose origin is on github.com shows as a repo, with the account it pushes as.
const os = require('os');
const path = require('path');
const { foldersOf, exists } = require('./workspaces.js');
const { parseOrigin, originOf } = require('./localRepos.js');
const { diskChildren, diskTreeItem, byName } = require('./tree.js');

const tilde = (p, h) => (p === h || p.startsWith(h + path.sep) ? '~' + p.slice(h.length) : p);

class WorkspaceTree {
  constructor({ vscode, workspaces, local, current, home = os.homedir() }) {
    Object.assign(this, { vscode, workspaces, local, current, home });
    this.changed = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changed.event;
  }

  refresh() { this.changed.fire(undefined); }

  async getChildren(node) {
    if (!node) {
      const cur = this.current() || null;
      const list = this.workspaces.list().map((ws) => ({ kind: 'workspace', ws, current: !!(cur && cur.path === ws.path) }));
      list.sort((a, b) => (Number(b.current) - Number(a.current)) || byName(a.ws.name, b.ws.name));
      if (cur && cur.untitled) list.push({ kind: 'untitled' });
      return list;
    }
    switch (node.kind) {
      case 'workspace': {
        if (!exists(node.ws)) return [];
        let folders;
        try { folders = foldersOf(node.ws); } catch { return [{ kind: 'info', label: `Cannot read ${node.ws.path}` }]; }
        return folders.map((p) => {
          const fullName = parseOrigin(originOf(p));
          return fullName ? { kind: 'wsrepo', path: p, fullName, ws: node.ws } : { kind: 'disk', path: p, dir: true };
        });
      }
      case 'wsrepo':
      case 'disk': return diskChildren(node.path);
      default: return [];
    }
  }

  getTreeItem(node) {
    const vs = this.vscode, S = vs.TreeItemCollapsibleState;
    switch (node.kind) {
      case 'workspace': {
        const { ws } = node;
        const missing = !exists(ws);
        const it = new vs.TreeItem(ws.name, missing ? S.None : node.current ? S.Expanded : S.Collapsed);
        it.description = missing ? 'Missing' : node.current ? '● this window' : tilde(ws.path, this.home);
        it.contextValue = missing ? 'workspace-missing' : `workspace-${ws.kind}${node.current ? '-current' : ''}`;
        it.tooltip = ws.path;
        it.iconPath = new vs.ThemeIcon(ws.kind === 'file' ? 'folder-library' : 'root-folder');
        if (!missing) it.command = { command: 'gannet.openWorkspace', title: 'Open', arguments: [node] };
        return it;
      }
      case 'untitled': {
        const it = new vs.TreeItem('Untitled workspace — save it to list it', S.None);
        it.contextValue = 'info';
        it.iconPath = new vs.ThemeIcon('info');
        return it;
      }
      case 'wsrepo': {
        const it = new vs.TreeItem(path.basename(node.path), S.Collapsed);
        const l = this.local.get(node.fullName);
        const login = l && l.path === node.path ? l.login : null;
        it.description = [node.fullName, login && `pushes as ${login}`].filter(Boolean).join(' · ');
        it.contextValue = login ? 'repo-local' : 'repo-local-foreign';
        it.tooltip = `${node.fullName}\n${node.path}`;
        it.resourceUri = vs.Uri.file(node.path);
        it.iconPath = new vs.ThemeIcon('repo-clone');
        return it;
      }
      case 'disk': return diskTreeItem(vs, node);
      case 'info': { const it = new vs.TreeItem(node.label, S.None); it.contextValue = 'info'; return it; }
      default: return new vs.TreeItem('', S.None);
    }
  }
}

module.exports = { WorkspaceTree };
