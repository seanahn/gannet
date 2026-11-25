'use strict';
// Where repos are checked out on this machine: remembered when Gannet clones them, and found by their origin URL
// when they already sit in the checkout folder. Kept in global state, which is per machine.
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
  const load = () => memento.get(KEY, {}) || {};
  const save = (all) => memento.update(KEY, all);
  return {
    get: (fullName) => load()[keyOf(fullName)],
    all: () => new Map(Object.entries(load())),
    remember(fullName, entry) { const all = load(); all[keyOf(fullName)] = { path: entry.path, login: entry.login ?? null, byGannet: !!entry.byGannet }; return save(all); },
    forgetMissing() {
      const all = load();
      for (const [k, v] of Object.entries(all)) if (!isDir(v.path)) delete all[k];
      return save(all);
    },
    scan(folder) {
      const dir = expandHome(folder, home);
      const all = load();
      for (const name of children(dir)) {
        if (PARTIAL_RE.test(name)) continue;
        const full = parseOrigin(originOf(path.join(dir, name)));
        if (full && !all[keyOf(full)]) all[keyOf(full)] = { path: path.join(dir, name), login: null, byGannet: false };
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

module.exports = { createLocalRepos, parseOrigin, originOf, expandHome, isDir, PARTIAL, partialOf };
