'use strict';
// Folders not on GitHub yet: Gannet's own record of which owner row each belongs to, per machine (machine.json).
// Gannet never writes inside these folders; the record is all it keeps.
const fs = require('fs');
const path = require('path');
const { parseOrigin, originOf } = require('./localRepos.js');

const KEY = 'gannet.newFolders';
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

function createNewFolders({ memento }) {
  const load = () => (memento.get(KEY, []) || []).filter((r) => r && typeof r.path === 'string');
  const save = (list) => memento.update(KEY, list);
  const rec = (r) => ({ path: r.path, owner: r.owner, account: r.account });
  return {
    list: () => load(),
    add(r) { return save([...load().filter((x) => x.path !== r.path), rec(r)]); },
    move(p, { owner, account }) { return save(load().map((x) => (x.path === p ? rec({ path: p, owner, account }) : x))); },
    forget(p) { return save(load().filter((x) => x.path !== p)); },
    forRow: (owner, account) => load().filter((x) => same(x.owner, owner) && same(x.account, account)),
  };
}

/** Whether `name` can be a new folder in `dir`: one folder name; an existing plain folder is adopted. */
function checkName(dir, name) {
  const n = String(name || '');
  if (!n.trim()) return { ok: false, message: 'Type a folder name.' };
  if (n === '.' || n === '..') return { ok: false, message: `"${n}" is not a folder name.` };
  if (/[/\\]/.test(n)) return { ok: false, message: 'One folder name, without / or \\.' };
  const p = path.join(dir, n);
  let st = null;
  try { st = fs.statSync(p); } catch { /* not there: created */ }
  if (!st) return { ok: true, adopt: false };
  if (!st.isDirectory()) return { ok: false, message: `${n} is a file.` };
  const full = parseOrigin(originOf(p));
  if (full) return { ok: false, message: `${n} is already a clone of ${full}; it shows under its owner.` };
  return { ok: true, adopt: true };
}

module.exports = { createNewFolders, checkName, KEY };
