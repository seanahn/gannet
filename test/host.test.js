'use strict';
// The extension as VS Code runs it: what activation registers and cleans up, and what each command does.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { fakeVscode, installVscode, makeMemento, Uri } = require('./stubs.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gannet-host-'));
const sh = (cmd, cwd) => childProcess.execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString();
const manifest = require('../package.json');
// what Gannet keeps per machine lives in a file in its storage folder (on the remote under Remote-SSH), not globalState
const machineFile = (c) => path.join(c.globalStorageUri.fsPath, 'machine.json');
const machine = (c) => { try { return JSON.parse(fs.readFileSync(machineFile(c), 'utf8')); } catch { return {}; } };
const seed = (c, k, v) => { const m = machine(c); m[k] = v; fs.mkdirSync(path.dirname(machineFile(c)), { recursive: true }); fs.writeFileSync(machineFile(c), JSON.stringify(m)); return c; };

(async () => {
  try {
    const home = path.join(tmp, 'home');
    const folder = path.join(home, 'github');
    fs.mkdirSync(path.join(folder, 'left.gannet-partial'), { recursive: true });   // cut off by a restart
    const src = path.join(tmp, 'src');
    fs.mkdirSync(src);
    sh('git init -q -b main && echo hi > a.txt && git add a.txt && git commit -qm one', src);
    const bare = path.join(tmp, 'perch.git');
    sh(`git clone -q --bare "${src}" "${bare}"`, tmp);

    fs.mkdirSync(path.join(tmp, 'ws', '.git'), { recursive: true });   // one repo opened alone: not a workspace
    const opts = { folders: [path.join(tmp, 'ws')], openDialog: [path.join(tmp, 'picked')] };
    const vscode = fakeVscode(opts);
    installVscode(vscode);
    const { runProcess } = require('../src/accounts.js');
    const run = async (cmd, args) => {
      if (cmd === 'gh' && args.join(' ') === 'auth status --hostname github.com') return { code: 0, stdout: 'Logged in to github.com account seanahn (keyring)\n', stderr: '' };
      if (cmd === 'gh' && args[1] === 'token') return { code: 0, stdout: 'gho_test\n', stderr: '' };
      return runProcess(cmd, args);
    };
    const fetch = async () => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => [] });
    const ext = require('../src/extension.js');
    const context = { globalState: makeMemento(), subscriptions: [], globalStorageUri: Uri.file(path.join(tmp, 'store')), extensionPath: path.join(__dirname, '..') };
    await ext.activateWith(context, { run, fetch, home });
    const rec = vscode._rec;

    // registered: the view, the read-only provider, every command the manifest lists
    assert.ok(rec.trees.some((t) => t.id === 'gannet.repos'));
    const prov = rec.providers.find((p) => p.scheme === 'gannet');
    assert.ok(prov && prov.opts.isReadonly === true);
    for (const c of manifest.contributes.commands) assert.ok(rec.commands.has(c.command), 'registered ' + c.command);
    assert.ok(!fs.existsSync(path.join(folder, 'left.gannet-partial')), 'a partial clone left by a restart is removed');
    assert.ok(fs.existsSync(path.join(tmp, 'store', 'gannet-credential')), 'the helper shim is written');

    const account = { login: 'seanahn', source: 'gh' };
    const repo = { fullName: 'seanahn/perch', owner: 'seanahn', name: 'perch', cloneUrl: bare, htmlUrl: 'https://github.com/seanahn/perch', defaultBranch: 'main' };
    const node = { kind: 'repo', account, repo };

    // Check out: cloned into the folder, pushes as the account, appended to the workspace, no new window
    await vscode.commands.executeCommand('gannet.checkout', node);
    const target = path.join(folder, 'perch');
    assert.ok(fs.existsSync(path.join(target, 'a.txt')));
    assert.ok(rec.progress.some((p) => p.cancellable === true && p.location === vscode.ProgressLocation.Notification));
    assert.deepStrictEqual(rec.folderUpdates.at(-1), { start: 1, del: 0, adds: [{ uri: Uri.file(target) }] });
    assert.ok(!rec.executed.some((e) => e.id === 'vscode.openFolder'), 'no new window');
    assert.ok(sh('git config --local --get-all credential.https://github.com.helper', target).includes('gh auth token --hostname github.com --user seanahn'));
    assert.deepStrictEqual(context.globalState.get('gannet.recent').seanahn, ['seanahn/perch']);

    // Check out to…: into the picked folder; VS Code refusing the folder offers Add to workspace
    opts.refuseFolders = true;
    opts.quickPick = (items) => items.find((i) => i.other);
    await vscode.commands.executeCommand('gannet.checkoutTo', { kind: 'repo', account, repo: { ...repo, fullName: 'seanahn/roost', name: 'roost' } });
    assert.ok(fs.existsSync(path.join(tmp, 'picked', 'roost', 'a.txt')));
    const refused = rec.messages.at(-1);
    assert.ok(refused.items.includes('Add to workspace'), JSON.stringify(refused));
    opts.refuseFolders = false;
    opts.quickPick = undefined;
    assert.deepStrictEqual(machine(context)['gannet.workspaces'] || [], [], 'a repo window is not listed');

    // a failing clone: git's line, nothing left behind
    await vscode.commands.executeCommand('gannet.checkout', { kind: 'repo', account, repo: { ...repo, fullName: 'seanahn/nope', name: 'nope', cloneUrl: path.join(tmp, 'missing.git') } });
    assert.strictEqual(rec.messages.at(-1).level, 'error');
    assert.ok(!fs.existsSync(path.join(folder, 'nope.gannet-partial')));

    // Push as: a repo found on disk gets the account's settings
    const byHand = path.join(folder, 'byhand');
    sh(`git clone -q "${bare}" byhand && git -C byhand remote set-url origin https://github.com/seanahn/byhand.git`, folder);
    await vscode.commands.executeCommand('gannet.refresh');
    await ext._state().local.scan(folder);
    await vscode.commands.executeCommand('gannet.pushAs', { kind: 'repo', account, repo: { ...repo, fullName: 'seanahn/byhand', name: 'byhand' } });
    assert.strictEqual(sh('git config --local credential.https://github.com.username', byHand).trim(), 'seanahn');
    assert.strictEqual(ext._state().local.get('seanahn/byhand').login, 'seanahn');

    // Hide account writes the user setting
    await vscode.commands.executeCommand('gannet.hideAccount', { kind: 'account', account });
    assert.deepStrictEqual(rec.configWrites.at(-1), { key: 'gannet.hiddenAccounts', v: ['seanahn'], target: vscode.ConfigurationTarget.Global });

    // a file over 10 MB: a note with Open on GitHub, not opened
    const before = rec.executed.filter((e) => e.id === 'vscode.open').length;
    await vscode.commands.executeCommand('gannet.openFile', { kind: 'entry', account, repo, entry: { name: 'big.bin', path: 'big.bin', type: 'file', size: 11 * 1024 * 1024, htmlUrl: 'https://github.com/seanahn/perch/blob/main/big.bin' } });
    assert.strictEqual(rec.messages.at(-1).msg, 'This file is over 10 MB.');
    assert.ok(rec.messages.at(-1).items.includes('Open on GitHub'));
    assert.strictEqual(rec.executed.filter((e) => e.id === 'vscode.open').length, before);
    // a normal one opens as gannet:
    await vscode.commands.executeCommand('gannet.openFile', { kind: 'entry', account, repo, entry: { name: 'a.js', path: 'src/a.js', type: 'file', size: 3 } });
    const opened = rec.executed.filter((e) => e.id === 'vscode.open').at(-1);
    assert.strictEqual(opened.args[0].scheme, 'gannet');
    assert.strictEqual(opened.args[0].path, '/seanahn/perch/src/a.js');

    // review fix: refresh reads gh's tokens afresh (after gh auth login, say)
    {
      const st = ext._state();
      await st.accounts.token('seanahn');
      assert.strictEqual(st.accounts.cached('seanahn'), true);
      await vscode.commands.executeCommand('gannet.refresh');
      assert.strictEqual(st.accounts.cached('seanahn'), false, 'refresh drops cached tokens');
    }
    await ext.deactivate();

    // review fix: a checkout cut off by an extension restart is resumed on the next start;
    // and with no helper for VS Code accounts, no broken push setting is written
    {
      const context2 = seed({ globalState: makeMemento(), subscriptions: [], globalStorageUri: Uri.file(path.join(tmp, 'store2')), extensionPath: path.join(__dirname, '..') }, 'gannet.pending', [{ repo: { ...repo, fullName: 'seanahn/later', name: 'later' }, account: { login: 'vsuser', source: 'vscode' }, folder: path.join(tmp, 'resumed') }]);
      vscode.accounts.push({ id: 'v', label: 'vsuser' });
      vscode.tokens.vsuser = 'vs-token';
      await ext.activateWith(context2, { run, fetch, home, startServer: async () => { throw new Error('no sockets here'); } });
      await ext._state().resumed;
      const later = path.join(tmp, 'resumed', 'later');
      assert.ok(fs.existsSync(path.join(later, 'a.txt')), 'resumed');
      assert.deepStrictEqual(machine(context2)['gannet.pending'], [], 'and no longer pending');
      const helpers = (() => { try { return sh('git config --local --get-all credential.https://github.com.helper', later); } catch { return ''; } })();
      assert.strictEqual(helpers, '', 'no helper written when it cannot work');
      assert.strictEqual(ext._state().local.get('seanahn/later').login, null, 'so the tree offers Push as later');
      assert.ok(rec.messages.some((m) => /cannot push as vsuser/.test(m.msg)), JSON.stringify(rec.messages.map((m) => m.msg)));
      await ext.deactivate();
    }
    // ---- Workspaces ----
    const W = require('../src/workspaces.js');
    const R = (name) => ({ ...repo, fullName: 'seanahn/' + name, name });
    const ckout = (name) => vscode.commands.executeCommand('gannet.checkout', { kind: 'repo', account, repo: R(name) });
    const ckoutTo = (name) => vscode.commands.executeCommand('gannet.checkoutTo', { kind: 'repo', account, repo: R(name) });
    const t = path.join(tmp, 'w3');
    const G = path.join(t, 'git');
    fs.mkdirSync(path.join(G, 'a'), { recursive: true });
    fs.mkdirSync(path.join(G, 'old.gannet-partial-999999999'));
    fs.mkdirSync(path.join(t, 'ws'));
    const main = path.join(t, 'ws', 'main.code-workspace');
    fs.writeFileSync(main, JSON.stringify({ folders: [{ path: '../git/a' }] }));
    const mkFile = (name) => { fs.mkdirSync(path.join(t, name), { recursive: true }); const f = path.join(t, name, name + '.code-workspace'); fs.writeFileSync(f, '{ "folders": [] }'); return f; };
    const ctx = (state = {}) => ({ globalState: makeMemento(state), subscriptions: [], globalStorageUri: Uri.file(path.join(t, 'store')), extensionPath: path.join(__dirname, '..') });

    // a window with a workspace file: listed, both views registered (Workspaces first), its repo folder cleaned
    {
      opts.workspaceFile = main;
      opts.folders = [path.join(G, 'a')];
      const c3 = ctx();
      const before = rec.trees.length;
      await ext.activateWith(c3, { run, fetch, home });
      const ids = rec.trees.slice(before).map((x) => x.id);
      assert.ok(ids.indexOf('gannet.workspaces') >= 0 && ids.indexOf('gannet.workspaces') < ids.indexOf('gannet.repos'), JSON.stringify(ids));
      assert.deepStrictEqual(machine(c3)['gannet.workspaces'].map((w) => w.path), [main]);
      assert.strictEqual(c3.globalState.get('gannet.workspaces'), undefined, 'not in globalState, which Remote-SSH keeps on the client');
      assert.ok(!fs.existsSync(path.join(G, 'old.gannet-partial-999999999')), 'partials cleaned in the repo folder');

      // Check out: into the repo folder (/git here), added to this window
      const ups = rec.folderUpdates.length;
      await ckout('mainrepo');
      assert.ok(fs.existsSync(path.join(G, 'mainrepo', 'a.txt')));
      assert.strictEqual(rec.folderUpdates.length, ups + 1);
      assert.strictEqual(rec.folderUpdates.at(-1).adds[0].uri.fsPath, path.join(G, 'mainrepo'));

      // Check out to… another workspace file: cloned there, written into that file, this window unchanged
      const other = mkFile('other');
      await ext._state().workspaces.add({ kind: 'file', path: other });
      await ext._state().workspaces.add({ kind: 'file', path: path.join(t, 'missing.code-workspace') });
      opts.quickPick = (items) => items.find((i) => i.label === 'other');
      await ckoutTo('otherrepo');
      const picked = rec.quickPicks.at(-1).items.map((i) => i.label);
      assert.ok(!picked.includes('missing'), 'Missing workspaces are not offered');
      assert.strictEqual(picked[0], 'main', "this window's first");
      assert.strictEqual(picked.at(-1), 'Other folder…');
      assert.ok(fs.existsSync(path.join(t, 'other', 'otherrepo', 'a.txt')));
      assert.ok(W.readFolders(other).includes(path.join(t, 'other', 'otherrepo')));
      assert.strictEqual(rec.folderUpdates.length, ups + 1, 'this window unchanged');

      // the same repo into a third workspace: the copy is reused, not cloned again
      const third = mkFile('third');
      await ext._state().workspaces.add({ kind: 'file', path: third });
      opts.quickPick = (items) => items.find((i) => i.label === 'third');
      await ckoutTo('otherrepo');
      assert.ok(!fs.existsSync(path.join(t, 'third', 'otherrepo')), 'no second copy');
      assert.ok(W.readFolders(third).includes(path.join(t, 'other', 'otherrepo')));

      // the target file gone by the time the clone is done: the clone stays, a warning names both (Review Focus 5)
      const fourth = mkFile('fourth');
      await ext._state().workspaces.add({ kind: 'file', path: fourth });
      opts.quickPick = (items) => { const i = items.find((x) => x.label === 'fourth'); fs.rmSync(fourth); return i; };
      await ckoutTo('fourthrepo');
      assert.ok(fs.existsSync(path.join(t, 'fourth', 'fourthrepo', 'a.txt')));
      const warn = rec.messages.at(-1);
      assert.strictEqual(warn.level, 'warning');
      assert.ok(warn.msg.includes(path.join(t, 'fourth', 'fourthrepo')) && warn.msg.includes(fourth), warn.msg);
      opts.quickPick = undefined;
      await ext.deactivate();
    }

    // a folder window: listed; Check out clones inside it and adds nothing to the window
    const homeWs = path.join(t, 'home');
    fs.mkdirSync(homeWs);
    {
      opts.workspaceFile = undefined;
      opts.folders = [homeWs];
      const c4 = ctx();
      await ext.activateWith(c4, { run, fetch, home });
      assert.ok(machine(c4)['gannet.workspaces'].some((w) => w.path === homeWs && w.kind === 'folder'));
      const ups = rec.folderUpdates.length;
      await ckout('homerepo');
      assert.ok(fs.existsSync(path.join(homeWs, 'homerepo', 'a.txt')));
      assert.strictEqual(rec.folderUpdates.length, ups, 'already inside the folder');
      await ext.deactivate();
    }

    // a checkout cut off by a restart finishes into its workspace, never this window
    {
      const other = path.join(t, 'other', 'other.code-workspace');
      // and one still owned by a live window (this process stands in for it) is left to that window
      const c5 = seed(ctx(), 'gannet.pending', [
        { repo: R('later2'), account, folder: path.join(t, 'other'), workspace: { kind: 'file', path: other, name: 'other' }, pid: 999999999 },
        { repo: R('busy'), account, folder: path.join(t, 'other'), workspace: null, pid: process.pid },
      ]);
      const ups = rec.folderUpdates.length;
      await ext.activateWith(c5, { run, fetch, home });
      await ext._state().resumed;
      assert.ok(W.readFolders(other).includes(path.join(t, 'other', 'later2')));
      assert.strictEqual(rec.folderUpdates.length, ups);
      assert.ok(!fs.existsSync(path.join(t, 'other', 'busy')), 'another window is still on it');
      assert.deepStrictEqual(machine(c5)['gannet.pending'].map((j) => j.repo.name), ['busy']);

      // + : New workspace…, Add folder…, a repo folder refused; Remove, Open, Open here, Set repo folder
      const ws = ext._state().workspaces;
      fs.mkdirSync(path.join(t, 'new'));
      opts.quickPick = (items) => items.find((i) => i.label === 'New workspace…');
      opts.inputBox = 'team';
      opts.openDialog = [path.join(t, 'new')];
      await vscode.commands.executeCommand('gannet.addWorkspace');
      const team = path.join(t, 'new', 'team.code-workspace');
      assert.ok(fs.existsSync(team));
      assert.ok(ws.get(team), 'listed');
      fs.mkdirSync(path.join(t, 'fold'));
      opts.quickPick = (items) => items.find((i) => i.label === 'Add folder…');
      opts.openDialog = [path.join(t, 'fold')];
      await vscode.commands.executeCommand('gannet.addWorkspace');
      assert.strictEqual(ws.get(path.join(t, 'fold')).kind, 'folder');
      opts.openDialog = [path.join(homeWs, 'homerepo')];
      await vscode.commands.executeCommand('gannet.addWorkspace');
      assert.strictEqual(ws.get(path.join(homeWs, 'homerepo')), undefined, 'a repo is not a workspace');
      assert.strictEqual(rec.messages.at(-1).level, 'error');
      opts.quickPick = (items) => items.find((i) => i.label === 'Add workspace file…');
      const third = path.join(t, 'third', 'third.code-workspace');
      opts.openDialog = [third];
      await vscode.commands.executeCommand('gannet.addWorkspace');
      assert.ok(ws.get(third));
      const node = { kind: 'workspace', ws: ws.get(team) };
      await vscode.commands.executeCommand('gannet.openWorkspace', node);
      let ex = rec.executed.at(-1);
      assert.strictEqual(ex.id, 'vscode.openFolder');
      assert.strictEqual(ex.args[0].fsPath, team);
      assert.deepStrictEqual(ex.args[1], { forceNewWindow: true });
      await vscode.commands.executeCommand('gannet.openWorkspaceHere', node);
      assert.deepStrictEqual(rec.executed.at(-1).args[1], { forceNewWindow: false });
      opts.openDialog = [path.join(t, 'rf')];
      fs.mkdirSync(path.join(t, 'rf'));
      await vscode.commands.executeCommand('gannet.setRepoFolder', node);
      assert.strictEqual(ws.get(team).repoFolder, path.join(t, 'rf'));
      await vscode.commands.executeCommand('gannet.removeWorkspace', node);
      assert.strictEqual(ws.get(team), undefined);
      assert.ok(fs.existsSync(team), 'nothing deleted');
      opts.quickPick = undefined; opts.inputBox = undefined;
      await ext.deactivate();
    }
    // where 0.1.0 kept repos in globalState, those still on disk carry over, with their push account
    {
      const old = path.join(G, 'mainrepo');
      const c6 = { globalState: makeMemento({ 'gannet.local': { 'seanahn/mainrepo': { path: old, login: 'seanahn', byGannet: true }, 'x/gone': { path: path.join(t, 'nowhere'), login: 'x', byGannet: true } } }), subscriptions: [], globalStorageUri: Uri.file(path.join(t, 'store-m')), extensionPath: path.join(__dirname, '..') };
      await ext.activateWith(c6, { run, fetch, home });
      assert.strictEqual(ext._state().local.get('seanahn/mainrepo').login, 'seanahn');
      assert.strictEqual(ext._state().local.get('x/gone'), undefined);
      await ext.deactivate();
    }
    console.log('HOST OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); });
