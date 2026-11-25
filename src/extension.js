'use strict';
// Gannet: the GitHub repos your accounts can reach, as a tree. Wires the parts together and owns the commands.
const vscode = require('vscode');
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
const { alive } = require('./localRepos.js');
const { WorkspaceTree } = require('./workspaceTree.js');

let state = null;

const settings = () => vscode.workspace.getConfiguration('gannet');
const checkoutFolder = () => settings().get('checkoutFolder', '~/github') || '~/github';

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
  const local = createLocalRepos({ memento: machine, home });
  const workspaces = W.createWorkspaces({ memento: machine, home });
  // this window's workspace (a saved workspace file, or one folder that is not a repo), as stored with its settings
  const thisWs = () => { const c = W.currentWorkspace(vscode.workspace); return c && !c.untitled ? (workspaces.get(c.path) || c) : null; };
  const here = thisWs();
  if (here) await workspaces.add(here);
  const listed = () => workspaces.list().filter(W.exists);
  const repoFolders = () => [checkoutFolder(), ...listed().map(W.repoFolderOf)];

  // after a restart (adding a workspace folder can cause one): drop half clones, forget deleted ones, find clones
  for (const f of repoFolders()) local.cleanPartials(f);
  await local.forgetMissing();
  for (const f of repoFolders()) await local.scan(f);

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

  const tree = new GannetTree({ vscode, accounts, clientFor, recent, local });
  const gfs = new GannetFs({ vscode, clientFor, accounts });
  const wsTree = new WorkspaceTree({ vscode, workspaces, local, current: () => W.currentWorkspace(vscode.workspace), home });
  const refreshAll = () => { tree.refresh(); wsTree.refresh(); };
  state = { accounts, recent, local, tree, server, checkout, workspaces, wsTree };

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
  const reveal = async (p) => vscode.commands.executeCommand(inWorkspace(p) ? 'revealInExplorer' : 'revealFileInOS', vscode.Uri.file(p));
  const inside = (p, dir) => { const r = path.relative(dir, p); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };

  // a finished checkout goes into its workspace: none means this window, as before workspaces
  async function place(p, ws, repo) {
    if (!ws) return addToWorkspace(p);
    if (ws.kind === 'folder') {
      if (inside(p, ws.path)) return true;   // already shows as one of the folder's subfolders
      const pick = await vscode.window.showInformationMessage(`${repo.fullName} is already checked out at ${p}.`, 'Reveal in Explorer');
      if (pick === 'Reveal in Explorer') await reveal(p);
      return false;
    }
    const cur = thisWs();
    if (cur && cur.path === ws.path) return addToWorkspace(p);
    try {
      await W.addFolderToFile(ws.path, p);
      return true;
    } catch (e) {
      vscode.window.showWarningMessage(`Checked out to ${p}, but could not update ${ws.path}: ${e && e.message ? e.message : e}`);
      return false;
    }
  }

  // checkouts not yet in the workspace, kept so one cut off by an extension restart is resumed on the next start
  const pending = () => machine.get(PENDING, []) || [];
  const setPending = (list) => machine.update(PENDING, list);
  const samePending = (a, b) => a.repo.fullName === b.repo.fullName && a.folder === b.folder;

  async function doCheckout(node, folder, workspace = null) {
    if (!node || !node.repo) return;
    const { repo, account } = node;
    const job = { repo, account, folder, workspace, pid: process.pid };   // the window doing it
    await setPending([...pending().filter((j) => !samePending(j, job)), job]);
    try {
      const res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Checking out ${repo.fullName}`, cancellable: true },
        (progress, token) => checkout.checkout({ repo, account, folder, token, onProgress: (line) => progress.report({ message: line }), ask: () => pickFolder(`${repo.name} is taken in ${folder} — pick another folder`) }));
      await recent.touch(account.login, repo.fullName);
      await place(res.path, workspace, repo);
      refreshAll();
    } catch (e) {
      if (e && e.message === 'cancelled') return;
      if (e && e.kind === 'auth') accounts.forget(account.login);
      vscode.window.showErrorMessage(`Gannet: could not check out ${repo.fullName}: ${e && e.message ? e.message : e}`);
    } finally {
      await setPending(pending().filter((j) => !samePending(j, job)));
    }
  }

  const localPath = (node) => {
    if (node && node.kind === 'wsrepo') return node.path;
    const l = node && node.repo && local.get(node.repo.fullName);
    return l && l.path;
  };
  const wsOf = (node) => node && node.ws;
  async function addWorkspace() {
    const pick = await vscode.window.showQuickPick([{ label: 'Add workspace file…' }, { label: 'Add folder…' }, { label: 'New workspace…' }], { title: 'Add a workspace' });
    if (!pick) return;
    try {
      if (pick.label === 'Add workspace file…') {
        const r = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, filters: { Workspace: ['code-workspace'] }, openLabel: 'Add', title: 'Add a workspace file' });
        if (!r || !r[0]) return;
        await workspaces.add({ kind: 'file', path: r[0].fsPath });
      } else if (pick.label === 'Add folder…') {
        const f = await pickFolder('Add a folder whose subfolders are repos', 'Add');
        if (!f) return;
        if (W.isGitRepo(f)) { vscode.window.showErrorMessage(`Gannet: ${f} is a git repo; add the folder that holds your repos.`); return; }
        await workspaces.add({ kind: 'folder', path: f });
      } else {
        const name = await vscode.window.showInputBox({ prompt: 'Name of the new workspace', validateInput: (v) => (/^[^/\\:*?"<>|]+$/.test(v || '') ? undefined : 'A file name, without / or \\') });
        if (!name) return;
        const dir = await pickFolder(`Where ${name}'s repos go (the workspace file is kept there too)`, 'Create here');
        if (!dir) return;
        await workspaces.add({ kind: 'file', path: W.createWorkspaceFile(dir, name), repoFolder: dir });
      }
    } catch (e) { vscode.window.showErrorMessage(`Gannet: ${e && e.message ? e.message : e}`); return; }
    for (const f of repoFolders()) await local.scan(f);
    refreshAll();
  }

  const commands = {
    'gannet.refresh': () => { accounts.forgetAll(); tree.refresh(); },
    'gannet.addAccount': async () => { const a = await accounts.addVsCodeAccount(); if (a) tree.refresh(); },
    'gannet.signIn': async () => { await accounts.addVsCodeAccount(); tree.refresh(); },
    'gannet.hideAccount': async (node) => {
      if (!node || !node.account) return;
      const hidden = settings().get('hiddenAccounts', []) || [];
      if (!hidden.includes(node.account.login)) await settings().update('hiddenAccounts', [...hidden, node.account.login], vscode.ConfigurationTarget.Global);
    },
    'gannet.checkout': (node) => { const ws = thisWs(); return doCheckout(node, ws ? W.repoFolderOf(ws) : checkoutFolder(), ws); },
    'gannet.checkoutTo': async (node) => {
      if (!node || !node.repo) return;
      const cur = thisWs();
      const isCur = (ws) => !!(cur && cur.path === ws.path);
      const items = listed().sort((a, b) => Number(isCur(b)) - Number(isCur(a)))
        .map((ws) => ({ label: ws.name, description: isCur(ws) ? 'this window' : ws.path, ws }));
      items.push({ label: 'Other folder…', other: true });
      const pick = await vscode.window.showQuickPick(items, { title: `Check out ${node.repo.fullName} to…` });
      if (!pick) return;
      if (pick.other) { const f = await pickFolder(`Check out ${node.repo.fullName} to…`); if (f) await doCheckout(node, f, null); return; }
      await doCheckout(node, W.repoFolderOf(pick.ws), pick.ws);
    },
    'gannet.openOnGitHub': (node) => {
      const url = node && (node.repo ? node.repo.htmlUrl : node.fullName && `https://github.com/${node.fullName}`);
      return url && vscode.env.openExternal(vscode.Uri.parse(url));
    },
    'gannet.revealLocal': async (node) => { const p = localPath(node); if (p) await reveal(p); },
    'gannet.addWorkspace': addWorkspace,
    'gannet.openWorkspace': (node) => wsOf(node) && vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(node.ws.path), { forceNewWindow: true }),
    'gannet.openWorkspaceHere': (node) => wsOf(node) && vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(node.ws.path), { forceNewWindow: false }),
    'gannet.removeWorkspace': async (node) => { if (wsOf(node)) { await workspaces.remove(node.ws.path); wsTree.refresh(); } },
    'gannet.setRepoFolder': async (node) => {
      if (!wsOf(node)) return;
      const f = await pickFolder(`Where new repos for ${node.ws.name} go`, 'Use this folder');
      if (!f) return;
      await workspaces.setRepoFolder(node.ws.path, f);
      await local.scan(f);
      refreshAll();
    },
    'gannet.addToWorkspace': async (node) => { const p = localPath(node); if (p) await addToWorkspace(p); },
    'gannet.pushAs': async (node) => {
      const p = localPath(node);
      if (!p) return;
      let account = node.account;
      const fullName = node.kind === 'wsrepo' ? node.fullName : node.repo.fullName;
      if (!account) {   // a repo in the Workspaces view has no account: ask which
        const pick = await vscode.window.showQuickPick((await accounts.list()).map((a) => ({ label: a.login, description: a.source === 'gh' ? 'gh' : 'VS Code', account: a })), { title: `Push ${fullName} as…` });
        if (!pick) return;
        account = pick.account;
      }
      try {
        await checkout.configurePush(p, account.login, helperCommand(account));
        await local.remember(fullName, { path: p, login: account.login, byGannet: false });
        refreshAll();
        vscode.window.showInformationMessage(`${fullName} now pushes as ${account.login}.`);
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
    vscode.window.createTreeView('gannet.workspaces', { treeDataProvider: wsTree, showCollapseAll: true }),
    vscode.window.createTreeView('gannet.repos', { treeDataProvider: tree, showCollapseAll: true }),
    vscode.workspace.registerFileSystemProvider('gannet', gfs, { isReadonly: true, isCaseSensitive: true }),
    ...Object.entries(commands).map(([id, fn]) => vscode.commands.registerCommand(id, fn)),
    accounts.onDidChange(() => tree.refresh()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => wsTree.refresh()),
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('gannet.checkoutFolder')) await local.scan(checkoutFolder());
      if (e.affectsConfiguration('gannet')) refreshAll();
    }),
    { dispose: () => { if (server) server.close(); } },
  );

  // resume checkouts an extension restart cut off, one after another, without holding up activation
  state.resumed = (async () => { for (const job of pending().filter((j) => !(j.pid && alive(j.pid)))) await doCheckout({ kind: 'repo', repo: job.repo, account: job.account }, job.folder, job.workspace || null); })();
}

function activate(context) { return activateWith(context); }

async function deactivate() {
  if (state && state.server) await state.server.close();
  state = null;
}

module.exports = { activate, activateWith, deactivate, _state: () => state };
