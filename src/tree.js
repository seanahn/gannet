'use strict';
// The Gannet view: one node per account, each with Recent and All repos; a repo lists its files from GitHub, a
// folder at a time, until it is checked out, and from disk after. Errors show as items in place of what failed.
const fs = require('fs');
const path = require('path');
const { MAX: RECENT_MAX } = require('./recent.js');
const { isDir } = require('./localRepos.js');

const LARGE = 10 * 1024 * 1024;
const PUSHED_PAGE = 100;   // Recent's pool from GitHub: one page of the recently pushed repos

const pad = (n) => String(n).padStart(2, '0');
const byName = (a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);

class GannetTree {
  constructor({ vscode, accounts, clientFor, recent, local }) {
    Object.assign(this, { vscode, accounts, clientFor, recent, local });
    this.changed = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changed.event;
    this.clear();
  }

  clear() {
    this.pushed = new Map();    // login -> Repo[]
    this.allRepos = new Map();  // login -> Repo[]
    this.listings = new Map();  // login fullName path -> { entries, truncated }
  }

  refresh() { this.clear(); this.changed.fire(undefined); }

  async getChildren(node) {
    try {
      if (!node) return (await this.accounts.list()).map((account) => ({ kind: 'account', account }));
      switch (node.kind) {
        case 'account': return [{ kind: 'group', which: 'recent', account: node.account }, { kind: 'group', which: 'all', account: node.account }];
        case 'group': return node.which === 'recent' ? await this.recentRepos(node.account) : await this.everyRepo(node.account);
        case 'repo': return await this.repoChildren(node);
        case 'entry': return await this.remoteDir(node.account, node.repo, node.entry.path);
        case 'disk': return this.diskDir(node.path);
        default: return [];
      }
    } catch (e) {
      return [this.errorNode(e, node)];
    }
  }

  async recentRepos(account) {
    const login = account.login;
    if (!this.pushed.has(login)) this.pushed.set(login, await this.clientFor(login).listRepos({ sort: 'pushed', max: PUSHED_PAGE }));
    const known = new Map((this.allRepos.get(login) || []).map((r) => [r.fullName, r]));
    return this.recent.merge(login, this.pushed.get(login), known).slice(0, RECENT_MAX).map((repo) => ({ kind: 'repo', account, repo }));
  }

  async everyRepo(account) {
    const login = account.login;
    if (!this.allRepos.has(login)) {
      const repos = await this.clientFor(login).listRepos({ sort: 'full_name' });
      this.allRepos.set(login, repos.slice().sort((a, b) => byName(a.fullName, b.fullName)));
      this.changed.fire({ kind: 'account', account });   // the count on All repos
    }
    return this.allRepos.get(login).map((repo) => ({ kind: 'repo', account, repo }));
  }

  localOf(repo) {
    const l = this.local.get(repo.fullName);
    return l && isDir(l.path) ? l : null;
  }

  async repoChildren(node) {
    const here = this.localOf(node.repo);
    if (here) return this.diskDir(here.path);
    await this.recent.touch(node.account.login, node.repo.fullName);
    try {
      return await this.remoteDir(node.account, node.repo, '');
    } catch (e) {
      if (e && e.kind === 'empty') return [{ kind: 'info', label: 'Empty repository' }];
      if (e && e.kind === 'notFound') {
        await this.recent.forgetRepo(node.account.login, node.repo.fullName);
        return [{ kind: 'info', label: 'No longer on GitHub' }];
      }
      throw e;
    }
  }

  async remoteDir(account, repo, p) {
    const key = `${account.login} ${repo.fullName} ${p}`;
    if (!this.listings.has(key)) this.listings.set(key, await this.clientFor(account.login).listDir(repo.owner, repo.name, p));
    const { entries, truncated } = this.listings.get(key);
    const out = entries.map((entry) => ({ kind: 'entry', account, repo, entry }));
    if (truncated) {
      const url = `https://github.com/${repo.fullName}/tree/${encodeURIComponent(repo.defaultBranch || 'HEAD')}${p ? '/' + p.split('/').map(encodeURIComponent).join('/') : ''}`;
      out.push({ kind: 'info', label: 'More files — open on GitHub', url });
    }
    return out;
  }

