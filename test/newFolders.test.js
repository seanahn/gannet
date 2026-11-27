'use strict';
// The record of folders not on GitHub yet: which owner row each belongs to; and the name check for New Folder….
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeMemento } = require('./stubs.js');
const { createNewFolders, checkName } = require('../src/newFolders.js');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gannet-nf-'));
  try {
    const nf = createNewFolders({ memento: makeMemento() });
    await nf.add({ path: '/w/a', owner: 'c3-e', account: 'c3-sahn' });
    await nf.add({ path: '/v/a', owner: 'C3-E', account: 'c3-sahn' });
    assert.deepStrictEqual(nf.forRow('c3-e', 'C3-SAHN').map((r) => r.path), ['/w/a', '/v/a'], 'owner and account match without case');
    await nf.move('/w/a', { owner: 'bpmn2', account: 'seanahn' });
    assert.deepStrictEqual(nf.forRow('bpmn2', 'seanahn').map((r) => r.path), ['/w/a']);
    assert.deepStrictEqual(nf.forRow('c3-e', 'c3-sahn').map((r) => r.path), ['/v/a']);
    await nf.forget('/v/a');
    assert.deepStrictEqual(nf.list().map((r) => r.path), ['/w/a']);
    await nf.add({ path: '/w/a', owner: 'c3-e', account: 'c3-sahn' });
    assert.strictEqual(nf.list().length, 1, 'adding a recorded path replaces it');
    assert.deepStrictEqual(nf.list()[0], { path: '/w/a', owner: 'c3-e', account: 'c3-sahn' });

    // names: one folder name; Review Focus 3
    for (const n of ['my thing', '.env-x', 'café']) assert.deepStrictEqual(checkName(tmp, n), { ok: true, adopt: false }, n);
    for (const n of ['', '.', '..', 'a/b', 'a\\b']) {
      const r = checkName(tmp, n);
      assert.strictEqual(r.ok, false, JSON.stringify(n));
      assert.ok(r.message, 'says why: ' + JSON.stringify(n));
    }
    fs.mkdirSync(path.join(tmp, 'old'));
    assert.deepStrictEqual(checkName(tmp, 'old'), { ok: true, adopt: true }, 'an existing folder is adopted');
    fs.writeFileSync(path.join(tmp, 'f.txt'), 'x');
    assert.strictEqual(checkName(tmp, 'f.txt').ok, false, 'a file');
    fs.mkdirSync(path.join(tmp, 'gh', '.git'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'gh', '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/c3-e/x.git\n');
    const r = checkName(tmp, 'gh');
    assert.strictEqual(r.ok, false, 'already a GitHub clone');
    assert.ok(/c3-e\/x/.test(r.message), r.message);
    console.log('NEWFOLDERS OK');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
