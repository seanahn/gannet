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
  const local = createLocalRepos({ memento: context.globalState, home });

  // after a restart (adding a workspace folder can cause one): drop half clones, forget deleted ones, find clones
  local.cleanPartials(checkoutFolder());
  await local.forgetMissing();
  await local.scan(checkoutFolder());

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
  state = { accounts, recent, local, tree, server, checkout };

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
  const pickFolder = async (title) => {
    const r = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Check out here', title });
    return r && r[0] ? r[0].fsPath : undefined;
  };

  // checkouts not yet in the workspace, kept so one cut off by an extension restart is resumed on the next start
  const pending = () => context.globalState.get(PENDING, []) || [];
  const setPending = (list) => context.globalState.update(PENDING, list);
  const samePending = (a, b) => a.repo.fullName === b.repo.fullName && a.folder === b.folder;

  async function doCheckout(node, folder) {
    if (!node || !node.repo) return;
    const { repo, account } = node;
    const job = { repo, account, folder };
    await setPending([...pending().filter((j) => !samePending(j, job)), job]);
    try {
      const res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Checking out ${repo.fullName}`, cancellable: true },
        (progress, token) => checkout.checkout({ repo, account, folder, token, onProgress: (line) => progress.report({ message: line }), ask: () => pickFolder(`${repo.name} is taken in ${folder} — pick another folder`) }));
      await recent.touch(account.login, repo.fullName);
      tree.refresh();
      await addToWorkspace(res.path);
    } catch (e) {
      if (e && e.message === 'cancelled') return;
      if (e && e.kind === 'auth') accounts.forget(account.login);
      vscode.window.showErrorMessage(`Gannet: could not check out ${repo.fullName}: ${e && e.message ? e.message : e}`);
    } finally {
      await setPending(pending().filter((j) => !samePending(j, job)));
    }
  }

  const localPath = (node) => { const l = node && node.repo && local.get(node.repo.fullName); return l && l.path; };
  const commands = {
    'gannet.refresh': () => { accounts.forgetAll(); tree.refresh(); },
    'gannet.addAccount': async () => { const a = await accounts.addVsCodeAccount(); if (a) tree.refresh(); },
    'gannet.signIn': async () => { await accounts.addVsCodeAccount(); tree.refresh(); },
    'gannet.hideAccount': async (node) => {
      if (!node || !node.account) return;
      const hidden = settings().get('hiddenAccounts', []) || [];
      if (!hidden.includes(node.account.login)) await settings().update('hiddenAccounts', [...hidden, node.account.login], vscode.ConfigurationTarget.Global);
    },
    'gannet.checkout': (node) => doCheckout(node, checkoutFolder()),
    'gannet.checkoutTo': async (node) => { const f = await pickFolder(`Check out ${node && node.repo ? node.repo.fullName : ''} to…`); if (f) await doCheckout(node, f); },
    'gannet.openOnGitHub': (node) => node && node.repo && vscode.env.openExternal(vscode.Uri.parse(node.repo.htmlUrl)),
    'gannet.revealLocal': async (node) => {
      const p = localPath(node);
      if (!p) return;
      await vscode.commands.executeCommand(inWorkspace(p) ? 'revealInExplorer' : 'revealFileInOS', vscode.Uri.file(p));
    },
    'gannet.addToWorkspace': async (node) => { const p = localPath(node); if (p) await addToWorkspace(p); },
    'gannet.pushAs': async (node) => {
      const p = localPath(node);
      if (!p) return;
      try {
        await checkout.configurePush(p, node.account.login, helperCommand(node.account));
        await local.remember(node.repo.fullName, { path: p, login: node.account.login, byGannet: false });
        tree.refresh();
        vscode.window.showInformationMessage(`${node.repo.fullName} now pushes as ${node.account.login}.`);
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
    vscode.window.createTreeView('gannet.repos', { treeDataProvider: tree, showCollapseAll: true }),
    vscode.workspace.registerFileSystemProvider('gannet', gfs, { isReadonly: true, isCaseSensitive: true }),
    ...Object.entries(commands).map(([id, fn]) => vscode.commands.registerCommand(id, fn)),
    accounts.onDidChange(() => tree.refresh()),
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('gannet.checkoutFolder')) await local.scan(checkoutFolder());
      if (e.affectsConfiguration('gannet')) tree.refresh();
    }),
    { dispose: () => { if (server) server.close(); } },
  );

  // resume checkouts an extension restart cut off, one after another, without holding up activation
  state.resumed = (async () => { for (const job of pending()) await doCheckout({ kind: 'repo', repo: job.repo, account: job.account }, job.folder); })();
}

function activate(context) { return activateWith(context); }

async function deactivate() {
  if (state && state.server) await state.server.close();
  state = null;
}

module.exports = { activate, activateWith, deactivate, _state: () => state };
