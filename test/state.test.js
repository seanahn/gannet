'use strict';
// What Gannet remembers: the repos used recently per account, and where repos are checked out on this machine.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeMemento } = require('./stubs.js');
const { createRecent } = require('../src/recent.js');
const { createLocalRepos, parseOrigin } = require('../src/localRepos.js');

const repo = (fullName) => ({ fullName, owner: fullName.split('/')[0], name: fullName.split('/')[1] });

// Recent: used ones first, most recent first, topped up from GitHub's pushed list, no duplicates, at most 10
{
  const memento = makeMemento();
  const recent = createRecent(memento);
  recent.touch('sean', 'a/one');
  recent.touch('sean', 'a/two');
  recent.touch('sean', 'a/gone');
  recent.touch('sean', 'a/one');   // used again: back to the front
  const pushed = ['p/1', 'a/two', 'p/2', 'p/3', 'p/4', 'p/5', 'p/6', 'p/7', 'p/8', 'p/9', 'p/10'].map(repo);
  const known = new Map([['a/one', repo('a/one')]]);
  const merged = recent.merge('sean', pushed, known);
  assert.deepStrictEqual(merged.map((r) => r.fullName), ['a/one', 'a/two', 'p/1', 'p/2', 'p/3', 'p/4', 'p/5', 'p/6', 'p/7', 'p/8'], 'a/gone is no longer listed by GitHub');
  assert.deepStrictEqual(recent.merge('other', pushed.slice(0, 2), new Map()).map((r) => r.fullName), ['p/1', 'a/two'], 'per account');
  for (let i = 0; i < 60; i++) recent.touch('sean', 'x/' + i);
  assert.strictEqual(memento.get('gannet.recent').sean.length, 50, 'keeps 50, so each owner has its own used repos');
  recent.forgetRepo('sean', 'x/14');
  assert.ok(!memento.get('gannet.recent').sean.includes('x/14'));
}

// 0.3.0: Recent per owner — the filter applies before the limit of 10
{
  const recent = createRecent(makeMemento());
  const pushed = Array.from({ length: 12 }, (_, i) => repo((i % 2 ? 'b' : 'a') + '/r' + i));
  assert.strictEqual(recent.merge('l', pushed, new Map(), (r) => r.owner === 'a').length, 6);
  recent.touch('l', 'c/first');
  for (let i = 0; i < 11; i++) recent.touch('l', 'd/' + i);
  const known = new Map([['c/first', repo('c/first')]]);
  assert.deepStrictEqual(recent.merge('l', [], known, (r) => r.owner === 'c').map((r) => r.fullName), ['c/first'], 'an owner\'s used repo survives 11 others');
}

// 0.5.6: checkouts on this machine come after the used ones and before GitHub's pushed order (Sean: "i have been
// mostly working on c3securitytools repo. why doesn't it show up as recent?"), most recently worked on first
{
  const recent = createRecent(makeMemento());
  recent.touch('l', 'a/used');
  const pushed = ['a/p1', 'a/p2', 'a/sec', 'a/p3', 'a/p4', 'a/p5', 'a/p6', 'a/p7', 'a/p8', 'a/p9', 'a/p10'].map(repo);
  const known = new Map([['a/used', repo('a/used')], ['a/old', repo('a/old')]]);
  const local = ['A/SEC', 'a/old', 'a/unlisted', 'b/other'];   // any case; GitHub's spelling is shown
  assert.deepStrictEqual(recent.merge('l', pushed, known, (r) => r.owner === 'a', local).map((r) => r.fullName),
    ['a/used', 'a/sec', 'a/old', 'a/p1', 'a/p2', 'a/p3', 'a/p4', 'a/p5', 'a/p6', 'a/p7']);
  assert.strictEqual(recent.merge('l', pushed, known).length, 10, 'no local list: as before');
}

// 0.5.7: Remove from Recent keeps a repo out (used, local and pushed alike) until it is used in Gannet again
{
  const recent = createRecent(makeMemento());
  const pushed = ['a/p1', 'a/p2', 'a/sec'].map(repo);
  recent.touch('l', 'a/p2');
  recent.drop('l', 'a/p2');
  recent.drop('l', 'A/SEC');
  const names = (login) => recent.merge(login, pushed, new Map(), () => true, ['a/sec']).map((r) => r.fullName);
  assert.deepStrictEqual(names('l'), ['a/p1'], 'out of every source, any case');
  assert.deepStrictEqual(names('other'), ['a/sec', 'a/p1', 'a/p2'], 'per account');
  recent.touch('l', 'a/sec');
  assert.deepStrictEqual(names('l'), ['a/sec', 'a/p1'], 'used again: back, at the top');
}