  diskDir(dir) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return [{ kind: 'info', label: 'Not found on disk' }]; }
    return ents.filter((d) => d.name !== '.git')
      .sort((a, b) => (Number(b.isDirectory()) - Number(a.isDirectory())) || byName(a.name, b.name))
      .map((d) => ({ kind: 'disk', path: path.join(dir, d.name), dir: d.isDirectory() }));
  }

  errorNode(e, node) {
    const account = node && node.account;
    const n = { kind: 'error', error: e, account };
    if (e && e.kind === 'auth') {
      if (account && this.accounts.forget) this.accounts.forget(account.login);   // read afresh next time
      n.label = 'Signed out';
      return n;
    }
    if (e && e.kind === 'sso') { n.label = `${(node.repo && node.repo.owner) || 'An organization'} needs SSO authorization`; return n; }
    if (e && e.kind === 'rate') { const t = e.retryAt; n.label = t ? `Rate limited — try again at ${pad(t.getHours())}:${pad(t.getMinutes())}` : 'Rate limited — try again later'; return n; }
    n.label = (e && e.message) || String(e);
    return n;
  }

  getTreeItem(node) {
    const vs = this.vscode, S = vs.TreeItemCollapsibleState;
    switch (node.kind) {
      case 'account': {
        const it = new vs.TreeItem(node.account.login, S.Expanded);
        const gh = node.account.source === 'gh';
        it.description = gh ? 'gh' : 'VS Code';
        it.contextValue = gh ? 'account-gh' : 'account-vscode';
        it.tooltip = gh ? `${node.account.login}, logged in with the gh CLI` : `${node.account.login}, signed in to VS Code. To sign out, use VS Code's Accounts menu; Hide only removes it from Gannet.`;
        it.iconPath = new vs.ThemeIcon('account');
        return it;
      }
      case 'group': {
        const recent = node.which === 'recent';
        const it = new vs.TreeItem(recent ? 'Recent' : 'All repos', recent ? S.Expanded : S.Collapsed);
        const all = this.allRepos.get(node.account.login);
        if (!recent && all) it.description = String(all.length);
        it.contextValue = recent ? 'group-recent' : 'group-all';
        it.iconPath = new vs.ThemeIcon(recent ? 'history' : 'repo');
        return it;
      }
      case 'repo': {
        const it = new vs.TreeItem(node.repo.fullName, S.Collapsed);
        const l = this.localOf(node.repo);
        it.description = [l && '● local', node.repo.private && 'private', node.repo.archived && 'archived'].filter(Boolean).join(' · ');
        it.contextValue = !l ? 'repo-remote' : l.login ? 'repo-local' : 'repo-local-foreign';
        it.tooltip = l ? `${node.repo.fullName}\n${l.path}${l.login ? `\npushes as ${l.login}` : ''}` : `${node.repo.fullName} — only on GitHub`;
        it.iconPath = new vs.ThemeIcon(l ? 'repo-clone' : 'github-alt');
        return it;
      }
      case 'entry': {
        const e = node.entry;
        const it = new vs.TreeItem(e.name, e.type === 'dir' ? S.Collapsed : S.None);
        if (e.type === 'dir') { it.contextValue = 'dir'; it.iconPath = vs.ThemeIcon.Folder || new vs.ThemeIcon('folder'); return it; }
        if (e.type === 'submodule') {
          it.contextValue = 'submodule'; it.description = 'submodule';
          it.command = { command: 'gannet.openUrl', title: 'Open on GitHub', arguments: [e.htmlUrl] };
          it.iconPath = new vs.ThemeIcon('file-submodule');
          return it;
        }
        it.contextValue = e.size > LARGE ? 'file-large' : 'file';
        if (e.type === 'symlink') it.description = 'symlink';
        it.command = { command: 'gannet.openFile', title: 'Open', arguments: [node] };
        it.iconPath = vs.ThemeIcon.File || new vs.ThemeIcon('file');
        return it;
      }
      case 'disk': {
        const it = new vs.TreeItem(path.basename(node.path), node.dir ? S.Collapsed : S.None);
        it.resourceUri = vs.Uri.file(node.path);
        it.contextValue = node.dir ? 'disk-dir' : 'disk-file';
        if (!node.dir) it.command = { command: 'vscode.open', title: 'Open', arguments: [it.resourceUri] };
        return it;
      }
      case 'info': {
        const it = new vs.TreeItem(node.label, S.None);
        it.contextValue = 'info';
        if (node.url) it.command = { command: 'gannet.openUrl', title: 'Open on GitHub', arguments: [node.url] };
        return it;
      }
      case 'error': {
        const it = new vs.TreeItem(node.label, S.None);
        const e = node.error || {};
        it.iconPath = new vs.ThemeIcon('warning');
        it.contextValue = e.kind === 'sso' ? 'error-sso' : 'error';
        it.tooltip = e.message || String(e);
        if (e.kind === 'auth' && node.account) {
          if (node.account.source === 'gh') it.description = 'run gh auth login';
          else it.command = { command: 'gannet.signIn', title: 'Sign in', arguments: [node.account] };
        }
        if (e.kind === 'sso' && e.ssoUrl) { it.description = 'Authorize'; it.command = { command: 'gannet.openUrl', title: 'Authorize', arguments: [e.ssoUrl] }; }
        return it;
      }
      default: return new vs.TreeItem('', S.None);
    }
  }
}

module.exports = { GannetTree, LARGE };
