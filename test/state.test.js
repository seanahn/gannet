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
  for (let i = 0; i < 15; i++) recent.touch('sean', 'x/' + i);
  assert.strictEqual(memento.get('gannet.recent').sean.length, 10, 'capped at 10');
  recent.forgetRepo('sean', 'x/14');
  assert.ok(!memento.get('gannet.recent').sean.includes('x/14'));
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
  fs.mkdirSync(path.join(folder, 'half.gannet-partial'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'half.gannet-partial', 'f'), 'x');

  const memento = makeMemento();
  const local = createLocalRepos({ memento, home });
  local.remember('seanahn/roost', { path: path.join(folder, 'roost-deleted'), login: 'seanahn', byGannet: true });
  local.remember('seanahn/kept', { path: path.join(folder, 'perch'), login: 'seanahn', byGannet: true });
  local.scan('~/github');
  assert.deepStrictEqual(local.get('seanahn/perch'), { path: path.join(folder, 'perch'), login: null, byGannet: false });
  assert.strictEqual(local.get('x/y'), undefined, 'not a github origin');
  local.forgetMissing();
  assert.strictEqual(local.get('seanahn/roost'), undefined, 'deleted from disk: forgotten');
  assert.ok(local.get('seanahn/kept'), 'still on disk: kept');
  local.remember('seanahn/perch', { path: path.join(folder, 'perch'), login: 'seanahn', byGannet: true });
  local.scan(folder);
  assert.strictEqual(local.get('seanahn/perch').login, 'seanahn', 'scan does not overwrite what is known');
  local.cleanPartials('~/github');
  assert.ok(!fs.existsSync(path.join(folder, 'half.gannet-partial')));
  assert.ok(fs.existsSync(path.join(folder, 'notes')));
  assert.ok(local.all() instanceof Map && local.all().has('seanahn/perch'));
  assert.deepStrictEqual(memento.get('gannet.local')['seanahn/perch'].login, 'seanahn', 'stored in the memento');
  local.scan(path.join(tmp, 'nowhere'));   // a missing folder scans as empty
  local.cleanPartials(path.join(tmp, 'nowhere'));
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log('STATE OK');
