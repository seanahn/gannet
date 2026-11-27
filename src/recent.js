'use strict';
// The repos used recently in Gannet, per account, merged with this machine's checkouts and GitHub's "recently pushed" list.
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
    /** Used repos first, then the repos checked out on this machine in the order given (local: full names, any case),
     *  then GitHub's pushed order; only repos GitHub lists, no duplicates; of those keep() accepts, at most 10. */
    merge(login, pushed, known, keep = () => true, local = []) {
      const byName = new Map(known);
      for (const r of pushed) if (!byName.has(r.fullName)) byName.set(r.fullName, r);
      const byKey = new Map();
      for (const r of byName.values()) byKey.set(r.fullName.toLowerCase(), r);
      const out = [], seen = new Set();
      const add = (r) => { if (r && !seen.has(r.fullName) && keep(r) && out.length < MAX) { seen.add(r.fullName); out.push(r); } };
      for (const f of load()[login] || []) add(byName.get(f));
      for (const f of local) add(byKey.get(String(f).toLowerCase()));
      for (const r of pushed) add(r);
      return out;
    },
  };
}

module.exports = { createRecent, MAX, KEEP };
