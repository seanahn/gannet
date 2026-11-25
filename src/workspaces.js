'use strict';
// Workspaces: the directories Gannet keeps checkouts in on this machine (/git, ~/github; ~/ on seclab). The list is
// per machine, in machine.json. 0.2.0's list, which could hold .code-workspace files, is carried over once.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { expandHome, isDir } = require('./localRepos.js');

const KEY = 'gannet.workspaces';
const MIGRATED = 'gannet.migrated';
const VERSION = 3;

const isGitRepo = (dir) => fs.existsSync(path.join(dir, '.git'));
const exists = (p) => isDir(p);
const inside = (p, dir) => { const r = path.relative(dir, p); return !r.startsWith('..') && !path.isAbsolute(r); };   // or equal
const tilde = (p, home = os.homedir()) => (p === home ? '~' : p.startsWith(home + path.sep) ? '~' + p.slice(home.length) : p);

function createWorkspaces({ memento, home = os.homedir() }) {
  const norm = (p) => path.resolve(expandHome(p, home));
  const load = () => (memento.get(KEY, []) || []).filter((p) => typeof p === 'string');
  return {
    list: () => load(),
    add(p) {
      const list = load(), n = norm(p);
      return list.includes(n) ? Promise.resolve() : memento.update(KEY, [...list, n]);
    },
    remove(p) { const n = norm(p); return memento.update(KEY, load().filter((x) => x !== n)); },
  };
}

/** The deepest listed directory holding p (or p itself), or null. */
function workspaceOf(p, list) {
  let best = null;
  for (const w of list) if (inside(p, w) && (!best || w.length > best.length)) best = w;
  return best;
}

/** How a checkout's place reads on a repo: its workspace, else the folder it sits in; home as ~. */
function labelOf(p, list, home = os.homedir()) {
  return tilde(workspaceOf(p, list) || path.dirname(p), home);
}

/** JSON with // and block comments and trailing commas, as .code-workspace files are written. */
function parseJsonc(text) {
  let out = '', i = 0;
  const s = String(text);
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
      out += s.slice(i, j + 1); i = j + 1;
    } else if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
    } else if (c === '/' && s[i + 1] === '*') {
      const j = s.indexOf('*/', i + 2);
      i = j < 0 ? s.length : j + 2;
    } else { out += c; i++; }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** 0.2.0 kept clones of a workspace file in the folder most of its repos share (ties: the first), else its own. */
function repoFolderOfFile(file) {
  let folders = [];
  try {
    const data = parseJsonc(fs.readFileSync(file, 'utf8'));
    folders = (Array.isArray(data && data.folders) ? data.folders : [])
      .filter((f) => f && typeof f.path === 'string')
      .map((f) => path.resolve(path.dirname(file), expandHome(f.path)));
  } catch { /* unreadable: the file's own folder */ }
  const counts = new Map();
  for (const f of folders) { const d = path.dirname(f); counts.set(d, (counts.get(d) || 0) + 1); }
  let best = null;
  for (const [d, n] of counts) if (!best || n > best[1]) best = [d, n];
  return best ? best[0] : path.dirname(file);
}

/** Once per machine: 0.2.0's list as directories, then the old checkout folder if it exists. */
async function migrate({ memento, home = os.homedir(), checkoutFolder }) {
  if (memento.get(MIGRATED) >= VERSION) return;
  const out = [];
  const add = (p) => { if (p && !out.includes(p)) out.push(p); };
  for (const w of memento.get(KEY, []) || []) {
    if (typeof w === 'string') add(path.resolve(expandHome(w, home)));
    else if (w && w.kind === 'file') add(w.repoFolder || repoFolderOfFile(w.path));
    else if (w && w.path) add(w.path);
  }
  const old = path.resolve(expandHome(checkoutFolder || '~/github', home));
  if (isDir(old)) add(old);
  await memento.update(KEY, out);
  await memento.update(MIGRATED, VERSION);
}

module.exports = { createWorkspaces, workspaceOf, labelOf, tilde, parseJsonc, migrate, exists, isGitRepo, KEY, MIGRATED };
