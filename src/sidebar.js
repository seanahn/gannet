'use strict';
// The Gannet sidebar: one webview view. It draws GannetTree's nodes as rows the page asks for a parent at a time,
// runs a row's click and buttons, and turns a right-click's context back into the node it was on.
const crypto = require('crypto');
const W = require('./workspaces.js');
const { createRowStore } = require('./rows.js');
const { pageHtml } = require('./page.js');

class GannetSidebar {
  constructor({ vscode, tree, workspaces, home, extensionUri, canReveal = () => true }) {
    Object.assign(this, { vscode, tree, workspaces, home, extensionUri, canReveal });
    this.store = createRowStore(tree);
    this.view = null;
    tree.onDidChangeTreeData(() => { this.store.clear(); this.post({ type: 'reset' }); });
  }

  resolveWebviewView(view) {
    const vs = this.vscode;
    const media = vs.Uri.joinPath(this.extensionUri, 'media');
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = pageHtml({
      cspSource: view.webview.cspSource,
      scriptUri: String(view.webview.asWebviewUri(vs.Uri.joinPath(media, 'page.js'))),
      nonce: crypto.randomBytes(16).toString('base64').replace(/[^A-Za-z0-9]/g, ''),
    });
    view.webview.onDidReceiveMessage((m) => this._handle(m));
    view.onDidDispose(() => { if (this.view === view) this.view = null; });
  }

  post(m) { if (this.view) this.view.webview.postMessage(m); }

  workspaceItems() {
    return this.workspaces.list().map((p) => {
      const missing = !W.exists(p);
      return { path: p, label: W.tilde(p, this.home), missing, reveal: !missing && !!this.canReveal(p) };
    });
  }

  refreshWorkspaces() { this.post({ type: 'workspaces', items: this.workspaceItems() }); }

  /** The node a command is about: a node itself, or the row a right-click's context names. */
  resolve(arg) {
    if (!arg || typeof arg !== 'object') return undefined;
    if (arg.kind) return arg;
    if (arg.nodeId) return this.store.node(arg.nodeId);
    return undefined;
  }

  async _handle(m) {
    if (!m || typeof m !== 'object') return;
    const cmd = (id, ...args) => this.vscode.commands.executeCommand(id, ...args);
    switch (m.type) {
      case 'ready': {
        this.refreshWorkspaces();
        const rows = await this.store.root();
        if (rows) this.post({ type: 'rows', parent: null, rows });
        return;
      }
      case 'expand': {
        const rows = await this.store.children(m.id);
        if (rows) this.post({ type: 'rows', parent: m.id, rows });
        return;
      }
      case 'click': {
        const item = this.store.item(m.id);
        if (item && item.command) await cmd(item.command.command, ...(item.command.arguments || []));
        return;
      }
      case 'act': {
        const node = this.store.node(m.id);
        if (node && m.act === 'checkout') await cmd('gannet.checkout', node);
        return;
      }
      case 'ws':
        if (m.act === 'add') await cmd('gannet.addWorkspace');
        else if (m.act === 'remove' && m.path) await cmd('gannet.removeWorkspace', { path: m.path });
        else if (m.act === 'reveal' && m.path) await cmd('gannet.revealWorkspace', { path: m.path });
        else if (m.act === 'newFolder' && m.path) await cmd('gannet.newFolder', { path: m.path });
        return;
      case 'move': {   // a new folder dropped on an owner row; anything else is ignored
        const node = this.store.node(m.id), target = this.store.node(m.to);
        if (node && node.kind === 'newFolder' && target && target.kind === 'owner') await cmd('gannet.moveNewFolder', node, target);
        return;
      }
      default:
    }
  }
}
GannetSidebar.viewType = 'gannet.main';

module.exports = { GannetSidebar };
