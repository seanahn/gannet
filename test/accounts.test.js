'use strict';
// Accounts from two places: every account the gh CLI is logged into, and VS Code's GitHub sign-ins.
const assert = require('assert');
const { fakeRun, fakeVscode } = require('./stubs.js');
const { createAccounts } = require('../src/accounts.js');

const STATUS = 'github.com\n  ✓ Logged in to github.com account c3-sahn (/home/x/.config/gh/hosts.yml)\n  - Active account: true\n\n  ✓ Logged in to github.com account seanahn (keyring)\n  - Active account: false\n';
async function rejects(p) { try { await p; } catch (e) { return e; } throw new Error('expected a rejection'); }

(async () => {
  // both sources merged, a login in both listed once as gh, hidden ones left out, sorted
  {
    const vscode = fakeVscode({ accounts: [{ id: '1', label: 'seanahn' }, { id: '2', label: 'alice' }, { id: '3', label: 'zed' }], tokens: { seanahn: 'vs-sean', alice: 'vs-alice', zed: 'vs-zed' } });
    const run = fakeRun({ 'gh auth status --hostname github.com': { stdout: '', stderr: STATUS } });   // older gh prints to stderr
    const accounts = createAccounts({ vscode, run, hidden: () => ['zed'] });
    assert.deepStrictEqual(await accounts.list(), [{ login: 'alice', source: 'vscode' }, { login: 'c3-sahn', source: 'gh' }, { login: 'seanahn', source: 'gh' }]);
  }
  // gh missing: only VS Code's accounts, no error
  {
    const vscode = fakeVscode({ accounts: [{ id: '2', label: 'alice' }], tokens: { alice: 'vs-alice' } });
    const enoent = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
    const accounts = createAccounts({ vscode, run: fakeRun({ 'gh auth status --hostname github.com': enoent }), hidden: () => [] });
    assert.deepStrictEqual(await accounts.list(), [{ login: 'alice', source: 'vscode' }]);
  }
  // a gh token is read once, kept in memory, and read again after forget
  {
    const vscode = fakeVscode();
    const run = fakeRun({ 'gh auth status --hostname github.com': { stdout: STATUS }, 'gh auth token --hostname github.com --user seanahn': { stdout: 'gho_sean\n' } });
    const accounts = createAccounts({ vscode, run, hidden: () => [] });
    await accounts.list();
    assert.strictEqual(await accounts.token('seanahn'), 'gho_sean');
    assert.strictEqual(await accounts.token('seanahn'), 'gho_sean');
    assert.strictEqual(run.calls.filter((c) => c.startsWith('gh auth token')).length, 1);
    accounts.forget('seanahn');
    await accounts.token('seanahn');
    assert.strictEqual(run.calls.filter((c) => c.startsWith('gh auth token')).length, 2);
  }
  // a gh token that cannot be read: an 'auth' error that does not show any token
  {
    const vscode = fakeVscode();
    const run = fakeRun({ 'gh auth status --hostname github.com': { stdout: STATUS }, 'gh auth token --hostname github.com --user c3-sahn': { code: 1, stderr: 'no oauth token found for github.com account c3-sahn' } });
    const accounts = createAccounts({ vscode, run, hidden: () => [] });
    await accounts.list();
    const e = await rejects(accounts.token('c3-sahn'));
    assert.strictEqual(e.kind, 'auth');
    assert.ok(/c3-sahn/.test(e.message), e.message);
  }
  // a VS Code token comes from that account's own session, silently
  {
    const vscode = fakeVscode({ accounts: [{ id: '1', label: 'bob' }, { id: '2', label: 'alice' }], tokens: { bob: 'vs-bob', alice: 'vs-alice' } });
    const accounts = createAccounts({ vscode, run: fakeRun({}), hidden: () => [] });
    await accounts.list();
    assert.strictEqual(await accounts.token('alice'), 'vs-alice');
    const call = vscode._rec.sessionCalls.at(-1);
    assert.strictEqual(call.opts.account.label, 'alice');
    assert.strictEqual(call.opts.silent, true);
    assert.deepStrictEqual(call.scopes, ['repo']);
    delete vscode.tokens.alice;   // signed out in VS Code
    accounts.forget('alice');
    assert.strictEqual((await rejects(accounts.token('alice'))).kind, 'auth');
  }
  // adding an account runs VS Code's sign-in with the account picker, and the change is announced
  {
    const vscode = fakeVscode({ addAccount: { id: '9', label: 'carol' } });
    const accounts = createAccounts({ vscode, run: fakeRun({}), hidden: () => [] });
    let changed = 0;
    accounts.onDidChange(() => changed++);
    assert.deepStrictEqual(await accounts.addVsCodeAccount(), { login: 'carol', source: 'vscode' });
    const call = vscode._rec.sessionCalls.at(-1);
    assert.strictEqual(call.opts.createIfNone, true);
    assert.strictEqual(call.opts.clearSessionPreference, true);
    vscode._sessionsChanged.fire({ provider: { id: 'github' } });
    vscode._sessionsChanged.fire({ provider: { id: 'microsoft' } });
    assert.strictEqual(changed, 1);
    assert.deepStrictEqual(await accounts.list(), [{ login: 'carol', source: 'vscode' }]);
  }
  // review fixes: a gh account whose token gh cannot use is still listed (it shows signed out); forgetAll
  {
    const status = 'github.com\n  X Failed to log in to github.com account c3-sahn (keyring)\n  - Active account: true\n  - The token in keyring is invalid.\n  ✓ Logged in to github.com account seanahn (keyring)\n';
    const run = fakeRun({ 'gh auth status --hostname github.com': { code: 1, stdout: status }, 'gh auth token --hostname github.com --user seanahn': { stdout: 't\n' } });
    const accounts = createAccounts({ vscode: fakeVscode(), run, hidden: () => [] });
    assert.deepStrictEqual((await accounts.list()).map((a) => a.login), ['c3-sahn', 'seanahn']);
    await accounts.token('seanahn');
    accounts.forgetAll();
    await accounts.token('seanahn');
    assert.strictEqual(run.calls.filter((c) => c.startsWith('gh auth token')).length, 2);
  }
  console.log('ACCOUNTS OK');
})().catch((e) => { console.error(e); process.exit(1); });
