'use strict';
// The Workspaces view: a small settings panel listing the directories Gannet checks repos out into on this machine.
// Nothing expands; a directory that is gone says Missing.
const os = require('os');
const { exists, tilde } = require('./workspaces.js');

class WorkspaceTree {
  constructor({ vscode, workspaces, home = os.homedir() }) {
    Object.assign(this, { vscode, workspaces, home });
    this.changed = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changed.event;
  }

  refresh() { this.changed.fire(undefined); }

  async getChildren(node) {
    return node ? [] : this.workspaces.list().map((p) => ({ kind: 'workspace', path: p }));
  }

  getTreeItem(node) {
    const vs = this.vscode;
    const it = new vs.TreeItem(tilde(node.path, this.home), vs.TreeItemCollapsibleState.None);
    const missing = !exists(node.path);
    if (missing) it.description = 'Missing';
    it.contextValue = missing ? 'workspace-missing' : 'workspace';
    it.tooltip = node.path;
    it.iconPath = new vs.ThemeIcon('root-folder');
    return it;
  }
}

module.exports = { WorkspaceTree };
