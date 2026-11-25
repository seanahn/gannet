'use strict';
// Shared test stubs: a fake vscode module, a fake memento and a fake process runner, so tests need no VS Code.
const Module = require('module');
const origLoad = Module._load;

function makeMemento(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    get: (k, d) => (m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : d),
    update: (k, v) => { if (v === undefined) m.delete(k); else m.set(k, JSON.parse(JSON.stringify(v))); return Promise.resolve(); },
    keys: () => [...m.keys()],
    _dump: () => Object.fromEntries(m),
  };
}

/** Answers run(cmd, args) from a map keyed by "cmd arg arg…"; a value may be a function, or an Error to throw. */
function fakeRun(map) {
  const calls = [];
  const run = async (cmd, args = []) => {
    const key = [cmd, ...args].join(' ');
    calls.push(key);
    let v = map[key];
    if (typeof v === 'function') v = await v();
    if (v instanceof Error) throw v;
    if (v === undefined) return { code: 1, stdout: '', stderr: `no fake for: ${key}` };
    return Object.assign({ code: 0, stdout: '', stderr: '' }, v);
  };
  run.calls = calls;
  return run;
}

class EventEmitter {
  constructor() { this.listeners = []; this.event = (fn) => { this.listeners.push(fn); return { dispose: () => { this.listeners = this.listeners.filter((l) => l !== fn); } }; }; }
  fire(v) { for (const l of [...this.listeners]) l(v); }
  dispose() { this.listeners = []; }
}

