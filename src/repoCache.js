'use strict';
// Each account's full repo list, kept in a file in Gannet's storage folder once fetched, so opening All repos (and
// finding the owners in it) never waits on GitHub again until ⟳. A file that cannot be read counts as none.
const fs = require('fs');
const path = require('path');

function createRepoCache(dir) {
  const fileOf = (login) => path.join(dir, `repos-${encodeURIComponent(login)}.json`);
  return {
    get(login) {
      try {
        const data = JSON.parse(fs.readFileSync(fileOf(login), 'utf8'));
        return data && Array.isArray(data.repos) ? { repos: data.repos, fetchedAt: String(data.fetchedAt || '') } : undefined;
      } catch { return undefined; }
    },
    set(login, repos) {
      fs.mkdirSync(dir, { recursive: true });
      const file = fileOf(login);
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ fetchedAt: new Date().toISOString(), repos }));
      fs.renameSync(tmp, file);
    },
    forget(login) { fs.rmSync(fileOf(login), { force: true }); },
  };
}

module.exports = { createRepoCache };
