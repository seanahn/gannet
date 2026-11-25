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
    await vscode.commands.executeCommand('gannet.checkoutTo', { kind: 'repo', account, repo: { ...repo, fullName: 'seanahn/roost', name: 'roost' } });
    assert.ok(fs.existsSync(path.join(tmp, 'picked', 'roost', 'a.txt')));
    const refused = rec.messages.at(-1);
    assert.ok(refused.items.includes('Add to workspace'), JSON.stringify(refused));
    opts.refuseFolders = false;

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
      const context2 = { globalState: makeMemento({ 'gannet.pending': [{ repo: { ...repo, fullName: 'seanahn/later', name: 'later' }, account: { login: 'vsuser', source: 'vscode' }, folder: path.join(tmp, 'resumed') }] }), subscriptions: [], globalStorageUri: Uri.file(path.join(tmp, 'store2')), extensionPath: path.join(__dirname, '..') };
      vscode.accounts.push({ id: 'v', label: 'vsuser' });
      vscode.tokens.vsuser = 'vs-token';
      await ext.activateWith(context2, { run, fetch, home, startServer: async () => { throw new Error('no sockets here'); } });
      await ext._state().resumed;
      const later = path.join(tmp, 'resumed', 'later');
      assert.ok(fs.existsSync(path.join(later, 'a.txt')), 'resumed');
      assert.deepStrictEqual(context2.globalState.get('gannet.pending'), [], 'and no longer pending');
      const helpers = (() => { try { return sh('git config --local --get-all credential.https://github.com.helper', later); } catch { return ''; } })();
      assert.strictEqual(helpers, '', 'no helper written when it cannot work');
      assert.strictEqual(ext._state().local.get('seanahn/later').login, null, 'so the tree offers Push as later');
      assert.ok(rec.messages.some((m) => /cannot push as vsuser/.test(m.msg)), JSON.stringify(rec.messages.map((m) => m.msg)));
      await ext.deactivate();
    }
    console.log('HOST OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); });
