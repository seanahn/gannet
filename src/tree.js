'use strict';
// The Gannet view: one node per owner an account reaches, each with its recent repos and All repos (the account's
// full list, kept on disk once read); a repo lists its files from GitHub, a
// folder at a time, until it is checked out, and from disk after. Errors show as items in place of what failed.
const fs = require('fs');
const path = require('path');
const { isDir } = require('./localRepos.js');
const { toUri } = require('./fsProvider.js');

const LARGE = 10 * 1024 * 1024;
const PUSHED_PAGE = 100;   // Recent's pool from GitHub: one page of the recently pushed repos

const pad = (n) => String(n).padStart(2, '0');
const byName = (a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);

/** A folder on disk as tree nodes: folders first, .git hidden; a missing folder says so. */
function diskChildren(dir) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return [{ kind: 'info', label: 'Not found on disk' }]; }
  return ents.filter((d) => d.name !== '.git')
    .sort((a, b) => (Number(b.isDirectory()) - Number(a.isDirectory())) || byName(a.name, b.name))
    .map((d) => ({ kind: 'disk', path: path.join(dir, d.name), dir: d.isDirectory() }));
}

function diskTreeItem(vs, node) {
  const it = new vs.TreeItem(path.basename(node.path), node.dir ? vs.TreeItemCollapsibleState.Collapsed : vs.TreeItemCollapsibleState.None);
  it.resourceUri = vs.Uri.file(node.path);
  it.iconPath = node.dir ? vs.ThemeIcon.Folder : vs.ThemeIcon.File;   // see entryIcon
  it.contextValue = node.dir ? 'disk-dir' : 'disk-file';
  if (!node.dir) it.command = { command: 'vscode.open', title: 'Open', arguments: [it.resourceUri] };
  return it;
}

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();   // GitHub names ignore case

class GannetTree {
  constructor({ vscode, accounts, clientFor, recent, local, cache, workspaces, home }) {
    Object.assign(this, { vscode, accounts, clientFor, recent, local, cache, workspaces, home });
    this.changed = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changed.event;
    this.refreshedAt = 0;   // a kept list fetched before this is read again from GitHub when All repos opens
    this.clear();
  }

  clear() {
    this.pushed = new Map();    // login -> Repo[]
    this.orgs = new Map();      // login -> string[]
    this.full = new Map();      // login -> Repo[], read this session
    this.listings = new Map();  // login fullName path -> { entries, truncated }
  }

  refresh() { this.clear(); this.refreshedAt = Date.now(); this.changed.fire(undefined); }

  async getChildren(node) {
    try {
      if (!node) return await this.owners();
      switch (node.kind) {
        case 'owner': return node.error ? [this.errorNode(node.error, node)] : await this.ownerChildren(node);
        case 'group': return await this.everyRepo(node);
        case 'repo': return await this.repoChildren(node);
        case 'entry': return await this.remoteDir(node.account, node.repo, node.entry.path);
        case 'disk': return this.diskDir(node.path);
        default: return [];
      }
    } catch (e) {
      return [this.errorNode(e, node)];
    }
  }

  async pushedOf(login) {
    if (!this.pushed.has(login)) this.pushed.set(login, await this.clientFor(login).listRepos({ sort: 'pushed', max: PUSHED_PAGE }));
    return this.pushed.get(login);
  }

  async orgsOf(login) {
    if (!this.orgs.has(login)) {
      let orgs = [];
      try { orgs = await this.clientFor(login).listOrgs(); } catch { /* no read:org: owners come from the repos */ }
      this.orgs.set(login, orgs);
    }
    return this.orgs.get(login);
  }

  /** The account's full list as far as known without asking GitHub: this session's, else the one kept on disk. */
  knownList(login) {
    if (this.full.has(login)) return this.full.get(login);
    const kept = this.cache && this.cache.get(login);
    return kept ? kept.repos : [];
  }

  /** The full list for All repos: kept on disk once read; read again only after ⟳. */
  async fullList(login) {
    if (this.full.has(login)) return this.full.get(login);
    const kept = this.cache && this.cache.get(login);
    if (kept && !(Date.parse(kept.fetchedAt) < this.refreshedAt)) { this.full.set(login, kept.repos); return kept.repos; }
    const repos = (await this.clientFor(login).listRepos({ sort: 'full_name' })).slice().sort((a, b) => byName(a.fullName, b.fullName));
    if (this.cache) this.cache.set(login, repos);
    this.full.set(login, repos);
    return repos;
  }

  /** One node per owner each account reaches: its login, its organizations, and the owners of its repos. */
  async owners() {
    const out = [];
    for (const account of await this.accounts.list()) {
      const { login } = account;
      let error = null, pushed = [], orgs = [];
      try { pushed = await this.pushedOf(login); orgs = await this.orgsOf(login); } catch (e) { error = e; }
      const found = new Map();   // lowercased -> { owner, org }
      const add = (owner, org = false) => {
        if (!owner) return;
        const k = owner.toLowerCase();
        if (!found.has(k)) found.set(k, { owner, org });
        else if (org) found.get(k).org = true;
      };
      add(login);
      if (!error) {
        for (const o of orgs) add(o, true);
        for (const r of pushed) add(r.owner);
        for (const r of this.knownList(login)) add(r.owner);
      }
      for (const { owner, org } of found.values()) {
        const own = same(owner, login);
        out.push({ kind: 'owner', account, owner, own, org: org && !own, hasOrgs: orgs.length > 0, error: own ? error : null });
      }
    }
    return out.sort((a, b) => byName(a.owner, b.owner) || byName(a.account.login, b.account.login));
  }

