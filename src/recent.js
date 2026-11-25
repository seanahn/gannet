'use strict';
// The repos used recently in Gannet, per account, merged with GitHub's own "recently pushed" list.
const KEY = 'gannet.recent';
const MAX = 10;    // shown per owner
const KEEP = 50;   // remembered per account, so each owner keeps its own used repos

function createRecent(memento) {
  const load = () => memento.get(KEY, {}) || {};
  const save = (all) => memento.update(KEY, all);
  return {
    touch(login, fullName) {
      const all = load();
      all[login] = [fullName, ...(all[login] || []).filter((f) => f !== fullName)].slice(0, KEEP);
      return save(all);
    },
    forgetRepo(login, fullName) {
      const all = load();
      all[login] = (all[login] || []).filter((f) => f !== fullName);
      return save(all);
    },
    /** Used repos first (only those GitHub still lists), then GitHub's pushed order, no duplicates; of those keep()
     *  accepts, at most 10. */
    merge(login, pushed, known, keep = () => true) {
      const byName = new Map(known);
      for (const r of pushed) if (!byName.has(r.fullName)) byName.set(r.fullName, r);
      const out = [], seen = new Set();
      const add = (r) => { if (r && !seen.has(r.fullName) && keep(r) && out.length < MAX) { seen.add(r.fullName); out.push(r); } };
      for (const f of load()[login] || []) add(byName.get(f));
      for (const r of pushed) add(r);
      return out;
    },
  };
}

module.exports = { createRecent, MAX, KEEP };
