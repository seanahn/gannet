'use strict';
// Checking a repo out: where it goes, the clone itself (one at a time, cancellable, never leaving a half folder),
// and the repo's own git settings that make it push as the account it came from.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { EventEmitter } = require('events');
const { makeMemento } = require('./stubs.js');
const { createLocalRepos, originOf } = require('../src/localRepos.js');
const { runProcess } = require('../src/accounts.js');
const { chooseTarget, createCheckout, pushConfigArgs, ghHelper } = require('../src/checkout.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gannet-checkout-'));
const sh = (cmd, cwd) => childProcess.execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString();
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const TOKEN = 'gho_secret';
const B64 = Buffer.from('x-access-token:' + TOKEN).toString('base64');
async function rejects(p) { try { await p; } catch (e) { return e; } throw new Error('expected a rejection'); }

(async () => {
  try {
    // a bare repo with one commit, standing in for GitHub
    const src = path.join(tmp, 'src');
    fs.mkdirSync(src);
    sh('git init -q -b main && echo hi > a.txt && git add a.txt && git commit -qm one', src);
    const bare = path.join(tmp, 'perch.git');
    sh(`git clone -q --bare "${src}" "${bare}"`, tmp);
    const repo = { fullName: 'seanahn/perch', owner: 'seanahn', name: 'perch', cloneUrl: bare, defaultBranch: 'main' };

    // where it goes
    {
      const folder = path.join(tmp, 'choose');
      fs.mkdirSync(path.join(folder, 'perch'), { recursive: true });
      const origin = (map) => (p) => map[p] || '';
      assert.deepStrictEqual(chooseTarget(path.join(tmp, 'empty'), repo, { isDir, originOf: origin({}) }), { path: path.join(tmp, 'empty', 'perch'), existing: false });
      assert.deepStrictEqual(chooseTarget(folder, repo, { isDir, originOf: origin({ [path.join(folder, 'perch')]: 'git@github.com:seanahn/perch.git' }) }), { path: path.join(folder, 'perch'), existing: true });
      assert.deepStrictEqual(chooseTarget(folder, repo, { isDir, originOf: origin({ [path.join(folder, 'perch')]: 'git@github.com:SeanAhn/Perch.git' }) }), { path: path.join(folder, 'perch'), existing: true }, 'GitHub names ignore case');
      assert.deepStrictEqual(chooseTarget(folder, repo, { isDir, originOf: origin({ [path.join(folder, 'perch')]: 'git@github.com:other/perch.git' }) }), { path: path.join(folder, 'seanahn-perch'), existing: false });
      fs.mkdirSync(path.join(folder, 'seanahn-perch'));
      assert.deepStrictEqual(chooseTarget(folder, repo, { isDir, originOf: origin({}) }), { ask: true });
    }

    // the push settings
    assert.deepStrictEqual(pushConfigArgs('seanahn', 'HELPER'), [
      ['config', '--local', 'credential.https://github.com.helper', ''],
      ['config', '--local', '--add', 'credential.https://github.com.helper', 'HELPER'],
      ['config', '--local', 'credential.https://github.com.username', 'seanahn'],
    ]);
    assert.strictEqual(ghHelper('seanahn'), '!f() { test "$1" = get || exit 0; echo username=seanahn; echo password=$(gh auth token --hostname github.com --user seanahn); }; f');

    const home = path.join(tmp, 'home');
    const make = (spawn, memento = makeMemento()) => {
      const local = createLocalRepos({ memento, home });
      const accounts = { token: async (login) => { if (login === 'nobody') { const e = new Error('nobody is signed out'); e.kind = 'auth'; throw e; } return TOKEN; } };
      const co = createCheckout({ run: runProcess, spawn, local, accounts, home, helperCommand: (a) => 'HELPER-' + a.login });
      return { co, local };
    };
    const recordSpawn = () => { const calls = [], envs = []; const f = (cmd, args, o) => { calls.push(args); envs.push(o.env); return childProcess.spawn(cmd, args, o); }; f.calls = calls; f.envs = envs; return f; };

    // a real clone: into the folder (created under ~), renamed from the partial, push settings written, remembered
    {
      const spawn = recordSpawn();
      const { co, local } = make(spawn);
      const res = await co.checkout({ repo, account: { login: 'seanahn', source: 'gh' }, folder: '~/github' });
      const target = path.join(home, 'github', 'perch');
      assert.deepStrictEqual(res, { path: target, existing: false });
      assert.ok(fs.existsSync(path.join(target, 'a.txt')));
      assert.ok(!fs.readdirSync(path.dirname(target)).some((n) => n.includes('gannet-partial')));
      const config = fs.readFileSync(path.join(target, '.git', 'config'), 'utf8');
      assert.ok(!config.includes(TOKEN) && !config.includes(B64), 'no token in .git/config');
      assert.strictEqual(originOf(target), bare, 'remote is the plain URL');
      const helpers = sh('git config --local --get-all credential.https://github.com.helper', target).split('\n');
      assert.deepStrictEqual(helpers.slice(0, 2), ['', 'HELPER-seanahn']);
      assert.strictEqual(sh('git config --local credential.https://github.com.username', target).trim(), 'seanahn');
      assert.deepStrictEqual(local.get('seanahn/perch'), { path: target, login: 'seanahn', byGannet: true });
      // the sign-in travels in git's environment, scoped to github.com, never on the command line (review fix)
      const args = spawn.calls[0];
      assert.ok(!args.join(' ').includes(B64) && !args.join(' ').includes(TOKEN), args.join(' '));
      const env = spawn.envs[0];
      const n = Number(env.GIT_CONFIG_COUNT);
      const pairs = Array.from({ length: n }, (_, i) => [env['GIT_CONFIG_KEY_' + i], env['GIT_CONFIG_VALUE_' + i]]);
      assert.ok(pairs.some(([k, v]) => k === 'http.https://github.com/.extraHeader' && v === 'Authorization: Basic ' + B64), JSON.stringify(pairs.map(([k]) => k)));
      assert.ok(pairs.some(([k, v]) => k === 'credential.helper' && v === ''), 'no fallback to the machine\'s own sign-in');
      assert.strictEqual(args.at(-1), target + '.gannet-partial-' + process.pid);

      // Push as twice over: the second run replaces the settings instead of failing (review fix)
      const { configurePush } = require('../src/checkout.js');
      await configurePush(runProcess, target, 'c3-sahn', 'HELPER-2');
      assert.deepStrictEqual(sh('git config --local --get-all credential.https://github.com.helper', target).split('\n').slice(0, 2), ['', 'HELPER-2']);
      assert.strictEqual(sh('git config --local credential.https://github.com.username', target).trim(), 'c3-sahn');
      await configurePush(runProcess, target, 'seanahn', 'HELPER-seanahn');

      // the same repo from a second account: nothing cloned, its push account kept (Review Focus 5)
      const again = await co.checkout({ repo, account: { login: 'c3-sahn', source: 'gh' }, folder: '~/github' });
      assert.deepStrictEqual(again, { path: target, existing: true });
      assert.strictEqual(spawn.calls.length, 1);
      assert.strictEqual(local.get('seanahn/perch').login, 'seanahn');
    }

    // a repo already sitting in the folder, cloned by hand: remembered, not cloned, no account given to it
    {
      const folder = path.join(tmp, 'byhand');
      sh(`git clone -q "${bare}" perch && git -C perch remote set-url origin https://github.com/seanahn/perch.git`, (fs.mkdirSync(folder), folder));
      const spawn = recordSpawn();
      const { co, local } = make(spawn);
      assert.deepStrictEqual(await co.checkout({ repo, account: { login: 'seanahn', source: 'gh' }, folder }), { path: path.join(folder, 'perch'), existing: true });
      assert.strictEqual(spawn.calls.length, 0);
      assert.deepStrictEqual(local.get('seanahn/perch'), { path: path.join(folder, 'perch'), login: null, byGannet: false });
    }

    // no token: stops before git runs
    {
      const spawn = recordSpawn();
      const { co } = make(spawn);
      const e = await rejects(co.checkout({ repo, account: { login: 'nobody', source: 'gh' }, folder: path.join(tmp, 'notoken') }));
      assert.strictEqual(e.kind, 'auth');
      assert.strictEqual(spawn.calls.length, 0);
    }

    // git fails: its error line without the token, the partial folder gone
    {
      const { co } = make(recordSpawn());
      const folder = path.join(tmp, 'bad');
      const e = await rejects(co.checkout({ repo: { ...repo, cloneUrl: path.join(tmp, 'missing.git') }, account: { login: 'seanahn', source: 'gh' }, folder }));
      assert.ok(e.message && !e.message.includes(B64) && !e.message.includes(TOKEN), e.message);
      assert.ok(/does not exist|not found|fatal/i.test(e.message), e.message);
      assert.ok(!fs.readdirSync(folder).some((n) => n.includes('gannet-partial')));
      assert.ok(!fs.existsSync(path.join(folder, 'perch')));
    }

    // cancel: git killed, partial gone, 'cancelled'; and a second checkout waits for the first
    {
      const children = [];
      const slowSpawn = (cmd, args) => {
        const child = new EventEmitter();
        child.stderr = new EventEmitter(); child.stdout = new EventEmitter();
        child.args = args;
        child.killed = false;
        child.kill = () => { child.killed = true; setImmediate(() => child.emit('close', null, 'SIGTERM')); };
        child.finish = () => { fs.mkdirSync(args.at(-1), { recursive: true }); fs.mkdirSync(path.join(args.at(-1), '.git')); child.emit('close', 0); };
        fs.mkdirSync(args.at(-1), { recursive: true });   // git starts filling the partial folder
        children.push(child);
        return child;
      };
      const quietRun = async () => ({ code: 0, stdout: '', stderr: '' });
      const memento = makeMemento();
      const local = createLocalRepos({ memento, home });
      const co = createCheckout({ run: quietRun, spawn: slowSpawn, local, accounts: { token: async () => TOKEN }, home, helperCommand: () => 'H' });
      const folder = path.join(tmp, 'queue');
      const cancel = new EventEmitter();
      const token = { isCancellationRequested: false, onCancellationRequested: (fn) => { cancel.on('c', fn); return { dispose() {} }; } };
      const first = co.checkout({ repo, account: { login: 'seanahn' }, folder, token });
      const second = co.checkout({ repo: { ...repo, fullName: 'seanahn/roost', name: 'roost' }, account: { login: 'seanahn' }, folder });
      await new Promise((r) => setTimeout(r, 50));
      assert.strictEqual(children.length, 1, 'the second waits');
      token.isCancellationRequested = true; cancel.emit('c');
      const e = await rejects(first);
      assert.strictEqual(e.message, 'cancelled');
      assert.ok(children[0].killed);
      assert.ok(!fs.readdirSync(folder).some((n) => n.startsWith('perch.gannet-partial')));
      await new Promise((r) => setTimeout(r, 50));
      assert.strictEqual(children.length, 2, 'then the second starts');
      children[1].finish();
      assert.deepStrictEqual(await second, { path: path.join(folder, 'roost'), existing: false });
    }
    console.log('CHECKOUT OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); });