  async ownerChildren(node) {
    const { account, owner } = node;
    const known = new Map(this.knownList(account.login).map((r) => [r.fullName, r]));
    const recent = this.recent.merge(account.login, await this.pushedOf(account.login), known, (r) => same(r.owner, owner));
    return [...recent.map((repo) => ({ kind: 'repo', account, repo })), { kind: 'group', which: 'all', account, owner }];
  }

  async everyRepo(node) {
    return (await this.fullList(node.account.login)).filter((r) => same(r.owner, node.owner)).map((repo) => ({ kind: 'repo', account: node.account, repo }));
  }

  localOf(repo) { return this.local.checkoutsOf(repo.fullName)[0] || null; }

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

  diskDir(dir) { return diskChildren(dir); }

  errorNode(e, node) {
    const account = node && node.account;
    const n = { kind: 'error', error: e, account };
    if (e && e.kind === 'auth') {
      if (account && this.accounts.forget) this.accounts.forget(account.login);   // read afresh next time
      n.label = 'Signed out';
      return n;
    }
    if (e && e.kind === 'sso') { n.label = `${(node && ((node.repo && node.repo.owner) || (node.owner !== undefined && !node.own && node.owner))) || 'An organization'} needs SSO authorization`; return n; }
    if (e && e.kind === 'rate') { const t = e.retryAt; n.label = t ? `Rate limited — try again at ${pad(t.getHours())}:${pad(t.getMinutes())}` : 'Rate limited — try again later'; return n; }
    n.label = (e && e.message) || String(e);
    return n;
  }

  getTreeItem(node) {
    const vs = this.vscode, S = vs.TreeItemCollapsibleState;
    switch (node.kind) {
      case 'owner': {
        const { account, owner, own } = node;
        const open = node.org || (own && (!node.hasOrgs || !!node.error));
        const it = new vs.TreeItem(owner, open ? S.Expanded : S.Collapsed);
        it.id = `owner:${account.login.toLowerCase()}:${owner.toLowerCase()}`;
        if (!own) it.description = `via ${account.login}`;
        const gh = account.source === 'gh';
        it.contextValue = !own ? 'owner' : gh ? 'account-gh' : 'account-vscode';
        it.tooltip = !own ? `${owner}, reached through ${account.login}`
          : gh ? `${account.login}, logged in with the gh CLI` : `${account.login}, signed in to VS Code. To sign out, use VS Code's Accounts menu; Hide only removes it from Gannet.`;
        it.iconPath = new vs.ThemeIcon(node.org ? 'organization' : 'account');
        return it;
      }
      case 'group': {
        const it = new vs.TreeItem('All repos', S.Collapsed);
        const login = node.account.login;
        const all = this.full.get(login) || (this.cache && this.cache.get(login) ? this.cache.get(login).repos : null);
        if (all) it.description = String(all.filter((r) => same(r.owner, node.owner)).length);
        const kept = this.cache && this.cache.get(login);
        it.tooltip = kept ? `Fetched ${new Date(kept.fetchedAt).toLocaleString()} — ⟳ fetches again` : 'Every repo of this owner the account can reach';
        it.contextValue = 'group-all';
        it.iconPath = new vs.ThemeIcon('repo');
        return it;
      }
      case 'repo': {
        const it = new vs.TreeItem(node.repo.name, S.Collapsed);
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
        // with a resource and the File/Folder kind, VS Code draws the file icon theme's icons as its explorer does:
        // no folder icons under Seti, and file icons lined up with the folders' arrows
        it.resourceUri = toUri(vs, node.account.login, node.repo.owner, node.repo.name, e.path);
        if (e.type === 'dir') { it.contextValue = 'dir'; it.iconPath = vs.ThemeIcon.Folder; return it; }
        if (e.type === 'submodule') {
          it.contextValue = 'submodule'; it.description = 'submodule';
          it.command = { command: 'gannet.openUrl', title: 'Open on GitHub', arguments: [e.htmlUrl] };
          it.iconPath = new vs.ThemeIcon('file-submodule');
          return it;
        }
        it.contextValue = e.size > LARGE ? 'file-large' : 'file';
        if (e.type === 'symlink') it.description = 'symlink';
        it.command = { command: 'gannet.openFile', title: 'Open', arguments: [node] };
        it.iconPath = vs.ThemeIcon.File;
        return it;
      }
      case 'disk': return diskTreeItem(vs, node);
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

module.exports = { GannetTree, LARGE, diskChildren, diskTreeItem, byName };
