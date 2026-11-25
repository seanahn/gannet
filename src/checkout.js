'use strict';
// Checking a repo out: naming its folder (a repo may be checked out more than once), cloning one repo at a time into a partial folder that is renamed only
// when git succeeds, and writing the repo's own credential settings so it pushes as the account it came from.
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { parseOrigin, originOf, expandHome, isDir, partialOf } = require('./localRepos.js');

const KEY = 'credential.https://github.com';

/** Where a repo goes in folder: the first free of <name>, <owner>-<name>, <name>-2, <name>-3, …; never a taken one. */
function chooseTarget(folder, repo, { isDir: dirExists = isDir } = {}) {
  const names = [repo.name, `${repo.owner}-${repo.name}`];
  for (let i = 0; ; i++) {
    const p = path.join(folder, i < names.length ? names[i] : `${repo.name}-${i}`);
    if (!dirExists(p)) return p;
  }
}

const holds = (dir, repo) => isDir(dir) && String(parseOrigin(originOf(dir))).toLowerCase() === repo.fullName.toLowerCase();

/** The `git config` argument lists that make a repo ask only Gannet's helper, as login, for github.com. */
function pushConfigArgs(login, helper) {
  return [
    ['config', '--local', `${KEY}.helper`, ''],
    ['config', '--local', '--add', `${KEY}.helper`, helper],
    ['config', '--local', `${KEY}.username`, login],
  ];
}

/** A gh account's helper: asks gh for that account's token each time git needs it, so nothing is stored. */
function ghHelper(login) {
  return `!f() { test "$1" = get || exit 0; echo username=${login}; echo password=$(gh auth token --hostname github.com --user ${login}); }; f`;
}

async function configurePush(run, dir, login, helper) {
  // clear what an earlier setup left (exit 5: there was nothing to clear), so this can run more than once
  const cleared = await run('git', ['-C', dir, 'config', '--local', '--unset-all', `${KEY}.helper`]);
  if (cleared.code !== 0 && cleared.code !== 5) throw new Error(`git config failed: ${(cleared.stderr || '').trim()}`);
  for (const args of pushConfigArgs(login, helper)) {
    const res = await run('git', ['-C', dir, ...args]);
    if (res.code !== 0) throw new Error(`git config failed: ${(res.stderr || '').trim()}`);
  }
}

function lastLine(text) {
  const lines = String(text).split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

function createCheckout({ run, spawn = childProcess.spawn, local, accounts, helperCommand, home }) {
  let queue = Promise.resolve();

  function clone(url, dest, token, cancel, onProgress) {
    const secret = Buffer.from('x-access-token:' + token).toString('base64');
    const mask = (s) => String(s).split(secret).join('***').split(token).join('***');
    return new Promise((resolve, reject) => {
      // the sign-in goes in git's environment (not argv, which other users can read), scoped to github.com, and the
      // machine's own credential helpers are switched off so the clone never quietly runs as another account
      const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
      const n = Number(env.GIT_CONFIG_COUNT) || 0;
      const pairs = [['http.https://github.com/.extraHeader', `Authorization: Basic ${secret}`], ['credential.helper', '']];
      pairs.forEach(([k, v], i) => { env[`GIT_CONFIG_KEY_${n + i}`] = k; env[`GIT_CONFIG_VALUE_${n + i}`] = v; });
      env.GIT_CONFIG_COUNT = String(n + pairs.length);
      const child = spawn('git', ['clone', '--progress', url, dest], { stdio: ['ignore', 'pipe', 'pipe'], env });
      let stderr = '', cancelled = false;
      const sub = cancel && cancel.onCancellationRequested(() => { cancelled = true; child.kill(); });
      if (cancel && cancel.isCancellationRequested) { cancelled = true; child.kill(); }
      child.stderr.on('data', (d) => { stderr += d; if (onProgress) onProgress(mask(lastLine(String(d)))); });
      if (child.stdout) child.stdout.on('data', () => {});
      child.on('error', (e) => { if (sub) sub.dispose(); reject(new Error(mask(`git could not start: ${e.message}`))); });
      child.on('close', (code) => {
        if (sub) sub.dispose();
        if (cancelled) reject(new Error('cancelled'));
        else if (code === 0) resolve();
        else reject(new Error(mask(lastLine(stderr) || `git clone exited with ${code}`)));
      });
    });
  }

  async function setUp(target, repo, account) {
    // no helper (VS Code accounts when this window cannot serve tokens): write nothing rather than a broken setting;
    // the repo is remembered with no account, so the tree offers Push as later
    const helper = helperCommand(account);
    if (helper) await configurePush(run, target, account.login, helper);
    await local.remember(repo.fullName, { path: target, login: helper ? account.login : null, byGannet: true });
  }

  async function run1({ repo, account, folder, target, onTarget, onProgress, token: cancel }) {
    const dir = expandHome(folder, home);
    // resuming: the clone may already be in place (the restart came after the rename); then only set it up
    if (target && holds(target, repo)) { await setUp(target, repo, account); return { path: target, cloned: false }; }
    if (!target || isDir(target)) target = chooseTarget(dir, repo);
    const token = await accounts.token(account.login);   // no usable token: stop before git runs
    if (onTarget) await onTarget(target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const partial = partialOf(target);
    fs.rmSync(partial, { recursive: true, force: true });
    try {
      await clone(repo.cloneUrl, partial, token, cancel, onProgress);
      fs.renameSync(partial, target);
    } catch (e) {
      fs.rmSync(partial, { recursive: true, force: true });
      throw e;
    }
    await setUp(target, repo, account);
    return { path: target, cloned: true };
  }

  return {
    /** Queued: one clone at a time. */
    checkout(opts) {
      const next = queue.then(() => run1(opts));
      queue = next.catch(() => {});
      return next;
    },
    configurePush: (dir, login, helper) => configurePush(run, dir, login, helper),
  };
}

module.exports = { chooseTarget, createCheckout, pushConfigArgs, ghHelper, configurePush };
