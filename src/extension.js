'use strict';
// Gannet: the GitHub repos your accounts can reach, as a tree. Wires the parts together and owns the commands.
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createClient } = require('./github.js');
const { createAccounts, runProcess } = require('./accounts.js');
const { createRecent } = require('./recent.js');
const { createLocalRepos } = require('./localRepos.js');
const { createCheckout, ghHelper } = require('./checkout.js');
const { startTokenServer, writeShim, socketDir } = require('./tokenServer.js');
const { GannetFs, toUri } = require('./fsProvider.js');
const { GannetTree } = require('./tree.js');
const W = require('./workspaces.js');
const { createMachineState } = require('./machineState.js');
const { alive, expandHome } = require('./localRepos.js');
const { GannetSidebar } = require('./sidebar.js');
const { createRepoCache } = require('./repoCache.js');
const { createNewFolders, checkName } = require('./newFolders.js');

let state = null;

const settings = () => vscode.workspace.getConfiguration('gannet');

const PENDING = 'gannet.pending';

async function activateWith(context, { run = runProcess, fetch = globalThis.fetch, home = os.homedir(), startServer = startTokenServer } = {}) {
  const store = context.globalStorageUri.fsPath;
  const accounts = createAccounts({ vscode, run, hidden: () => settings().get('hiddenAccounts', []) });
  const clients = new Map();
  const clientFor = (login) => {
    if (!clients.has(login)) clients.set(login, createClient({ fetch, token: () => accounts.token(login) }));
    return clients.get(login);
  };
  const recent = createRecent(context.globalState);
  const machine = createMachineState(path.join(store, 'machine.json'));
  if (!machine.exists()) {   // 0.1.0 kept checkouts in globalState: carry them over; forgetMissing drops other machines'
    const old = context.globalState.get('gannet.local');
    if (old) await machine.update('gannet.local', old);
  }
  // 0.2.0's workspaces, and the checkout folder setting 0.3.0 retires, become the list of directories, once
  await W.migrate({ memento: machine, home, checkoutFolder: settings().get('checkoutFolder') });
  const local = createLocalRepos({ memento: machine, home });
  const workspaces = W.createWorkspaces({ memento: machine, home });
  const listed = () => workspaces.list().filter(W.exists);

  // after a restart (adding a workspace folder can cause one): drop half clones, forget deleted ones, find clones
  for (const f of listed()) local.cleanPartials(f);
  await local.forgetMissing();
  for (const f of listed()) await local.scan(f);

  // Pushing as a VS Code account needs this window to serve tokens, and a shim git can run. Without them (or on
  // Windows, where the helper cannot find the named pipe) such repos are checked out without a push account.
  let shim = '';
  let server = null;
  if (process.platform !== 'win32') {
    try {
      server = await startServer({ dir: store, token: (login) => accounts.token(login) });
      shim = writeShim({ dir: store, execPath: process.execPath, script: path.join(context.extensionPath, 'bin', 'gannet-credential.js'), socketDir: socketDir(store) });
    } catch (e) {
      shim = '';
    }
  }
  const helperCommand = (account) => {
    if ((account.source || accounts.sourceOf(account.login)) !== 'vscode') return ghHelper(account.login);
    if (shim) return `!"${shim}" ${account.login}`;
    vscode.window.showWarningMessage(`Gannet cannot push as ${account.login} from this window; the repo uses your usual git sign-in. Add the account to gh to push as it.`);
    return '';
  };
  const checkout = createCheckout({ run, local, accounts, helperCommand, home });

  const newFolders = createNewFolders({ memento: machine });
  const tree = new GannetTree({ vscode, accounts, clientFor, recent, local, cache: createRepoCache(store), workspaces, home, newFolders, hiddenOwners: () => settings().get('hiddenOwners', []) });
  const gfs = new GannetFs({ vscode, clientFor, accounts });
  const sidebar = new GannetSidebar({ vscode, tree, workspaces, home, extensionUri: context.extensionUri || vscode.Uri.file(context.extensionPath), canReveal: (p) => canReveal(p), checkName: (dir, name) => nameCheck(dir, name) });
  const refreshAll = () => { tree.redraw(); sidebar.refreshWorkspaces(); };   // only ⟳ reads the repo lists again
  state = { accounts, recent, local, tree, server, checkout, workspaces, sidebar };

  const inWorkspace = (p) => (vscode.workspace.workspaceFolders || []).some((f) => f.uri.fsPath === p);
  async function addToWorkspace(p) {
    if (inWorkspace(p)) return true;
    const n = (vscode.workspace.workspaceFolders || []).length;
    const ok = vscode.workspace.updateWorkspaceFolders(n, 0, { uri: vscode.Uri.file(p) });
    if (!ok) {
      const pick = await vscode.window.showInformationMessage(`Checked out to ${p}, but VS Code did not add it to the workspace.`, 'Add to workspace');
      if (pick === 'Add to workspace') return addToWorkspace(p);
    }
    return ok;
  }
  const pickFolder = async (title, openLabel = 'Check out here') => {
    const r = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel, title });
    return r && r[0] ? r[0].fsPath : undefined;
  };
  const within = (p, dir) => { const r = path.relative(dir, p); return !r.startsWith('..') && !path.isAbsolute(r); };   // or equal
  const windowFolders = () => (vscode.workspace.workspaceFolders || []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath);

  // shown in VS Code's Explorer when inside the window's folders; else the OS file manager, which a remote window lacks
  const inWindow = (p) => windowFolders().some((d) => within(p, d));
  const canReveal = (p) => inWindow(p) || !vscode.env.remoteName;
  const reveal = async (p) => {
    if (inWindow(p)) return vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(p));
    if (!vscode.env.remoteName) return vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(p));
    vscode.window.showInformationMessage(`${p} is not in this window; Add to Window to see it in the Explorer.`);
  };

  // a finished checkout goes into this window, unless it already shows inside one of its folders (seclab's ~/)
  const place = (p) => (windowFolders().some((d) => within(p, d)) ? true : addToWorkspace(p));

  // a workspace is a folder that holds repos, never a repo, so nothing is ever cloned inside one
  const isRepo = (f) => {
    if (!W.isGitRepo(f)) return false;
    vscode.window.showErrorMessage(`Gannet: ${f} is a git repo; add the folder that holds your repos.`);
    return true;
  };

  /** Where Check out puts a repo: asked when there is no workspace, several, or a copy already. */
  async function whereTo(repo) {
    const live = listed();
    const copies = local.checkoutsOf(repo.fullName);
    if (!live.length) {
      const gh = path.join(home, 'github');
      const pick = await vscode.window.showQuickPick([
        { label: '~/github', description: W.exists(gh) ? undefined : 'will be created', dir: gh },
        { label: 'Choose a folder…', choose: true },
      ], { title: 'Where should Gannet check out repos?' });
      if (!pick) return undefined;
      const dir = pick.choose ? await pickFolder('Where Gannet checks out repos', 'Use this folder') : pick.dir;
      if (!dir || isRepo(dir)) return undefined;
      fs.mkdirSync(dir, { recursive: true });
      await workspaces.add(dir);
      sidebar.refreshWorkspaces();
      return dir;
    }
    if (live.length === 1 && !copies.length) return live[0];
    const wf = windowFolders();
    const items = live.map((w, i) => ({ w, i, n: wf.filter((d) => within(d, w)).length }))
      .sort((a, b) => (b.n - a.n) || (a.i - b.i))
      .map(({ w }) => {
        const here = copies.filter((c) => W.workspaceOf(c.path, live) === w).map((c) => path.basename(c.path));
        return { label: W.tilde(w, home), description: here.length ? `has ${here.join(', ')}` : undefined, dir: w };
      });
    if (copies.length) items.push({ label: 'Other folder…', other: true });
    const pick = await vscode.window.showQuickPick(items, { title: `Check out ${repo.fullName} to…` });
    if (!pick) return undefined;
    return pick.other ? pickFolder(`Check out ${repo.fullName} to…`) : pick.dir;
  }

  // checkouts not yet in the window, kept so one cut off by an extension restart is resumed on the next start
  const pending = () => machine.get(PENDING, []) || [];
  const setPending = (list) => machine.update(PENDING, list);
  let seq = 0;
  const newId = () => `${process.pid}-${Date.now()}-${++seq}`;

  async function doCheckout(node, folder, { target = null, id = null } = {}) {
    if (!node || !node.repo) return;
    const { repo, account } = node;
    const job = { id: id || newId(), repo, account, folder, target, pid: process.pid };   // the window doing it
    await setPending([...pending().filter((j) => j.id !== job.id), job]);
    try {
      const onTarget = (t) => setPending(pending().map((j) => (j.id === job.id ? { ...j, target: t } : j)));
      const res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Checking out ${repo.fullName}`, cancellable: true },
        (progress, token) => checkout.checkout({ repo, account, folder, target, onTarget, token, onProgress: (line) => progress.report({ message: line }) }));
      await recent.touch(account.login, repo.fullName);
      await place(res.path);
      refreshAll();
    } catch (e) {
      if (e && e.message === 'cancelled') return;
      if (e && e.kind === 'auth') accounts.forget(account.login);
      vscode.window.showErrorMessage(`Gannet: could not check out ${repo.fullName}: ${e && e.message ? e.message : e}`);
    } finally {
      await setPending(pending().filter((j) => j.id !== job.id));
    }
  }

  /** The one checkout a command acts on: a checkout node's, or a repo's only one. */
  const oneCheckout = (node) => {
    if (!node) return null;
    if (node.kind === 'checkout') return node.checkout;
    if (node.kind === 'newFolder') return { path: node.rec.path };
    const copies = node.repo ? local.checkoutsOf(node.repo.fullName) : [];
    return copies.length === 1 ? copies[0] : null;
  };
  async function addWorkspace() {
    const f = await pickFolder('Add a folder Gannet checks repos out into', 'Add');
    if (!f) return;
    if (isRepo(f)) return;
    await workspaces.add(f);
    local.cleanPartials(f);
    await local.scan(f);
    refreshAll();
  }

  // a folder not on GitHub yet: Gannet records which owner row it sits under; it never runs git in it
  const recorded = (p) => newFolders.list().some((r) => r.path === p);
  const nameCheck = (dir, name) => {
    const c = checkName(dir, name);
    if (c.ok && c.adopt && recorded(path.join(dir, name))) return { ok: false, message: `${name} is already under an owner.` };
    return c;
  };
  async function pickOwner(title, except = null) {
    const items = (await tree.owners())
      .filter((o) => !(except && o.owner.toLowerCase() === except.owner.toLowerCase() && o.account.login === except.account))
      .map((o) => ({ label: o.owner, description: o.own ? undefined : `via ${o.account.login}`, o }));
    const pick = await vscode.window.showQuickPick(items, { title });
    return pick ? { owner: pick.o.owner, account: pick.o.account.login } : null;
  }
  async function newFolder(node) {
    const dir = node && node.path;
    if (!dir) return;
    // the sidebar names it in place; with no name (a caller other than the page) it asks in an input box
    const name = typeof node.name === 'string' ? node.name : await vscode.window.showInputBox({
      title: `New folder in ${W.tilde(dir, home)}`, prompt: 'A folder for a repo not on GitHub yet',
      validateInput: (v) => { const c = nameCheck(dir, v); return !c.ok ? c.message : c.adopt ? `${v} exists: it will be put under an owner` : null; },
    });
    if (name === undefined) return;
    const c = nameCheck(dir, name);
    if (!c.ok) { vscode.window.showErrorMessage(`Gannet: ${c.message}`); return; }   // e.g. taken since it was checked
    const p = path.join(dir, name);
    const to = await pickOwner(`Put ${name} under…`);
    if (!to) return;
    if (!c.adopt) {
      try { fs.mkdirSync(p); } catch (e) { vscode.window.showErrorMessage(`Gannet: could not create ${p}: ${e.message}`); return; }
    }
    await newFolders.add({ path: p, ...to });   // recorded first: adding a folder to the window can restart the extension
    tree.redraw();
    await place(p);
  }

  const commands = {
    'gannet.refresh': async () => {
      accounts.forgetAll();
      for (const f of listed()) { local.cleanPartials(f); await local.scan(f); }   // clones made by hand since start
      tree.refresh();
    },
    'gannet.newFolder': newFolder,
    'gannet.moveNewFolder': async (node, target) => {
      if (!node || node.kind !== 'newFolder') return;
      const to = target && target.kind === 'owner' && target.owner && target.account
        ? { owner: target.owner, account: target.account.login }
        : await pickOwner(`Move ${path.basename(node.rec.path)} to…`, { owner: node.owner, account: node.account.login });
      if (!to) return;
      await newFolders.move(node.rec.path, to);
      tree.redraw();
    },
    'gannet.forgetNewFolder': async (node) => {
      if (!node || node.kind !== 'newFolder') return;
      await newFolders.forget(node.rec.path);   // the folder stays on disk
      tree.redraw();
    },
    'gannet.addAccount': async () => { const a = await accounts.addVsCodeAccount(); if (a) tree.redraw(); },
    'gannet.signIn': async () => { await accounts.addVsCodeAccount(); tree.redraw(); },
    'gannet.hideAccount': async (node) => {
      if (!node || !node.account) return;
      const hidden = settings().get('hiddenAccounts', []) || [];
      if (!hidden.includes(node.account.login)) await settings().update('hiddenAccounts', [...hidden, node.account.login], vscode.ConfigurationTarget.Global);
    },
    'gannet.hideOwner': async (node) => {
      if (!node || node.kind !== 'owner' || node.own || !node.owner) return;
      const hidden = settings().get('hiddenOwners', []) || [];
      if (hidden.some((o) => String(o).toLowerCase() === node.owner.toLowerCase())) return;
      await settings().update('hiddenOwners', [...hidden, node.owner], vscode.ConfigurationTarget.Global);
    },
    'gannet.checkout': async (node) => {
      if (!node || !node.repo) return;
      const dir = await whereTo(node.repo);
      if (dir) await doCheckout(node, dir);
    },
    'gannet.checkoutTo': async (node) => {
      if (!node || !node.repo) return;
      const f = await pickFolder(`Check out ${node.repo.fullName} to…`);
      if (f) await doCheckout(node, f);
    },
    'gannet.openOnGitHub': (node) => {
      const url = node && (node.repo ? node.repo.htmlUrl : node.fullName && `https://github.com/${node.fullName}`);
      return url && vscode.env.openExternal(vscode.Uri.parse(url));
    },
    'gannet.revealLocal': async (node) => { const c = oneCheckout(node); if (c) await reveal(c.path); },
    'gannet.addWorkspace': addWorkspace,
    'gannet.removeWorkspace': async (node) => { if (node && node.path) { await workspaces.remove(node.path); refreshAll(); } },
    'gannet.revealWorkspace': async (node) => {
      if (!node || !node.path) return;
      if (inWindow(node.path)) await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(node.path));
      else if (!vscode.env.remoteName) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(node.path));
    },
    'gannet.addToWorkspace': async (node) => { const c = oneCheckout(node); if (c) await addToWorkspace(c.path); },
    'gannet.pushAs': async (node) => {
      const c = oneCheckout(node);
      if (!c || !node.account || !node.repo) return;
      const { account, repo } = node;
      try {
        await checkout.configurePush(c.path, account.login, helperCommand(account));
        await local.remember(repo.fullName, { path: c.path, login: account.login, byGannet: c.byGannet });
        refreshAll();
        vscode.window.showInformationMessage(`${repo.fullName} at ${c.path} now pushes as ${account.login}.`);
      } catch (e) { vscode.window.showErrorMessage(`Gannet: ${e.message}`); }
    },
    'gannet.openFile': async (node) => {
      if (!node || !node.entry) return;
      if (node.entry.size > 10 * 1024 * 1024) {
        const pick = await vscode.window.showInformationMessage('This file is over 10 MB.', 'Open on GitHub');
        if (pick === 'Open on GitHub') await vscode.env.openExternal(vscode.Uri.parse(node.entry.htmlUrl));
        return;
      }
      await vscode.commands.executeCommand('vscode.open', toUri(vscode, node.account.login, node.repo.owner, node.repo.name, node.entry.path));
    },
    'gannet.openUrl': (url) => url && vscode.env.openExternal(vscode.Uri.parse(String(url))),
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(GannetSidebar.viewType, sidebar),
    vscode.workspace.registerFileSystemProvider('gannet', gfs, { isReadonly: true, isCaseSensitive: true }),
    // a command run from a row's right-click menu gets the row's context; it names the node
    ...Object.entries(commands).map(([id, fn]) => vscode.commands.registerCommand(id, NODE_COMMANDS.has(id) ? (arg, ...rest) => fn(sidebar.resolve(arg) || arg, ...rest) : fn)),
    accounts.onDidChange(() => tree.redraw()),
    vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('gannet')) refreshAll(); }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => sidebar.refreshWorkspaces()),
    { dispose: () => { if (server) server.close(); } },
  );

  // resume checkouts an extension restart cut off, one after another, without holding up activation
  state.resumed = (async () => {
    // 0.2.0's jobs had no id or target; its clone went to <folder>/<repo>, so look there first, and never clone twice
    await setPending(pending().map((j) => (j.id ? j : {
      ...j, id: newId(), target: j.target || (j.folder && j.repo ? path.join(path.resolve(expandHome(j.folder, home)), j.repo.name) : null),
    })));
    for (const job of pending().filter((j) => !(j.pid && alive(j.pid)))) {
      await doCheckout({ kind: 'repo', repo: job.repo, account: job.account }, job.folder, { target: job.target || null, id: job.id });
    }
  })();
}

const NODE_COMMANDS = new Set(['gannet.checkout', 'gannet.checkoutTo', 'gannet.openOnGitHub', 'gannet.revealLocal', 'gannet.addToWorkspace', 'gannet.pushAs', 'gannet.hideAccount', 'gannet.hideOwner', 'gannet.signIn', 'gannet.moveNewFolder', 'gannet.forgetNewFolder']);

function activate(context) { return activateWith(context); }

async function deactivate() {
  if (state && state.server) await state.server.close();
  state = null;
}

module.exports = { activate, activateWith, deactivate, _state: () => state };
