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

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const children = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } };

function createLocalRepos({ memento, home = os.homedir() }) {
  const load = () => memento.get(KEY, {}) || {};
  const save = (all) => memento.update(KEY, all);
  return {
    get: (fullName) => load()[fullName],
    all: () => new Map(Object.entries(load())),
    remember(fullName, entry) { const all = load(); all[fullName] = { path: entry.path, login: entry.login ?? null, byGannet: !!entry.byGannet }; return save(all); },
    forgetMissing() {
      const all = load();
      for (const [k, v] of Object.entries(all)) if (!isDir(v.path)) delete all[k];
      return save(all);
    },
    scan(folder) {
      const dir = expandHome(folder, home);
      const all = load();
      for (const name of children(dir)) {
        if (name.endsWith(PARTIAL)) continue;
        const full = parseOrigin(originOf(path.join(dir, name)));
        if (full && !all[full]) all[full] = { path: path.join(dir, name), login: null, byGannet: false };
      }
      return save(all);
    },
    cleanPartials(folder) {
      const dir = expandHome(folder, home);
      for (const name of children(dir)) if (name.endsWith(PARTIAL)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    },
  };
}

module.exports = { createLocalRepos, parseOrigin, originOf, expandHome, isDir, PARTIAL };
