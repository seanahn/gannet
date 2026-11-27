'use strict';
// The Gannet tree: one node per owner an account reaches, each with its Recent repos and All repos (the account's
// full list, kept on disk once read); each repo's files from GitHub or from disk; items that stand in for errors.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fakeVscode, installVscode, makeMemento } = require('./stubs.js');
const vscode = fakeVscode();
installVscode(vscode);
const { GitHubError } = require('../src/github.js');
const { createRecent } = require('../src/recent.js');
const { createLocalRepos } = require('../src/localRepos.js');
const { createRepoCache } = require('../src/repoCache.js');
const { createWorkspaces } = require('../src/workspaces.js');
const { GannetTree } = require('../src/tree.js');

const R = (fullName, extra = {}) => ({ fullName, owner: fullName.split('/')[0], name: fullName.split('/')[1], private: false, archived: false, defaultBranch: 'main', htmlUrl: 'https://github.com/' + fullName, cloneUrl: `https://github.com/${fullName}.git`, ...extra });
const E = (name, type, extra = {}) => ({ name, path: name, type, size: 1, htmlUrl: 'https://github.com/o/r/tree/main/' + name, ...extra });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gannet-tree-'));
const S = vscode.TreeItemCollapsibleState;

(async () => {
  try {
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home, { recursive: true });
    const listings = new Map();   // "login fullName path" -> { entries, truncated } | GitHubError
    const repoLists = {
      'c3-sahn': { orgs: ['c3-e'], pushed: [R('c3-e/hub'), R('c3-sahn/notes')], all: [R('c3-e/hub'), R('c3-e/zeta'), R('c3-sahn/notes'), R('c3-taehokgil/tool')] },
      seanahn: { orgs: [], pushed: [R('seanahn/perch', { private: true }), R('seanahn/roost', { archived: true })], all: [R('zz/last'), R('seanahn/perch', { private: true }), R('seanahn/roost', { archived: true })] },
    };
    const calls = [];
    const clientFor = (login) => ({
      listOrgs: async () => { calls.push(['orgs', login]); const v = repoLists[login]; if (v instanceof Error) throw v; if (v.orgs instanceof Error) throw v.orgs; return v.orgs; },
      listRepos: async ({ sort }) => { calls.push(['repos', login, sort]); const v = repoLists[login]; if (v instanceof Error) throw v; return sort === 'pushed' ? v.pushed : v.all; },
      listDir: async (owner, repo, p) => { calls.push(['dir', login, `${owner}/${repo}`, p]); const v = listings.get(`${login} ${owner}/${repo} ${p}`); if (v instanceof Error) throw v; return v || { entries: [], truncated: false }; },
    });
    const accountList = [{ login: 'c3-sahn', source: 'gh' }, { login: 'seanahn', source: 'vscode' }];
    const accounts = { list: async () => accountList };
    const recent = createRecent(makeMemento());
    const local = createLocalRepos({ memento: makeMemento(), home });
    const cacheDir = path.join(tmp, 'store');
    const workspaces = createWorkspaces({ memento: makeMemento(), home });
    const make = (o = {}) => new GannetTree({ vscode, accounts, clientFor, recent, local, cache: createRepoCache(cacheDir), workspaces, home, ...o });
    const tree = make();
    const item = (n) => tree.getTreeItem(n);
    const labels = async (node, t = tree) => (await t.getChildren(node)).map((n) => t.getTreeItem(n).label);
    const fullCalls = (login) => calls.filter((c) => c[0] === 'repos' && c[1] === login && c[2] === 'full_name').length;
    const ownerNode = async (name, t = tree) => (await t.getChildren()).find((n) => t.getTreeItem(n).label === name);

    // root: one node per owner, by name; whom it is reached through; which start open
    let roots = await tree.getChildren();
    assert.deepStrictEqual(roots.map((n) => item(n).label), ['c3-e', 'c3-sahn', 'seanahn'], 'owners of the pushed list and organizations');
    assert.deepStrictEqual(roots.map((n) => item(n).description), ['via c3-sahn', undefined, undefined]);
    assert.deepStrictEqual(roots.map((n) => item(n).collapsibleState), [S.Expanded, S.Collapsed, S.Expanded], 'organizations open; an account with organizations has its own login closed');
    assert.deepStrictEqual(roots.map((n) => item(n).contextValue), ['owner', 'account-gh', 'account-vscode'], 'Hide account is on the own node');
    assert.deepStrictEqual(roots.map((n) => item(n).iconPath.id), ['organization', 'account', 'account']);
    assert.deepStrictEqual(roots.map((n) => item(n).id), ['owner:c3-sahn:c3-e', 'owner:c3-sahn:c3-sahn', 'owner:seanahn:seanahn'], 'ids, so VS Code remembers what is open');
    assert.ok(/Accounts menu/.test(item(roots[2]).tooltip), 'how to sign a VS Code account out');
    assert.ok(/gh CLI/.test(item(roots[1]).tooltip));

    // an owner: its recent repos, by name alone, then All repos
    const sean = roots[2];
    await recent.touch('seanahn', 'seanahn/roost');
    assert.deepStrictEqual(await labels(sean), ['roost', 'perch', 'All repos']);
    assert.strictEqual(item((await tree.getChildren(sean)).at(-1)).iconPath.id, 'repos', 'All repos: the two-cat icon the page draws');
    assert.deepStrictEqual(await labels(roots[0]), ['hub', 'All repos'], "c3-e's own, not c3-sahn's");
    const [roostNode, perchNode, allNode] = await tree.getChildren(sean);
    assert.strictEqual(item(perchNode).description, 'private');
    assert.strictEqual(item(roostNode).description, 'archived');
    assert.strictEqual(item(perchNode).contextValue, 'repo-remote');
    assert.strictEqual(item(perchNode).iconPath.id, 'github-alt', 'the Octocat without the circle');
    assert.strictEqual(item(perchNode).iconPath.color, undefined, 'not checked out: not green');
    assert.strictEqual(item(perchNode).tooltip, 'Only on GitHub');
    assert.strictEqual(item(allNode).collapsibleState, S.Collapsed);

    // All repos: the account's full list, this owner's part, sorted; read once, then kept on disk
    assert.deepStrictEqual(await labels(allNode), ['perch', 'roost']);
    await tree.getChildren(allNode);
    assert.strictEqual(fullCalls('seanahn'), 1);
    assert.ok(fs.existsSync(path.join(cacheDir, 'repos-seanahn.json')));
    assert.strictEqual(item(allNode).description, '2');
    assert.ok(/^Fetched /.test(item(allNode).tooltip), item(allNode).tooltip);
    const c3e = await ownerNode('c3-e');
    assert.deepStrictEqual(await labels((await tree.getChildren(c3e)).at(-1)), ['hub', 'zeta']);

    // Hide owner: an organization or another owner is left out (any case); an account's own login is not
    const th = make({ hiddenOwners: () => ['C3-E', 'seanahn'] });
    assert.deepStrictEqual(await labels(undefined, th), ['c3-sahn', 'c3-taehokgil', 'seanahn', 'zz']);

    // a new window (another tree on the same folder): owners found only in the kept list show, with no fetch
    const t2 = make();
    assert.deepStrictEqual(await labels(undefined, t2), ['c3-e', 'c3-sahn', 'c3-taehokgil', 'seanahn', 'zz']);
    const tae = await ownerNode('c3-taehokgil', t2);
    assert.strictEqual(t2.getTreeItem(tae).description, 'via c3-sahn');
    assert.strictEqual(t2.getTreeItem(tae).collapsibleState, S.Collapsed, "another user's repos start closed");
    assert.deepStrictEqual(await labels((await t2.getChildren(tae)).at(-1), t2), ['tool']);
    assert.strictEqual(fullCalls('c3-sahn'), 1, 'read from disk, not GitHub');
    // ⟳: the next All repos is read from GitHub again and the file replaced
    repoLists.seanahn.all = [...repoLists.seanahn.all, R('seanahn/new')];
    t2.refresh();
    const seanAll2 = (await t2.getChildren(await ownerNode('seanahn', t2))).at(-1);
    assert.deepStrictEqual(await labels(seanAll2, t2), ['new', 'perch', 'roost']);
    assert.strictEqual(fullCalls('seanahn'), 2);
    assert.ok(createRepoCache(cacheDir).get('seanahn').repos.some((r) => r.fullName === 'seanahn/new'));
    await t2.getChildren(seanAll2);
    assert.strictEqual(fullCalls('seanahn'), 2, 'once per refresh');
    // Final review: a checkout, a workspace change or an account change redraws, and never reads GitHub's list again
    t2.redraw();
    await t2.getChildren((await t2.getChildren(await ownerNode('seanahn', t2))).at(-1));
    assert.strictEqual(fullCalls('seanahn'), 2, 'a redraw keeps the kept list');
    const t3 = make();
    t3.redraw();
    await t3.getChildren((await t3.getChildren(await ownerNode('seanahn', t3))).at(-1));
    assert.strictEqual(fullCalls('seanahn'), 2, 'a redraw in a new window reads the file');

    // a remote repo's folders, lazily; opening it moves it to the top of Recent
    listings.set('seanahn seanahn/perch ', { entries: [E('src', 'dir'), E('big.bin', 'file', { size: 11 * 1024 * 1024 }), E('a.js', 'file'), E('lib', 'submodule'), E('link', 'symlink')], truncated: false });
    listings.set('seanahn seanahn/perch src', { entries: [E('x.js', 'file', { path: 'src/x.js' })], truncated: true });
    const top = await tree.getChildren(perchNode);
    assert.deepStrictEqual(top.map((n) => item(n).label), ['src', 'big.bin', 'a.js', 'lib', 'link']);
    assert.deepStrictEqual(await labels(sean), ['perch', 'roost', 'All repos']);
    const [srcNode, bigNode, aNode, libNode, linkNode] = top;
    assert.strictEqual(item(srcNode).collapsibleState, S.Collapsed);
    assert.strictEqual(item(aNode).collapsibleState, S.None);
    assert.strictEqual(item(aNode).command.command, 'gannet.openFile');
    assert.strictEqual(item(aNode).contextValue, 'file');
    assert.strictEqual(item(bigNode).contextValue, 'file-large');
    assert.strictEqual(item(libNode).collapsibleState, S.None, 'a submodule does not expand');
    assert.strictEqual(item(libNode).command.command, 'gannet.openUrl');
    assert.strictEqual(item(linkNode).collapsibleState, S.None);
    assert.strictEqual(item(linkNode).command.command, 'gannet.openFile', 'a symlink opens as a file');
    // icons as VS Code's own explorer draws them: the file icon theme's, from the resource; folders take the
    // theme's folder icon (none in Seti), and files the File kind, so VS Code lines them up with the folders' arrows
    for (const n of [srcNode, aNode, linkNode]) assert.strictEqual(item(n).resourceUri.scheme, 'gannet', item(n).label);
    assert.strictEqual(item(srcNode).resourceUri.path, '/seanahn/perch/src');
    assert.strictEqual(item(srcNode).iconPath, vscode.ThemeIcon.Folder);
    assert.strictEqual(item(aNode).iconPath, vscode.ThemeIcon.File);
    // a folder over GitHub's 1,000-entry limit ends with a way to see the rest
    const inSrc = await tree.getChildren(srcNode);
    assert.deepStrictEqual(inSrc.map((n) => item(n).label), ['x.js', 'More files — open on GitHub']);
    assert.strictEqual(item(inSrc[1]).command.command, 'gannet.openUrl');
    await tree.getChildren(srcNode);
    assert.strictEqual(calls.filter((c) => c[0] === 'dir' && c[3] === 'src').length, 1, 'cached');

    // an empty repo
    listings.set('c3-sahn c3-e/hub ', new GitHubError('empty', 409, 'This repository is empty.'));
    const [hub] = await tree.getChildren(c3e);
    assert.deepStrictEqual(await labels(hub), ['Empty repository']);
    assert.strictEqual(item(hub).contextValue, 'repo-remote', 'still offers Check out');

    // a checked-out repo lists the disk, .git hidden
    const dir = path.join(tmp, 'hub');
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'README.md'), 'hi');
    fs.writeFileSync(path.join(dir, 'docs', 'n.md'), 'n');
    await local.remember('c3-e/hub', { path: dir, login: 'c3-sahn', byGannet: true });
    const [hubLocal] = await tree.getChildren(c3e);
    assert.strictEqual(item(hubLocal).contextValue, 'repo-local');
    const onDisk = await tree.getChildren(hubLocal);
    assert.deepStrictEqual(onDisk.map((n) => item(n).label), ['docs', 'README.md']);
    assert.strictEqual(item(onDisk[1]).command.command, 'vscode.open');
    assert.strictEqual(item(onDisk[1]).resourceUri.fsPath, path.join(dir, 'README.md'));
    assert.strictEqual(item(onDisk[0]).iconPath, vscode.ThemeIcon.Folder);
    assert.strictEqual(item(onDisk[1]).iconPath, vscode.ThemeIcon.File);
    assert.deepStrictEqual((await tree.getChildren(onDisk[0])).map((n) => item(n).label), ['n.md']);
    // found on disk with no account yet: offers Push as
    await local.remember('c3-e/hub', { path: dir, login: null, byGannet: false });
    assert.strictEqual(item(hubLocal).contextValue, 'repo-local-foreign');

    // several checkouts: green, the workspaces they are in, one node per checkout
    {
      const gws = path.join(home, 'github'), other = path.join(tmp, 'git');
      await workspaces.add(gws); await workspaces.add(other);
      const p1 = path.join(gws, 'perch'), p2 = path.join(other, 'perch');
      for (const p of [p1, p2]) { fs.mkdirSync(path.join(p, '.git'), { recursive: true }); fs.writeFileSync(path.join(p, 'f.txt'), 'x'); }
      fs.writeFileSync(path.join(p1, '.git', 'HEAD'), 'ref: refs/heads/feat/x\n');
      fs.writeFileSync(path.join(p2, '.git', 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n');
      await local.remember('seanahn/perch', { path: p1, login: 'seanahn', byGannet: true });
      await local.remember('seanahn/perch', { path: p2, login: null, byGannet: false });
      const perch = { kind: 'repo', account: accountList[1], repo: R('seanahn/perch', { private: true }) };
      const it = item(perch);
      assert.strictEqual(it.description, `private · ~/github · ${other}`);
      assert.strictEqual(it.iconPath.id, 'github-alt');
      assert.strictEqual(it.iconPath.color.id, 'charts.green');
      assert.strictEqual(it.contextValue, 'repo-multi');
      // Sean: the tooltip leaves out the repo's name, and shows each checkout's branch
      assert.strictEqual(it.tooltip, `${p1} · feat/x · pushes as seanahn\n${p2} · detached at 0123456`);
      const copies = await tree.getChildren(perch);
      assert.deepStrictEqual(copies.map((n) => item(n).label), ['~/github/perch', p2]);
      assert.deepStrictEqual(copies.map((n) => item(n).contextValue), ['checkout-local', 'checkout-local-foreign']);
      assert.strictEqual(item(copies[0]).tooltip, `${p1} · feat/x · pushes as seanahn`);
      assert.strictEqual(item(copies[1]).tooltip, `${p2} · detached at 0123456`);
      // a worktree's .git is a file naming its git dir; no .git: no branch
      const { branchOf } = require('../src/localRepos.js');
      const wt = path.join(tmp, 'wt'), gd = path.join(tmp, 'wtgit');
      fs.mkdirSync(wt); fs.mkdirSync(gd);
      fs.writeFileSync(path.join(gd, 'HEAD'), 'ref: refs/heads/side\n');
      fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${gd}\n`);
      assert.strictEqual(branchOf(wt), 'side');
      fs.writeFileSync(path.join(wt, '.git'), 'gitdir: ../wtgit\n');
      assert.strictEqual(branchOf(wt), 'side', 'relative to the worktree');
      assert.strictEqual(branchOf(path.join(tmp, 'nowhere')), '');
      assert.strictEqual(item(copies[0]).collapsibleState, S.Collapsed);
      assert.deepStrictEqual((await tree.getChildren(copies[1])).map((n) => item(n).label), ['f.txt']);
      // one left: it is the repo's checkout again
      fs.rmSync(p1, { recursive: true });
      assert.strictEqual(item(perch).contextValue, 'repo-local-foreign');
      assert.strictEqual(item(perch).description, `private · ${other}`);
      assert.deepStrictEqual((await tree.getChildren(perch)).map((n) => item(n).label), ['f.txt']);
      // a checkout outside every workspace shows the folder it sits in
      const lone = path.join(tmp, 'elsewhere', 'perch');
      fs.mkdirSync(lone, { recursive: true });
      await local.remember('seanahn/perch', { path: lone });
      assert.strictEqual(item(perch).description, `private · ${other} · ${path.join(tmp, 'elsewhere')}`);
    }

    // Review Focus 2: an owner spelled two ways is one node
    {
      const lists = { x: { orgs: ['c3-e'], pushed: [R('C3-E/up')], all: [] } };
      const t = make({ accounts: { list: async () => [{ login: 'x', source: 'gh' }] }, clientFor: (l) => ({ listOrgs: async () => lists[l].orgs, listRepos: async ({ sort }) => (sort === 'pushed' ? lists[l].pushed : lists[l].all) }), cache: createRepoCache(path.join(tmp, 'store-case')) });
      assert.deepStrictEqual(await labels(undefined, t), ['c3-e', 'x']);
      assert.deepStrictEqual(await labels((await t.getChildren())[0], t), ['up', 'All repos']);
    }

    // organizations not readable (no read:org): owners still come from the repos; none opens as an organization
    {
      const lists = { x: { pushed: [R('org/up')], all: [] } };
      const t = make({ accounts: { list: async () => [{ login: 'x', source: 'gh' }] }, clientFor: (l) => ({ listOrgs: async () => { throw new GitHubError('other', 403, 'no'); }, listRepos: async ({ sort }) => (sort === 'pushed' ? lists[l].pushed : lists[l].all) }), cache: createRepoCache(path.join(tmp, 'store-noorg')) });
      const r = await t.getChildren();
      assert.deepStrictEqual(r.map((n) => [t.getTreeItem(n).label, t.getTreeItem(n).collapsibleState]), [['org', S.Collapsed], ['x', S.Expanded]]);
    }

    // errors: Review Focus 4 — one account signed out leaves the other's owners alone; its own node shows the error
    repoLists.seanahn = new GitHubError('auth', 401, 'Bad credentials');
    tree.refresh();
    roots = await tree.getChildren();
    assert.deepStrictEqual(roots.map((n) => item(n).label), ['c3-e', 'c3-sahn', 'c3-taehokgil', 'seanahn'], "c3-sahn's owners as before (c3-taehokgil from its kept list); seanahn's own node only");
    let [err] = await tree.getChildren(roots[3]);
    assert.strictEqual(item(err).label, 'Signed out');
    assert.strictEqual(item(err).command.command, 'gannet.signIn');
    assert.strictEqual(item(roots[3]).collapsibleState, S.Expanded, 'the error shows');
    repoLists['c3-sahn'] = new GitHubError('auth', 401, 'Bad credentials');
    tree.refresh();
    [err] = await tree.getChildren(await ownerNode('c3-sahn'));
    assert.strictEqual(item(err).description, 'run gh auth login');
    repoLists.seanahn = new GitHubError('sso', 403, 'SSO', { ssoUrl: 'https://github.com/orgs/c3-e/sso' });
    tree.refresh();
    [err] = await tree.getChildren(await ownerNode('seanahn'));
    assert.strictEqual(item(err).contextValue, 'error-sso');
    assert.deepStrictEqual(item(err).command.arguments, ['https://github.com/orgs/c3-e/sso']);
    repoLists.seanahn = new GitHubError('rate', 403, 'rate', { retryAt: new Date(2026, 10, 25, 14, 5) });
    tree.refresh();
    [err] = await tree.getChildren(await ownerNode('seanahn'));
    assert.strictEqual(item(err).label, 'Rate limited — try again at 14:05');
    repoLists.seanahn = { orgs: [], pushed: [R('seanahn/perch')], all: [R('seanahn/perch')] };

    // a repo GitHub no longer shows is dropped from Recent
    await recent.touch('seanahn', 'seanahn/gone');
    repoLists.seanahn.pushed = [R('seanahn/perch'), R('seanahn/gone')];
    tree.refresh();
    const goneNode = (await tree.getChildren(await ownerNode('seanahn')))[0];
    assert.strictEqual(item(goneNode).label, 'gone');
    listings.set('seanahn seanahn/gone ', new GitHubError('notFound', 404, 'Not Found'));
    assert.deepStrictEqual(await labels(goneNode), ['No longer on GitHub']);
    repoLists.seanahn.pushed = [R('seanahn/perch')];
    tree.refresh();
    assert.deepStrictEqual(await labels(await ownerNode('seanahn')), ['perch', 'roost', 'All repos'], "gone is dropped; roost, used before, is still in the kept list");

    // a refused token is dropped, so after gh auth login and refresh the account works again
    {
      const forgotten = [];
      const t = make({ accounts: { list: async () => accountList, forget: (l) => forgotten.push(l) }, clientFor: () => ({ listOrgs: async () => [], listRepos: async () => { throw new GitHubError('auth', 401, 'Bad credentials'); } }), cache: createRepoCache(path.join(tmp, 'store-x')) });
      const [acct] = await t.getChildren();
      await t.getChildren(acct);
      assert.deepStrictEqual(forgotten, ['c3-sahn']);
    }
    console.log('TREE OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); });