class Uri {
  constructor(scheme, authority, path, query = '', fragment = '') { Object.assign(this, { scheme, authority, path, query, fragment }); }
  static file(p) { return new Uri('file', '', p); }
  static parse(s) {
    const m = /^([a-z][a-z0-9+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i.exec(s);
    const dec = (x) => decodeURIComponent(x || '');
    return new Uri(m[1], dec(m[2]), dec(m[3]), dec(m[4]), dec(m[5]));
  }
  static from({ scheme, authority = '', path = '', query = '', fragment = '' }) { return new Uri(scheme, authority, path, query, fragment); }
  get fsPath() { return this.path; }
  with(change) { return new Uri(change.scheme ?? this.scheme, change.authority ?? this.authority, change.path ?? this.path, change.query ?? this.query, change.fragment ?? this.fragment); }
  toString() {
    const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
    return `${this.scheme}://${encodeURIComponent(this.authority)}${enc(this.path)}${this.query ? '?' + encodeURIComponent(this.query) : ''}${this.fragment ? '#' + encodeURIComponent(this.fragment) : ''}`;
  }
}

class FileSystemError extends Error {
  constructor(message, code) { super(message); this.code = code; }
  static FileNotFound(m) { return new FileSystemError(String(m || 'not found'), 'FileNotFound'); }
  static NoPermissions(m) { return new FileSystemError(String(m || 'no permissions'), 'NoPermissions'); }
  static Unavailable(m) { return new FileSystemError(String(m || 'unavailable'), 'Unavailable'); }
  static FileIsADirectory(m) { return new FileSystemError(String(m || 'is a directory'), 'FileIsADirectory'); }
}

class TreeItem { constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; } }
class ThemeIcon { constructor(id) { this.id = id; } }

/**
 * A fake vscode module. opts.accounts: VS Code GitHub accounts [{ id, label }]; opts.tokens: { label: token };
 * opts.config: settings by full key; opts.folders: workspace folder paths; opts.workspaceFile: a path or 'untitled';
 * opts.quickPick(items, o) and opts.inputBox answer those prompts.
 */
function fakeVscode(opts = {}) {
  const sessionsChanged = new EventEmitter();
  const configChanged = new EventEmitter();
  const foldersChanged = new EventEmitter();
  const config = Object.assign({ 'gannet.checkoutFolder': '~/github', 'gannet.hiddenAccounts': [] }, opts.config || {});
  const rec = { quickPicks: [], inputBoxes: [], messages: [], opened: [], commands: new Map(), executed: [], providers: [], trees: [], folderUpdates: [], sessionCalls: [], configWrites: [], progress: [] };
  const vs = {
    _rec: rec, _config: config, _sessionsChanged: sessionsChanged,
    accounts: opts.accounts || [], tokens: opts.tokens || {},
    EventEmitter, Uri, FileSystemError, TreeItem, ThemeIcon,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    authentication: {
      getAccounts: async (provider) => (provider === 'github' ? vs.accounts.slice() : []),
      getSession: async (provider, scopes, o = {}) => {
        rec.sessionCalls.push({ provider, scopes, opts: o });
        if (o.createIfNone) {
          const add = opts.addAccount;   // the account the sign-in "picks"
          if (!add) return undefined;
          if (!vs.accounts.some((a) => a.label === add.label)) vs.accounts.push(add);
          vs.tokens[add.label] = vs.tokens[add.label] || 'tok-' + add.label;
          return { accessToken: vs.tokens[add.label], account: add, scopes };
        }
        const acct = o.account || vs.accounts[0];
        if (!acct || !vs.tokens[acct.label]) return undefined;
        return { accessToken: vs.tokens[acct.label], account: acct, scopes };
      },
      onDidChangeSessions: sessionsChanged.event,
    },
    _foldersChanged: foldersChanged,
    workspace: {
      get workspaceFile() { return opts.workspaceFile === 'untitled' ? Uri.parse('untitled:Untitled-1') : opts.workspaceFile ? Uri.file(opts.workspaceFile) : undefined; },
      onDidChangeWorkspaceFolders: foldersChanged.event,
      get workspaceFolders() { return (opts.folders || []).map((p, index) => ({ uri: Uri.file(p), name: require('path').basename(p), index })); },
      updateWorkspaceFolders: (start, del, ...adds) => {
        rec.folderUpdates.push({ start, del, adds });
        if (opts.refuseFolders) return false;
        opts.folders = (opts.folders || []).concat(adds.map((a) => a.uri.fsPath));
        return true;
      },
      getConfiguration: (section) => ({
        get: (k, d) => { const v = config[section ? section + '.' + k : k]; return v === undefined ? d : v; },
        update: async (k, v, target) => { const key = section ? section + '.' + k : k; config[key] = v; rec.configWrites.push({ key, v, target }); configChanged.fire({ affectsConfiguration: (s) => key === s || key.startsWith(s + '.') }); },
      }),
      onDidChangeConfiguration: configChanged.event,
      registerFileSystemProvider: (scheme, provider, o) => { rec.providers.push({ scheme, provider, opts: o }); return { dispose() {} }; },
    },
    window: {
      showInformationMessage: async (msg, ...items) => { rec.messages.push({ level: 'info', msg, items }); return opts.pick ? opts.pick(msg, items) : undefined; },
      showErrorMessage: async (msg, ...items) => { rec.messages.push({ level: 'error', msg, items }); return opts.pick ? opts.pick(msg, items) : undefined; },
      showWarningMessage: async (msg, ...items) => { rec.messages.push({ level: 'warning', msg, items }); return opts.pick ? opts.pick(msg, items) : undefined; },
      showQuickPick: async (items, o) => { const its = await items; rec.quickPicks.push({ items: its, opts: o }); return opts.quickPick ? opts.quickPick(its, o) : undefined; },
      showInputBox: async (o) => { rec.inputBoxes.push(o); return typeof opts.inputBox === 'function' ? opts.inputBox(o) : opts.inputBox; },
      showOpenDialog: async (o) => { rec.openDialog = o; return opts.openDialog ? opts.openDialog.map((p) => Uri.file(p)) : undefined; },
      withProgress: async (o, task) => { rec.progress.push(o); const cancel = new EventEmitter(); const token = { isCancellationRequested: false, onCancellationRequested: cancel.event }; vs._cancel = () => { token.isCancellationRequested = true; cancel.fire(); }; return task({ report: () => {} }, token); },
      registerTreeDataProvider: (id, provider) => { rec.trees.push({ id, provider }); return { dispose() {} }; },
      createTreeView: (id, o) => { rec.trees.push({ id, provider: o.treeDataProvider }); return { dispose() {} }; },
    },
    commands: {
      registerCommand: (id, fn) => { rec.commands.set(id, fn); return { dispose() {} }; },
      executeCommand: async (id, ...args) => { rec.executed.push({ id, args }); if (rec.commands.has(id)) return rec.commands.get(id)(...args); return undefined; },
    },
    env: { openExternal: async (uri) => { rec.opened.push(String(uri)); return true; } },
  };
  return vs;
}

/** Makes require('vscode') return the given fake. */
function installVscode(vs) {
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return vs;
    return origLoad.call(this, request, parent, isMain);
  };
}

module.exports = { makeMemento, fakeRun, fakeVscode, installVscode, EventEmitter, Uri };
