'use strict';
// Checking a repo out: picking the folder, cloning one repo at a time into a partial folder that is renamed only
// when git succeeds, and writing the repo's own credential settings so it pushes as the account it came from.
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { parseOrigin, originOf, expandHome, isDir, PARTIAL } = require('./localRepos.js');

const KEY = 'credential.https://github.com';

/** Where a repo goes in folder: <name>, else <owner>-<name>; a folder already holding this repo is reused. */
function chooseTarget(folder, repo, { isDir: dirExists = isDir, originOf: origin = originOf } = {}) {
  for (const name of [repo.name, `${repo.owner}-${repo.name}`]) {
    const p = path.join(folder, name);
    if (!dirExists(p)) return { path: p, existing: false };
    if (parseOrigin(origin(p)) === repo.fullName) return { path: p, existing: true };
  }
  return { ask: true };
}

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
      const child = spawn('git', ['-c', `http.extraHeader=Authorization: Basic ${secret}`, 'clone', '--progress', url, dest],
        { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
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

  async function run1({ repo, account, folder, onProgress, token: cancel, ask }) {
    const known = local.get(repo.fullName);
    if (known && isDir(known.path)) return { path: known.path, existing: true };
    const dir = expandHome(folder, home);
    let target = chooseTarget(dir, repo);
    if (target.ask) {
      const picked = ask ? await ask() : undefined;
      if (!picked) throw new Error('cancelled');
      target = chooseTarget(picked, repo);
      if (target.ask) throw new Error(`${path.join(picked, repo.name)} is already taken`);
    }
    if (target.existing) {
      await local.remember(repo.fullName, { path: target.path, login: known ? known.login : null, byGannet: known ? known.byGannet : false });
      return { path: target.path, existing: true };
    }
    const token = await accounts.token(account.login);   // no usable token: stop before git runs
    fs.mkdirSync(path.dirname(target.path), { recursive: true });
    const partial = target.path + PARTIAL;
    fs.rmSync(partial, { recursive: true, force: true });
    try {
      await clone(repo.cloneUrl, partial, token, cancel, onProgress);
      fs.renameSync(partial, target.path);
    } catch (e) {
      fs.rmSync(partial, { recursive: true, force: true });
      throw e;
    }
    await configurePush(run, target.path, account.login, helperCommand(account));
    await local.remember(repo.fullName, { path: target.path, login: account.login, byGannet: true });
    return { path: target.path, existing: false };
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
