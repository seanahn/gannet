'use strict';
// gannet://<login>/<owner>/<repo>/<path>: a read-only file system over GitHub, for files of repos that are not
// checked out. Reads go to GitHub each time a file is opened; nothing can be written.

function toUri(vscode, login, owner, repo, path) {
  return vscode.Uri.from({ scheme: 'gannet', authority: login, path: `/${owner}/${repo}${path ? '/' + path : ''}` });
}

function fromUri(uri) {
  const [, owner = '', repo = '', ...rest] = String(uri.path).split('/');
  return { login: uri.authority, owner, repo, path: rest.join('/') };
}

const TYPE = (vscode, t) => (t === 'dir' ? vscode.FileType.Directory : t === 'symlink' ? vscode.FileType.File | vscode.FileType.SymbolicLink : t === 'submodule' ? vscode.FileType.Directory : vscode.FileType.File);

class GannetFs {
  constructor({ vscode, clientFor, accounts }) {
    this.vscode = vscode;
    this.clientFor = clientFor;
    this.accounts = accounts;
    this.listings = new Map();   // login/owner/repo/path -> entries, for stat
    this.changed = new vscode.EventEmitter();
    this.onDidChangeFile = this.changed.event;
  }

  toFsError(e, { login, owner }) {
    const E = this.vscode.FileSystemError;
    switch (e && e.kind) {
      case 'auth': if (this.accounts && this.accounts.forget) this.accounts.forget(login); return E.NoPermissions(`GitHub: signed out of ${login}`);
      case 'sso': return E.NoPermissions(`GitHub: ${owner} needs SSO authorization`);
      case 'notFound': return E.FileNotFound(`GitHub: not found`);
      case 'rate': return E.Unavailable(`GitHub: rate limit reached — ${e.message}`);
      default: return E.Unavailable(`GitHub: ${e && e.message ? e.message : e}`);
    }
  }

  async list(where) {
    const key = `${where.login}/${where.owner}/${where.repo}/${where.path}`;
    try {
      const { entries } = await this.clientFor(where.login).listDir(where.owner, where.repo, where.path);
      this.listings.set(key, entries);
      return entries;
    } catch (e) { throw this.toFsError(e, where); }
  }

  async stat(uri) {
    const where = fromUri(uri);
    const now = Date.now();
    if (!where.path) return { type: this.vscode.FileType.Directory, ctime: now, mtime: now, size: 0, permissions: 1 };
    const slash = where.path.lastIndexOf('/');
    const parent = { ...where, path: slash < 0 ? '' : where.path.slice(0, slash) };
    const name = where.path.slice(slash + 1);
    const key = `${parent.login}/${parent.owner}/${parent.repo}/${parent.path}`;
    const entries = this.listings.get(key) || await this.list(parent);
    const hit = entries.find((e) => e.name === name);
    if (!hit) throw this.vscode.FileSystemError.FileNotFound(uri);
    return { type: TYPE(this.vscode, hit.type), ctime: now, mtime: now, size: hit.size || 0, permissions: 1 /* FilePermission.Readonly */ };
  }

  async readDirectory(uri) {
    return (await this.list(fromUri(uri))).map((e) => [e.name, TYPE(this.vscode, e.type)]);
  }

  async readFile(uri) {
    const where = fromUri(uri);
    try { return await this.clientFor(where.login).readFile(where.owner, where.repo, where.path); } catch (e) { throw this.toFsError(e, where); }
  }

  watch() { return { dispose() {} }; }
  readonly() { throw this.vscode.FileSystemError.NoPermissions('Gannet: files on GitHub are read-only; check the repo out to edit'); }
  writeFile() { this.readonly(); }
  delete() { this.readonly(); }
  rename() { this.readonly(); }
  createDirectory() { this.readonly(); }
}

module.exports = { GannetFs, toUri, fromUri };
