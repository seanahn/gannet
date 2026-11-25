'use strict';
// Live, against GitHub with gh's real logins: listing, browsing, reading, and a checkout that pushes as its account.
// Skipped when gh has no account. Never prints a token.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { fakeVscode, makeMemento } = require('./stubs.js');
const { createClient } = require('../src/github.js');
const { createAccounts, runProcess } = require('../src/accounts.js');
const { createLocalRepos } = require('../src/localRepos.js');
const { createCheckout, ghHelper } = require('../src/checkout.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gannet-live-'));

(async () => {
  try {
    const accounts = createAccounts({ vscode: fakeVscode(), run: runProcess, hidden: () => [] });
    const list = (await accounts.list()).filter((a) => a.source === 'gh');
    if (!list.length) { console.log('LIVE SKIPPED (gh has no github.com account)'); return; }
    const client = (login) => createClient({ fetch: globalThis.fetch, token: () => accounts.token(login) });

    for (const a of list) {
      const repos = await client(a.login).listRepos({ sort: 'pushed', max: 10 });
      assert.ok(repos.length >= 1, `${a.login} lists repos`);
      assert.ok(repos.length <= 10);
    }

    // browsing and reading a public repo
    const gh = client(list[0].login);
    const { entries } = await gh.listDir('seanahn', 'perch', '');
    assert.ok(entries.some((e) => e.name === 'package.json' && e.type === 'file'));
    const pkg = JSON.parse(new TextDecoder().decode(await gh.readFile('seanahn', 'perch', 'package.json')));
    assert.strictEqual(pkg.name, 'perch');

    // a checkout whose own git settings answer for its account
    const account = list.find((a) => a.login === 'seanahn') || list[0];
    const local = createLocalRepos({ memento: makeMemento(), home: tmp });
    const co = createCheckout({ run: runProcess, local, accounts, helperCommand: (a) => ghHelper(a.login), home: tmp });
    const repo = { fullName: 'seanahn/perch', owner: 'seanahn', name: 'perch', cloneUrl: 'https://github.com/seanahn/perch.git', defaultBranch: 'main' };
    const res = await co.checkout({ repo, account, folder: path.join(tmp, 'github') });
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    const lsRemote = spawnSync('git', ['-C', res.path, 'ls-remote', 'origin', 'HEAD'], { env });
    assert.strictEqual(lsRemote.status, 0, String(lsRemote.stderr));
    const fill = spawnSync('git', ['-C', res.path, 'credential', 'fill'], { env, input: 'protocol=https\nhost=github.com\n\n' });
    assert.strictEqual(fill.status, 0, 'the repo\'s helper answered');
    const answer = String(fill.stdout);
    assert.ok(answer.includes(`username=${account.login}\n`), 'as the account it came from');
    assert.ok(/password=\S{20,}/.test(answer), 'with a token');
    const config = fs.readFileSync(path.join(res.path, '.git', 'config'), 'utf8');
    const token = await accounts.token(account.login);
    assert.ok(!config.includes(token), 'no token in .git/config');
    console.log('LIVE OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch((e) => { console.error(String(e && e.message || e)); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); });
