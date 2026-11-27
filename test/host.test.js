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
    assert.ok(rec.webviews.some((w) => w.id === 'gannet.main'), 'one webview view');
    assert.strictEqual(rec.trees.length, 0, 'no tree views');
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
    await vscode.commands.executeCommand('gannet.checkoutTo', { kind: 'repo', account, repo: { ...repo, fullName: 'seanahn/roost', name: 'roost' } });
    assert.ok(fs.existsSync(path.join(tmp, 'picked', 'roost', 'a.txt')));
    const refused = rec.messages.at(-1);
    assert.ok(refused.items.includes('Add to workspace'), JSON.stringify(refused));
    opts.refuseFolders = false;
    assert.deepStrictEqual(machine(context)['gannet.workspaces'], [folder], 'the old checkout folder, carried over; not the picked folder, nor the window');

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
    assert.strictEqual(ext._state().local.checkoutsOf('seanahn/byhand')[0].login, 'seanahn');

    // Hide account writes the user setting
    await vscode.commands.executeCommand('gannet.hideAccount', { kind: 'account', account });
    assert.deepStrictEqual(rec.configWrites.at(-1), { key: 'gannet.hiddenAccounts', v: ['seanahn'], target: vscode.ConfigurationTarget.Global });

    // Hide owner writes its own setting; an account node is not an owner to hide
    await vscode.commands.executeCommand('gannet.hideOwner', { kind: 'owner', account, owner: 'bpmn2', own: false });
    assert.deepStrictEqual(rec.configWrites.at(-1), { key: 'gannet.hiddenOwners', v: ['bpmn2'], target: vscode.ConfigurationTarget.Global });
    const writes = rec.configWrites.length;
    await vscode.commands.executeCommand('gannet.hideOwner', { kind: 'owner', account, owner: 'seanahn', own: true });
    await vscode.commands.executeCommand('gannet.hideOwner', { kind: 'owner', account, owner: 'BPMN2', own: false });
    assert.strictEqual(rec.configWrites.length, writes, 'own login and an owner already hidden: no write');
    const hideMenu = manifest.contributes.menus['webview/context'].find((m) => m.command === 'gannet.hideOwner');
    assert.ok(/viewItem == owner\b/.test(hideMenu.when), hideMenu.when);

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
      assert.strictEqual(ext._state().local.checkoutsOf('seanahn/later')[0].login, null, 'so the tree offers Push as later');
      assert.ok(rec.messages.some((m) => /cannot push as vsuser/.test(m.msg)), JSON.stringify(rec.messages.map((m) => m.msg)));
      await ext.deactivate();
    }
    // ---- 0.3.0: workspaces are directories ----
    const W = require('../src/workspaces.js');
    const R = (name) => ({ ...repo, fullName: 'seanahn/' + name, name });
    const ckout = (name) => vscode.commands.executeCommand('gannet.checkout', { kind: 'repo', account, repo: R(name) });
    const t = path.join(tmp, 'w3');
    fs.mkdirSync(t);
    const ctx = (name, state = {}) => ({ globalState: makeMemento(state), subscriptions: [], globalStorageUri: Uri.file(path.join(t, name)), extensionPath: path.join(__dirname, '..') });
    const picks = () => rec.quickPicks.length;

    // upgrading from 0.2.0: its list carried over, the old checkout folder added, partials cleaned there
    {
      const hA = path.join(t, 'hA');
      const F = path.join(t, 'F');
      fs.mkdirSync(path.join(hA, 'github', 'x.gannet-partial-999999999'), { recursive: true });
      fs.mkdirSync(F);
      const c = seed(ctx('storeA'), 'gannet.workspaces', [{ kind: 'folder', path: F, name: 'F' }]);
      opts.folders = [path.join(tmp, 'ws')];
      await ext.activateWith(c, { run, fetch, home: hA });
      assert.deepStrictEqual(machine(c)['gannet.workspaces'], [F, path.join(hA, 'github')]);
      assert.ok(!fs.existsSync(path.join(hA, 'github', 'x.gannet-partial-999999999')));
      await ext.deactivate();
    }

    // Final review: the first question's Choose a folder… refuses a git repo, as + does
    {
      const hC = path.join(t, 'hC');
      const inRepo = path.join(hC, 'proj');
      fs.mkdirSync(path.join(inRepo, '.git'), { recursive: true });
      const c = ctx('storeC');
      await ext.activateWith(c, { run, fetch, home: hC });
      opts.quickPick = (items) => items.find((i) => i.choose);
      opts.openDialog = [inRepo];
      await ckout('nested');
      assert.ok(!fs.existsSync(path.join(inRepo, 'nested')), 'not cloned inside a repo');
      assert.deepStrictEqual(ext._state().workspaces.list(), [], 'not listed');
      assert.strictEqual(rec.messages.at(-1).level, 'error');
      opts.quickPick = undefined;
      opts.openDialog = [path.join(tmp, 'picked')];
      await ext.deactivate();
    }

    const hB = path.join(t, 'hB');
    fs.mkdirSync(hB);
    const ghB = path.join(hB, 'github');
    {
      const c = ctx('storeB');
      opts.folders = [path.join(tmp, 'ws')];
      // seanahn was hidden above; here GitHub lists seanahn/perch, so the page's rows reach its checkouts
      await vscode.workspace.getConfiguration('gannet').update('hiddenAccounts', [], vscode.ConfigurationTarget.Global);
      const ghRepos = [{ full_name: 'seanahn/perch', owner: { login: 'seanahn' }, name: 'perch', clone_url: bare, html_url: 'https://github.com/seanahn/perch', default_branch: 'main' }];
      const fetchB = async (url) => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => (/\/user\/repos/.test(String(url)) ? ghRepos : []) });
      await ext.activateWith(c, { run, fetch: fetchB, home: hB });
      const st = ext._state();

      // no workspace yet: asked where, ~/github offered, made and listed
      let before = picks();
      opts.quickPick = (items) => items.find((i) => i.label === '~/github');
      const ups = rec.folderUpdates.length;
      await ckout('perch');
      assert.strictEqual(picks(), before + 1);
      const first = rec.quickPicks.at(-1);
      assert.strictEqual(first.opts.title, 'Where should Gannet check out repos?');
      assert.deepStrictEqual(first.items.map((i) => [i.label, i.description]), [['~/github', 'will be created'], ['Choose a folder…', undefined]]);
      assert.ok(fs.existsSync(path.join(ghB, 'perch', 'a.txt')));
      assert.deepStrictEqual(st.workspaces.list(), [ghB]);
      assert.strictEqual(rec.folderUpdates.length, ups + 1, 'added to the window');

      // one workspace, a new repo: no question
      before = picks();
      await ckout('roost');
      assert.strictEqual(picks(), before, 'not asked');
      assert.ok(fs.existsSync(path.join(ghB, 'roost', 'a.txt')));

      // already checked out: asked, Other folder… last; the same workspace gives the next free name
      before = picks();
      await ckout('perch');
      assert.strictEqual(picks(), before + 1);
      const again = rec.quickPicks.at(-1).items;
      assert.deepStrictEqual(again.map((i) => i.label), ['~/github', 'Other folder…']);
      assert.ok(/perch/.test(again[0].description), 'names the copy already there: ' + again[0].description);
      assert.ok(fs.existsSync(path.join(ghB, 'seanahn-perch', 'a.txt')));
      assert.strictEqual(st.tree.getTreeItem({ kind: 'repo', account, repo: R('perch') }).contextValue, 'repo-multi');

      // several workspaces: the one holding this window's folders first; cancelling clones nothing
      const work = path.join(hB, 'work');
      fs.mkdirSync(work);
      await st.workspaces.add(work);
      opts.folders = [path.join(work, 'proj')];
      opts.quickPick = () => undefined;
      await ckout('third');
      assert.deepStrictEqual(rec.quickPicks.at(-1).items.map((i) => i.label), ['~/work', '~/github']);
      assert.ok(!fs.existsSync(path.join(work, 'third')) && !fs.existsSync(path.join(ghB, 'third')));

      // a Missing workspace is not offered; with one live one left, no question
      fs.rmSync(work, { recursive: true });
      before = picks();
      opts.quickPick = undefined;
      await ckout('fourth');
      assert.strictEqual(picks(), before);
      assert.ok(fs.existsSync(path.join(ghB, 'fourth')));

      // the window is home (seclab): a checkout inside it is not added again
      opts.folders = [hB];
      const ups2 = rec.folderUpdates.length;
      await ckout('sec');
      assert.ok(fs.existsSync(path.join(ghB, 'sec')));
      assert.strictEqual(rec.folderUpdates.length, ups2);

      // + adds a directory (not a repo); Remove forgets it and deletes nothing; Reveal shows it
      const extra = path.join(hB, 'extra');
      fs.mkdirSync(extra);
      opts.openDialog = [extra];
      const sv = vscode._resolveView('gannet.main');
      await vscode.commands.executeCommand('gannet.addWorkspace');
      assert.ok(st.workspaces.list().includes(extra));
      assert.ok(sv._posted.filter((m) => m.type === 'workspaces').at(-1).items.some((w) => w.path === extra), 'the panel shows it');
      opts.openDialog = [path.join(ghB, 'perch')];
      await vscode.commands.executeCommand('gannet.addWorkspace');
      assert.ok(!st.workspaces.list().includes(path.join(ghB, 'perch')), 'a repo is not a workspace');
      assert.strictEqual(rec.messages.at(-1).level, 'error');
      // Reveal: inside the window's folders, in VS Code's Explorer; outside, the OS file manager, except in a remote
      // window, where there is none to open: no button, and the command does nothing
      await vscode.commands.executeCommand('gannet.revealWorkspace', { kind: 'workspace', path: extra });
      assert.strictEqual(rec.executed.at(-1).id, 'revealInExplorer');
      assert.strictEqual(rec.executed.at(-1).args[0].fsPath, extra);
      const far = path.join(tmp, 'far');
      fs.mkdirSync(far);
      await st.workspaces.add(far);
      await vscode.commands.executeCommand('gannet.revealWorkspace', { path: far });
      assert.strictEqual(rec.executed.at(-1).id, 'revealFileInOS');
      assert.strictEqual(rec.executed.at(-1).args[0].fsPath, far);
      opts.remoteName = 'ssh-remote';
      const ranR = rec.executed.length;
      await vscode.commands.executeCommand('gannet.revealWorkspace', { path: far });
      assert.strictEqual(rec.executed.length, ranR + 1, 'only the Gannet command itself ran');
      vscode._foldersChanged.fire({ added: [], removed: [] });
      const panel = sv._posted.filter((m) => m.type === 'workspaces').at(-1).items;
      assert.deepStrictEqual(panel.filter((w) => w.path === far || w.path === extra).map((w) => [w.path, w.reveal]), [[extra, true], [far, false]],
        'the panel follows the window: no Reveal on a remote directory outside it');
      opts.remoteName = undefined;
      await st.workspaces.remove(far);
      await vscode.commands.executeCommand('gannet.removeWorkspace', { kind: 'workspace', path: extra });
      assert.ok(!st.workspaces.list().includes(extra));
      assert.ok(fs.existsSync(extra), 'nothing deleted');
      opts.openDialog = [path.join(tmp, 'picked')];

      // Reveal and Push as act on one checkout: on a repo with two, they are on each checkout node
      // a right-click names its row: reach the second checkout through the page's messages
      await sv._send({ type: 'ready' });
      const rowsOf = (parent) => sv._posted.filter((m) => m.type === 'rows' && m.parent === parent).at(-1).rows;
      const ownerRow = rowsOf(null).find((r) => r.label === 'seanahn');
      await sv._send({ type: 'expand', id: ownerRow.id });
      const perchRow = rowsOf(ownerRow.id).find((r) => r.label === 'perch');
      assert.strictEqual(perchRow.contextValue, 'repo-multi');
      await sv._send({ type: 'expand', id: perchRow.id });
      const second = rowsOf(perchRow.id).find((r) => st.sidebar.resolve({ nodeId: r.id }).checkout.path === path.join(ghB, 'seanahn-perch'));
      await vscode.commands.executeCommand('gannet.pushAs', { webviewSection: 'row', viewItem: second.contextValue, nodeId: second.id });
      assert.strictEqual(sh('git config --local credential.https://github.com.username', path.join(ghB, 'seanahn-perch')).trim(), 'seanahn');
      await vscode.commands.executeCommand('gannet.revealLocal', { kind: 'repo', account, repo: R('perch') });
      assert.notStrictEqual(rec.executed.at(-1).args[0] && rec.executed.at(-1).args[0].fsPath, path.join(ghB, 'perch'), 'a repo with two checkouts reveals neither');
      await ext.deactivate();
    }

    // resume: a clone already in place is only set up; one with no target is cloned; a live window's is left alone
    {
      const resumed = path.join(ghB, 'resumed');
      sh(`git clone -q "${bare}" resumed && git -C resumed remote set-url origin https://github.com/seanahn/resumed.git`, ghB);
      // Final review: a 0.2.0 job whose clone was renamed into place before the restart
      const done = path.join(ghB, 'done');
      sh(`git clone -q "${bare}" done && git -C done remote set-url origin https://github.com/seanahn/done.git`, ghB);
      const c = seed(ctx('storeB'), 'gannet.pending', [
        { id: 'a', repo: R('resumed'), account, folder: ghB, target: resumed, pid: 999999999 },
        { repo: R('fresh'), account, folder: ghB, workspace: null, pid: 999999999 },   // 0.2.0's shape
        { repo: R('done'), account, folder: ghB, workspace: null, pid: 999999999 },    // 0.2.0's, already cloned
        { id: 'c', repo: R('busy'), account, folder: ghB, target: null, pid: process.pid },
      ]);
      await ext.activateWith(c, { run, fetch, home: hB });
      await ext._state().resumed;
      assert.ok(!fs.existsSync(path.join(ghB, 'seanahn-resumed')), 'not cloned twice');
      assert.strictEqual(sh('git config --local credential.https://github.com.username', resumed).trim(), 'seanahn');
      assert.ok(fs.existsSync(path.join(ghB, 'fresh', 'a.txt')));
      assert.ok(!fs.existsSync(path.join(ghB, 'seanahn-done')), "0.2.0's finished clone is not cloned again");
      assert.strictEqual(sh('git config --local credential.https://github.com.username', done).trim(), 'seanahn');
      assert.ok(!fs.existsSync(path.join(ghB, 'busy')), 'another window is still on it');
      assert.deepStrictEqual(machine(c)['gannet.pending'].map((j) => j.repo.name), ['busy']);
      await ext.deactivate();
    }

    // 0.5.0: New Folder…, Move to Owner…, Forget; ⟳ rescans the workspace directories
    {
      const hN = path.join(t, 'hN');
      const wsN = path.join(hN, 'github');
      fs.mkdirSync(wsN, { recursive: true });
      const c = seed(ctx('storeN'), 'gannet.workspaces', [wsN]);
      opts.folders = [path.join(tmp, 'ws')];
      const ghRepos = [
        { full_name: 'seanahn/perch', owner: { login: 'seanahn' }, name: 'perch', clone_url: bare, html_url: 'https://github.com/seanahn/perch', default_branch: 'main' },
        { full_name: 'c3-e/hub', owner: { login: 'c3-e' }, name: 'hub', clone_url: bare, html_url: 'https://github.com/c3-e/hub', default_branch: 'main' },
      ];
      const fetchN = async (url) => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => (/\/user\/repos/.test(String(url)) ? ghRepos : []) });
      await ext.activateWith(c, { run, fetch: fetchN, home: hN });
      const st = ext._state();
      const nf = () => machine(c)['gannet.newFolders'] || [];
      const pickOwner = (name) => (items) => items.find((i) => i.label === name);

      // name checks in the input box (Review Focus 3); Escape at the name: nothing
      opts.inputBox = undefined;
      await vscode.commands.executeCommand('gannet.newFolder', { path: wsN });
      const box = rec.inputBoxes.at(-1);
      assert.ok(box.validateInput('..') && box.validateInput('a/b'), 'refused with a message');
      assert.ok(!box.validateInput('my thing'));
      fs.mkdirSync(path.join(wsN, 'old'));
      assert.strictEqual(box.validateInput('old'), 'old exists: it will be put under an owner');
      assert.deepStrictEqual(fs.readdirSync(wsN).sort(), ['old']);
      assert.deepStrictEqual(nf(), []);

      // Escape at the owner: nothing
      opts.inputBox = 'newthing';
      opts.quickPick = () => undefined;
      await vscode.commands.executeCommand('gannet.newFolder', { path: wsN });
      assert.ok(!fs.existsSync(path.join(wsN, 'newthing')));
      assert.deepStrictEqual(nf(), []);
      assert.deepStrictEqual(rec.quickPicks.at(-1).items.map((i) => [i.label, i.description]), [['c3-e', 'via seanahn'], ['c3-e', 'via vsuser'], ['seanahn', undefined], ['seanahn', 'via vsuser'], ['vsuser', undefined]], 'the owner rows the sidebar shows');

      // created, recorded before the window changes, added to the window
      opts.quickPick = pickOwner('c3-e');
      const update = vscode.workspace.updateWorkspaceFolders;
      let recordedFirst = null;
      vscode.workspace.updateWorkspaceFolders = (...a) => { recordedFirst = nf().some((r) => r.path === path.join(wsN, 'newthing')); return update(...a); };
      await vscode.commands.executeCommand('gannet.newFolder', { path: wsN });
      vscode.workspace.updateWorkspaceFolders = update;
      assert.ok(fs.statSync(path.join(wsN, 'newthing')).isDirectory());
      assert.deepStrictEqual(nf(), [{ path: path.join(wsN, 'newthing'), owner: 'c3-e', account: 'seanahn' }]);
      assert.strictEqual(recordedFirst, true, 'the record is written before the folder is added to the window');
      assert.ok(opts.folders.includes(path.join(wsN, 'newthing')), 'added to the window');

      // adopted: no mkdir; inside a window folder: not added again
      opts.folders = [hN];
      const ups = rec.folderUpdates.length;
      opts.inputBox = 'old';
      opts.quickPick = pickOwner('seanahn');
      await vscode.commands.executeCommand('gannet.newFolder', { path: wsN });
      assert.deepStrictEqual(nf().map((r) => [path.basename(r.path), r.owner]), [['newthing', 'c3-e'], ['old', 'seanahn']]);
      assert.strictEqual(rec.folderUpdates.length, ups);

      // already recorded, or already a GitHub clone: refused, nothing recorded
      const errs = () => rec.messages.filter((m) => m.level === 'error').length;
      let e0 = errs();
      await vscode.commands.executeCommand('gannet.newFolder', { path: wsN });
      assert.strictEqual(errs(), e0 + 1, 'already recorded');
      sh(`git clone -q "${bare}" cloned && git -C cloned remote set-url origin https://github.com/seanahn/perch.git`, wsN);
      opts.inputBox = 'cloned';
      e0 = errs();
      await vscode.commands.executeCommand('gannet.newFolder', { path: wsN });
      assert.strictEqual(errs(), e0 + 1, 'a GitHub clone');
      assert.strictEqual(nf().length, 2);

      // mkdir failing (the name taken by a file after the check): an error, nothing recorded
      opts.inputBox = (o) => { fs.writeFileSync(path.join(wsN, 'race'), 'x'); return 'race'; };
      opts.quickPick = pickOwner('c3-e');
      e0 = errs();
      await vscode.commands.executeCommand('gannet.newFolder', { path: wsN });
      assert.strictEqual(errs(), e0 + 1);
      assert.strictEqual(nf().length, 2);

      // Move to Owner… (picked, or dropped on a row) and Forget
      const node = { kind: 'newFolder', owner: 'c3-e', account: { login: 'seanahn' }, rec: nf()[0], pending: null };
      opts.quickPick = pickOwner('seanahn');
      await vscode.commands.executeCommand('gannet.moveNewFolder', node);
      assert.deepStrictEqual(nf()[0], { path: path.join(wsN, 'newthing'), owner: 'seanahn', account: 'seanahn' });
      const before = rec.quickPicks.length;
      await vscode.commands.executeCommand('gannet.moveNewFolder', node, { kind: 'owner', owner: 'c3-e', account: { login: 'seanahn' } });
      assert.strictEqual(rec.quickPicks.length, before, 'a drop asks nothing');
      assert.deepStrictEqual(nf()[0].owner, 'c3-e');
      await vscode.commands.executeCommand('gannet.forgetNewFolder', node);
      assert.deepStrictEqual(nf().map((r) => path.basename(r.path)), ['old']);
      assert.ok(fs.existsSync(path.join(wsN, 'newthing')), 'the folder stays');

      // Reveal and Add to Window work on its row
      await vscode.commands.executeCommand('gannet.revealLocal', { kind: 'newFolder', owner: 'seanahn', account: { login: 'seanahn' }, rec: nf()[0] });
      assert.strictEqual(rec.executed.at(-1).args[0].fsPath, path.join(wsN, 'old'));

      // in a remote window: inside a window folder, the Explorer; outside, no file manager to call, a message
      opts.remoteName = 'ssh-remote';
      opts.folders = [hN];
      await vscode.commands.executeCommand('gannet.revealLocal', { kind: 'newFolder', owner: 'seanahn', account: { login: 'seanahn' }, rec: nf()[0] });
      assert.deepStrictEqual([rec.executed.at(-1).id, rec.executed.at(-1).args[0].fsPath], ['revealInExplorer', path.join(wsN, 'old')]);
      opts.folders = [path.join(tmp, 'ws')];
      const nExec = rec.executed.length, nMsg = rec.messages.length;
      await vscode.commands.executeCommand('gannet.revealLocal', { kind: 'newFolder', owner: 'seanahn', account: { login: 'seanahn' }, rec: nf()[0] });
      assert.strictEqual(rec.executed.length, nExec + 1, 'no revealFileInOS in a remote window');
      assert.strictEqual(rec.messages.length, nMsg + 1);
      opts.remoteName = undefined;
      // ⟳ rescans: a clone made by hand after start is found
      sh(`git clone -q "${bare}" later && git -C later remote set-url origin https://github.com/seanahn/later.git`, wsN);
      assert.strictEqual(st.local.checkoutsOf('seanahn/later').length, 0);
      await vscode.commands.executeCommand('gannet.refresh');
      assert.strictEqual(st.local.checkoutsOf('seanahn/later').length, 1);
      opts.inputBox = undefined; opts.quickPick = undefined; opts.folders = [path.join(tmp, 'ws')];
      await ext.deactivate();
    }

    // the commands the manifest lists are the ones registered; 0.2.0's workspace-file commands are gone
    for (const id of ['gannet.openWorkspace', 'gannet.openWorkspaceHere', 'gannet.setRepoFolder']) {
      assert.ok(!manifest.contributes.commands.some((c) => c.command === id), id);
      assert.ok(!rec.commands.has(id), id);
    }
    assert.ok(!('dependencies' in manifest) || !manifest.dependencies['jsonc-parser']);
    assert.ok(!manifest.contributes.configuration.properties['gannet.checkoutFolder'], 'retired');
    // 0.4.0: one webview view; right-click menus on its rows; title buttons on it
    assert.deepStrictEqual(manifest.contributes.views.gannet, [{ type: 'webview', id: 'gannet.main', name: '' }]);
    assert.ok(!('view/item/context' in manifest.contributes.menus));
    assert.ok(manifest.contributes.menus['webview/context'].length > 0);
    for (const m of manifest.contributes.menus['webview/context']) assert.ok(m.when.startsWith("webviewId == 'gannet.main' && webviewSection == 'row'"), m.when);
    for (const m of manifest.contributes.menus['view/title']) assert.strictEqual(m.when, 'view == gannet.main');
    // 0.5.0: the new-folder commands, hidden from the palette, on the newfolder row
    for (const id of ['gannet.newFolder', 'gannet.moveNewFolder', 'gannet.forgetNewFolder']) {
      assert.ok(manifest.contributes.commands.some((cm) => cm.command === id), id);
      assert.strictEqual(manifest.contributes.menus.commandPalette.find((m) => m.command === id).when, 'false', id);
    }
    const wctx = manifest.contributes.menus['webview/context'];
    for (const id of ['gannet.moveNewFolder', 'gannet.forgetNewFolder', 'gannet.revealLocal', 'gannet.addToWorkspace']) {
      assert.ok(wctx.some((m) => m.command === id && /newfolder/.test(m.when)), id + ' on a new folder');
    }
    for (const id of ['gannet.revealWorkspace', 'gannet.removeWorkspace']) {
      assert.ok(manifest.contributes.menus.commandPalette.some((c) => c.command === id && c.when === 'false'), id);
    }
    assert.ok(!fs.existsSync(path.join(__dirname, '..', 'src', 'workspaceTree.js')));

    // where 0.1.0 kept repos in globalState, those still on disk carry over, with their push account
    {
      const old = path.join(ghB, 'roost');
      const c6 = { globalState: makeMemento({ 'gannet.local': { 'seanahn/roost': { path: old, login: 'seanahn', byGannet: true }, 'x/gone': { path: path.join(t, 'nowhere'), login: 'x', byGannet: true } } }), subscriptions: [], globalStorageUri: Uri.file(path.join(t, 'store-m')), extensionPath: path.join(__dirname, '..') };
      await ext.activateWith(c6, { run, fetch, home: hB });
      assert.strictEqual(ext._state().local.checkoutsOf('seanahn/roost')[0].login, 'seanahn');
      assert.deepStrictEqual(ext._state().local.checkoutsOf('x/gone'), []);
      await ext.deactivate();
    }
    console.log('HOST OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); });