// a checkout's last work: the newest of .git/logs/HEAD and .git/index; byActivity orders this machine's checkouts
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gannet-act-'));
  try {
    const mk = (name, logs, index) => {
      const p = path.join(tmp, name);
      fs.mkdirSync(path.join(p, '.git', 'logs'), { recursive: true });
      const at = (f, t) => { fs.writeFileSync(f, 'x'); fs.utimesSync(f, t, t); };
      if (logs) at(path.join(p, '.git', 'logs', 'HEAD'), logs);
      if (index) at(path.join(p, '.git', 'index'), index);
      return p;
    };
    const day = 86400;
    const now = Date.now() / 1000;
    const a = mk('a', now - 5 * day, now - 4 * day);   // index newer than logs: 4 days
    const b = mk('b', now - 1 * day, null);            // a commit yesterday
    const c = mk('c', null, null);                      // nothing yet: last
    const wt = path.join(tmp, 'wt');                    // a worktree: .git is a file naming the real one
    const real = mk('realgit', now - 2 * day, null);
    fs.mkdirSync(wt); fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(real, '.git')}\n`);
    const local = createLocalRepos({ memento: makeMemento(), home: tmp });
    await_(local.remember('o/a', { path: a }));
    await_(local.remember('o/b', { path: b }));
    await_(local.remember('o/c', { path: c }));
    await_(local.remember('o/wt', { path: wt }));
    await_(local.remember('o/gone', { path: path.join(tmp, 'gone') }));
    assert.deepStrictEqual(local.byActivity(), ['o/b', 'o/wt', 'o/a', 'o/c'], 'gone checkouts left out');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
function await_() { /* memento updates are synchronous in the fake */ }

// the repo list cache: one file per account in Gannet's storage folder
{
  const { createRepoCache } = require('../src/repoCache.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gannet-cache-'));
  try {
    createRepoCache(dir).set('seanahn', [repo('seanahn/perch')]);
    const got = createRepoCache(dir).get('seanahn');
    assert.deepStrictEqual(got.repos, [repo('seanahn/perch')]);
    assert.ok(!Number.isNaN(Date.parse(got.fetchedAt)), got.fetchedAt);
    assert.ok(fs.existsSync(path.join(dir, 'repos-seanahn.json')));
    assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith('.tmp')), 'no temp file left');
    assert.strictEqual(createRepoCache(dir).get('nobody'), undefined);
    // Review Focus 3: a half-written file reads as absent
    fs.writeFileSync(path.join(dir, 'repos-half.json'), '{"repos": [');
    assert.strictEqual(createRepoCache(dir).get('half'), undefined);
    fs.writeFileSync(path.join(dir, 'repos-odd.json'), '{"repos": 5}');
    assert.strictEqual(createRepoCache(dir).get('odd'), undefined);
    createRepoCache(dir).forget('seanahn');
    assert.ok(!fs.existsSync(path.join(dir, 'repos-seanahn.json')));
    createRepoCache(dir).forget('seanahn');   // twice is fine
    createRepoCache(path.join(dir, 'new', 'deep')).set('x', []);   // the folder is made
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// origin URLs
{
  assert.strictEqual(parseOrigin('https://github.com/SeanAhn/Perch.git'), 'SeanAhn/Perch');
  assert.strictEqual(parseOrigin('https://github.com/o/r'), 'o/r');
  assert.strictEqual(parseOrigin('git@github.com:o/r.git'), 'o/r');
  assert.strictEqual(parseOrigin('ssh://git@github.com/o/r'), 'o/r');
  assert.strictEqual(parseOrigin('https://gitlab.com/o/r.git'), null);
  assert.strictEqual(parseOrigin(''), null);
}

// Local repos: scan, forget missing, clean partials, ~ expansion
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gannet-state-'));
(async () => {
try {
  const home = path.join(tmp, 'home');
  const folder = path.join(home, 'github');
  const mkRepo = (dir, url) => {
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.git', 'config'), `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`);
  };
  mkRepo(path.join(folder, 'perch'), 'git@github.com:seanahn/perch.git');
  fs.mkdirSync(path.join(folder, 'notes'), { recursive: true });   // not a git repo
  mkRepo(path.join(folder, 'other'), 'https://gitlab.com/x/y.git');
  // partials carry the pid of the window cloning them: a dead one's is removed, a live one's is left alone (review fix)
  fs.mkdirSync(path.join(folder, 'half.gannet-partial-999999999'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'half.gannet-partial-999999999', 'f'), 'x');
  fs.mkdirSync(path.join(folder, 'busy.gannet-partial-' + process.pid), { recursive: true });
  fs.mkdirSync(path.join(folder, 'old.gannet-partial'), { recursive: true });

  const memento = makeMemento();
  const local = createLocalRepos({ memento, home });
  const paths = (n) => local.checkoutsOf(n).map((c) => c.path);
  local.remember('seanahn/roost', { path: path.join(folder, 'roost-deleted'), login: 'seanahn', byGannet: true });
  local.remember('seanahn/kept', { path: path.join(folder, 'perch'), login: 'seanahn', byGannet: true });
  local.scan('~/github');
  assert.deepStrictEqual(local.checkoutsOf('seanahn/perch'), [{ path: path.join(folder, 'perch'), login: null, byGannet: false }]);
  assert.deepStrictEqual(local.checkoutsOf('x/y'), [], 'not a github origin');
  assert.deepStrictEqual(local.checkoutsOf('seanahn/roost'), [], 'a checkout gone from disk is not listed');
  local.forgetMissing();
  assert.ok(!('seanahn/roost' in memento.get('gannet.local')), 'deleted from disk: forgotten');
  assert.strictEqual(local.checkoutsOf('seanahn/kept').length, 1, 'still on disk: kept');
  local.remember('seanahn/perch', { path: path.join(folder, 'perch'), login: 'seanahn', byGannet: true });
  local.scan(folder);
  assert.deepStrictEqual(local.checkoutsOf('seanahn/perch').map((c) => c.login), ['seanahn'], 'scan does not overwrite or repeat what is known');
  local.cleanPartials('~/github');
  assert.ok(!fs.existsSync(path.join(folder, 'half.gannet-partial-999999999')));
  assert.ok(!fs.existsSync(path.join(folder, 'old.gannet-partial')));
  assert.ok(fs.existsSync(path.join(folder, 'busy.gannet-partial-' + process.pid)), 'another window is still cloning');
  // GitHub names ignore case (review fix)
  assert.deepStrictEqual(paths('SeanAhn/Perch'), [path.join(folder, 'perch')]);
  assert.ok(fs.existsSync(path.join(folder, 'notes')));
  assert.ok(local.all() instanceof Map && Array.isArray(local.all().get('seanahn/perch')));
  assert.strictEqual(memento.get('gannet.local')['seanahn/perch'][0].login, 'seanahn', 'stored in the memento');
  local.scan(path.join(tmp, 'nowhere'));   // a missing folder scans as empty
  local.cleanPartials(path.join(tmp, 'nowhere'));

  // 0.3.0: several checkouts of one repo
  {
    const A = path.join(tmp, 'a', 'r'), B = path.join(tmp, 'b', 'r');
    fs.mkdirSync(A, { recursive: true }); fs.mkdirSync(B, { recursive: true });
    const m = makeMemento();
    const l = createLocalRepos({ memento: m, home });
    await l.remember('o/r', { path: A });
    await l.remember('o/r', { path: B });
    assert.deepStrictEqual(l.checkoutsOf('O/R').map((c) => c.path), [A, B]);
    await l.remember('o/r', { path: A, login: 'x', byGannet: true });
    assert.deepStrictEqual(l.checkoutsOf('o/r'), [{ path: A, login: 'x', byGannet: true }, { path: B, login: null, byGannet: false }], 'the same path is replaced in place');
    // Review Focus 1: one of two deleted from disk
    fs.rmSync(B, { recursive: true });
    assert.deepStrictEqual(l.checkoutsOf('o/r').map((c) => c.path), [A]);
    await l.forgetMissing();
    assert.deepStrictEqual(m.get('gannet.local')['o/r'].map((c) => c.path), [A]);
    // two clones of one repo in a folder: both found, once
    const d = path.join(tmp, 'two');
    mkRepo(path.join(d, 'r'), 'https://github.com/o/s.git');
    mkRepo(path.join(d, 'r-2'), 'git@github.com:o/s.git');
    await l.scan(d); await l.scan(d);
    assert.deepStrictEqual(l.checkoutsOf('o/s').map((c) => c.path), [path.join(d, 'r'), path.join(d, 'r-2')]);
    // the single entry 0.1.0 and 0.2.0 stored
    const old = createLocalRepos({ memento: makeMemento({ 'gannet.local': { 'o/r': { path: A, login: 'x', byGannet: true } } }), home });
    assert.deepStrictEqual(old.checkoutsOf('o/r'), [{ path: A, login: 'x', byGannet: true }]);
    await old.remember('o/r', { path: path.join(d, 'r') });
    assert.strictEqual(old.checkoutsOf('o/r').length, 2, 'an old entry takes a second checkout');
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log('STATE OK');
})().catch((e) => { console.error(e); process.exit(1); });
