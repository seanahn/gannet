'use strict';
// Where repos are checked out on this machine: remembered when Gannet clones them, and found by their origin URL
// when they already sit in a workspace. A repo can be checked out more than once. Kept in machine.json.
const fs = require('fs');
const os = require('os');
const path = require('path');

const KEY = 'gannet.local';
const PARTIAL = '.gannet-partial';

/** owner/name of a github.com remote URL (https, scp-style or ssh), or null. */
function parseOrigin(url) {
  const m = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(url || '').trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

function expandHome(p, home = os.homedir()) {
  if (p === '~') return home;
  return p && p.startsWith('~/') ? path.join(home, p.slice(2)) : p;
}

/** The origin URL in a checkout's .git/config, or ''. */
function originOf(dir) {
  let text;
  try { text = fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8'); } catch { return ''; }
  const m = /\[remote "origin"\][^[]*?\burl\s*=\s*(\S+)/.exec(text);
  return m ? m[1] : '';
}

/** The checked-out branch, 'detached at <sha7>', or '' when unreadable; a worktree's .git file is followed. */
function branchOf(dir) {
  try {
    let gitDir = path.join(dir, '.git');
    if (fs.statSync(gitDir).isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(gitDir, 'utf8'));
      if (!m) return '';
      gitDir = path.resolve(dir, m[1].trim());
    }
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    if (ref) return ref[1];
    return /^[0-9a-f]{7,}$/i.test(head) ? `detached at ${head.slice(0, 7)}` : '';
  } catch { return ''; }
}

const keyOf = (fullName) => String(fullName).toLowerCase();   // GitHub names ignore case
/** A partial clone's folder: tied to this window's process, so another window never removes one still in progress. */
const partialOf = (target) => `${target}${PARTIAL}-${process.pid}`;
const PARTIAL_RE = /\.gannet-partial(?:-(\d+))?$/;
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const children = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } };

function createLocalRepos({ memento, home = os.homedir() }) {
  // { key: [checkout, …] }; 0.1.0 and 0.2.0 stored one checkout per key, read as a list of one
  const load = () => {
    const all = memento.get(KEY, {}) || {};
    for (const k of Object.keys(all)) if (!Array.isArray(all[k])) all[k] = all[k] ? [all[k]] : [];
    return all;
  };
  const save = (all) => memento.update(KEY, all);
  const entry = (e) => ({ path: e.path, login: e.login ?? null, byGannet: !!e.byGannet });
  return {
    /** This repo's checkouts still on disk, in the order remembered. */
    checkoutsOf: (fullName) => (load()[keyOf(fullName)] || []).filter((c) => isDir(c.path)),
    all: () => new Map(Object.entries(load())),
    remember(fullName, e) {
      const all = load();
      const list = all[keyOf(fullName)] || [];
      const i = list.findIndex((c) => c.path === e.path);
      if (i >= 0) list[i] = entry(e); else list.push(entry(e));
      all[keyOf(fullName)] = list;
      return save(all);
    },
    forgetMissing() {
      const all = load();
      for (const [k, list] of Object.entries(all)) {
        const kept = list.filter((c) => isDir(c.path));
        if (kept.length) all[k] = kept; else delete all[k];
      }
      return save(all);
    },
    scan(folder) {
      const dir = expandHome(folder, home);
      const all = load();
      for (const name of children(dir)) {
        if (PARTIAL_RE.test(name)) continue;
        const p = path.join(dir, name);
        const full = parseOrigin(originOf(p));
        if (!full) continue;
        const list = all[keyOf(full)] || [];
        if (!list.some((c) => c.path === p)) all[keyOf(full)] = [...list, entry({ path: p })];
      }
      return save(all);
    },
    cleanPartials(folder) {
      const dir = expandHome(folder, home);
      for (const name of children(dir)) {
        const m = PARTIAL_RE.exec(name);
        if (m && !(m[1] && alive(Number(m[1])))) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
      }
    },
  };
}

module.exports = { createLocalRepos, parseOrigin, originOf, branchOf, expandHome, isDir, PARTIAL, partialOf, alive };
