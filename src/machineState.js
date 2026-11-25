'use strict';
// What Gannet keeps per machine — where repos are checked out, the workspace list, checkouts in progress — in a
// JSON file in its global storage folder. Under Remote-SSH that folder is on the remote, while globalState is kept
// by the local client and shared by every machine, so seclab and the local machine would otherwise see each
// other's folders. Same get/update shape as a Memento, so the stores using it do not change.
const fs = require('fs');
const path = require('path');

function createMachineState(file) {
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; } };
  return {
    exists: () => fs.existsSync(file),
    get(key, dflt) { const all = read(); return key in all ? all[key] : dflt; },
    update(key, value) {
      const all = read();   // read just before writing: another window may have changed another key
      if (value === undefined) delete all[key]; else all[key] = value;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(all, null, 1));
      fs.renameSync(tmp, file);
      return Promise.resolve();
    },
  };
}

module.exports = { createMachineState };
