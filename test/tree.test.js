'use strict';
// The Gannet tree: accounts, their Recent and All repos, each repo's files from GitHub or from disk, and the items
// that stand in for errors.
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
const { GannetTree } = require('../src/tree.js');

const R = (fullName, extra = {}) => ({ fullName, owner: fullName.split('/')[0], name: fullName.split('/')[1], private: false, archived: false, defaultBranch: 'main', htmlUrl: 'https://github.com/' + fullName, cloneUrl: `https://github.com/${fullName}.git`, ...extra });
const E = (name, type, extra = {}) => ({ name, path: name, type, size: 1, htmlUrl: 'https://github.com/o/r/tree/main/' + name, ...extra });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gannet-tree-'));

(async () => {
  try {
    const listings = new Map();   // "login fullName path" -> { entries, truncated } | GitHubError
    const repoLists = { seanahn: { pushed: [R('seanahn/perch', { private: true }), R('seanahn/roost', { archived: true })], all: [R('zz/last'), R('seanahn/perch', { private: true }), R('aa/first'), R('seanahn/roost', { archived: true }), R('c3-e/hub')] }, 'c3-sahn': { pushed: [R('c3-e/hub')], all: [R('c3-e/hub')] } };
    const calls = [];
    const clientFor = (login) => ({
      listRepos: async ({ sort }) => { calls.push(['repos', login, sort]); const v = repoLists[login]; if (v instanceof Error) throw v; return sort === 'pushed' ? v.pushed : v.all; },
      listDir: async (owner, repo, p) => { calls.push(['dir', login, `${owner}/${repo}`, p]); const v = listings.get(`${login} ${owner}/${repo} ${p}`); if (v instanceof Error) throw v; return v || { entries: [], truncated: false }; },
    });
    const accountList = [{ login: 'c3-sahn', source: 'gh' }, { login: 'seanahn', source: 'vscode' }];
    const accounts = { list: async () => accountList };
    const recent = createRecent(makeMemento());
    const local = createLocalRepos({ memento: makeMemento(), home: tmp });
    const tree = new GannetTree({ vscode, accounts, clientFor, recent, local });
    let fired = 0;
    tree.onDidChangeTreeData(() => fired++);
    const labels = async (node) => (await tree.getChildren(node)).map((n) => tree.getTreeItem(n).label);
    const item = (n) => tree.getTreeItem(n);

    // root: accounts; each has Recent and All repos
    const roots = await tree.getChildren();
    assert.deepStrictEqual(roots.map((n) => item(n).label), ['c3-sahn', 'seanahn']);
    assert.deepStrictEqual(roots.map((n) => [item(n).description, item(n).contextValue]), [['gh', 'account-gh'], ['VS Code', 'account-vscode']]);
    assert.ok(/Accounts menu/.test(item(roots[1]).tooltip), 'how to sign a VS Code account out');
    const sean = roots[1];
    const [recentNode, allNode] = await tree.getChildren(sean);
    assert.deepStrictEqual([item(recentNode).label, item(allNode).label], ['Recent', 'All repos']);

    // Recent: GitHub's pushed list, used ones first
    await recent.touch('seanahn', 'seanahn/roost');
    assert.deepStrictEqual(await labels(recentNode), ['seanahn/roost', 'seanahn/perch']);
    const [roostNode, perchNode] = await tree.getChildren(recentNode);
    assert.strictEqual(item(perchNode).description, 'private');
    assert.strictEqual(item(roostNode).description, 'archived');
    assert.strictEqual(item(perchNode).contextValue, 'repo-remote');
    assert.strictEqual(item(perchNode).iconPath.id, 'github-alt', 'the Octocat without the circle');

    // All repos: sorted, fetched once until refresh, with a count
    assert.deepStrictEqual(await labels(allNode), ['aa/first', 'c3-e/hub', 'seanahn/perch', 'seanahn/roost', 'zz/last']);
    await tree.getChildren(allNode);
    assert.strictEqual(calls.filter((c) => c[0] === 'repos' && c[1] === 'seanahn' && c[2] === 'full_name').length, 1);
    assert.strictEqual(item((await tree.getChildren(sean))[1]).description, '5');
    tree.refresh();
    assert.ok(fired >= 1);
    await tree.getChildren(allNode);
    assert.strictEqual(calls.filter((c) => c[0] === 'repos' && c[1] === 'seanahn' && c[2] === 'full_name').length, 2);

    // a remote repo's folders, lazily; opening it moves it to the top of Recent
    listings.set('seanahn seanahn/perch ', { entries: [E('src', 'dir'), E('big.bin', 'file', { size: 11 * 1024 * 1024 }), E('a.js', 'file'), E('lib', 'submodule'), E('link', 'symlink')], truncated: false });
    listings.set('seanahn seanahn/perch src', { entries: [E('x.js', 'file', { path: 'src/x.js' })], truncated: true });
    const top = await tree.getChildren(perchNode);
    assert.deepStrictEqual(top.map((n) => item(n).label), ['src', 'big.bin', 'a.js', 'lib', 'link']);
    assert.deepStrictEqual(await labels(recentNode), ['seanahn/perch', 'seanahn/roost']);
    const [srcNode, bigNode, aNode, libNode, linkNode] = top;
    assert.strictEqual(item(srcNode).collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    assert.strictEqual(item(aNode).collapsibleState, vscode.TreeItemCollapsibleState.None);
    assert.strictEqual(item(aNode).command.command, 'gannet.openFile');
    assert.strictEqual(item(aNode).contextValue, 'file');
    assert.strictEqual(item(bigNode).contextValue, 'file-large');
    assert.strictEqual(item(libNode).collapsibleState, vscode.TreeItemCollapsibleState.None, 'a submodule does not expand');
    assert.strictEqual(item(libNode).command.command, 'gannet.openUrl');
    assert.strictEqual(item(linkNode).collapsibleState, vscode.TreeItemCollapsibleState.None);
    assert.strictEqual(item(linkNode).command.command, 'gannet.openFile', 'a symlink opens as a file');
    // icons as VS Code's own explorer draws them: the file icon theme's, from the resource; folders take the
    // theme's folder icon (none in Seti), and files the File kind, so VS Code lines them up with the folders' arrows
    for (const n of [srcNode, aNode, linkNode]) assert.strictEqual(item(n).resourceUri.scheme, 'gannet', item(n).label);
    assert.strictEqual(item(srcNode).resourceUri.path, '/seanahn/perch/src');
    assert.strictEqual(item(srcNode).iconPath, vscode.ThemeIcon.Folder);
    assert.strictEqual(item(aNode).iconPath, vscode.ThemeIcon.File);
    // a folder over GitHub's 1,000-entry limit ends with a way to see the rest (Review Focus 1)
    const inSrc = await tree.getChildren(srcNode);
    assert.deepStrictEqual(inSrc.map((n) => item(n).label), ['x.js', 'More files — open on GitHub']);
    assert.strictEqual(item(inSrc[1]).command.command, 'gannet.openUrl');
    await tree.getChildren(srcNode);
    assert.strictEqual(calls.filter((c) => c[0] === 'dir' && c[3] === 'src').length, 1, 'cached');

    // an empty repo (Review Focus 2)
    listings.set('c3-sahn c3-e/hub ', new GitHubError('empty', 409, 'This repository is empty.'));
    const c3 = roots[0];
    const [c3Recent] = await tree.getChildren(c3);
    const [hub] = await tree.getChildren(c3Recent);
    assert.deepStrictEqual(await labels(hub), ['Empty repository']);
    assert.strictEqual(item(hub).contextValue, 'repo-remote', 'still offers Check out');

    // a checked-out repo lists the disk, .git hidden, and shows as local under every account (Review Focus 5)
    const dir = path.join(tmp, 'hub');
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'README.md'), 'hi');
    fs.writeFileSync(path.join(dir, 'docs', 'n.md'), 'n');
    await local.remember('c3-e/hub', { path: dir, login: 'c3-sahn', byGannet: true });
    tree.refresh();
    const [hubLocal] = await tree.getChildren((await tree.getChildren(c3))[0]);
    assert.strictEqual(item(hubLocal).contextValue, 'repo-local');
    assert.strictEqual(item(hubLocal).description, '● local');
    const onDisk = await tree.getChildren(hubLocal);
    assert.deepStrictEqual(onDisk.map((n) => item(n).label), ['docs', 'README.md']);
    assert.strictEqual(item(onDisk[1]).command.command, 'vscode.open');
    assert.strictEqual(item(onDisk[1]).resourceUri.fsPath, path.join(dir, 'README.md'));
    assert.strictEqual(item(onDisk[0]).iconPath, vscode.ThemeIcon.Folder);
    assert.strictEqual(item(onDisk[1]).iconPath, vscode.ThemeIcon.File);
    assert.deepStrictEqual((await tree.getChildren(onDisk[0])).map((n) => item(n).label), ['n.md']);
    const seanAll = await tree.getChildren((await tree.getChildren(sean))[1]);
    const hubUnderSean = seanAll.find((n) => item(n).label === 'c3-e/hub');
    assert.strictEqual(item(hubUnderSean).description, '● local');
    // found on disk with no account yet: offers Push as
    await local.remember('c3-e/hub', { path: dir, login: null, byGannet: false });
    assert.strictEqual(item(hubUnderSean).contextValue, 'repo-local-foreign');

    // errors stand in for an account's lists, or a folder's entries
    repoLists['c3-sahn'] = new GitHubError('auth', 401, 'Bad credentials');
    tree.refresh();
    let [err] = await tree.getChildren((await tree.getChildren(c3))[0]);
    assert.strictEqual(item(err).label, 'Signed out');
    assert.strictEqual(item(err).description, 'run gh auth login');
    repoLists.seanahn = new GitHubError('auth', 401, 'Bad credentials');
    tree.refresh();
    [err] = await tree.getChildren((await tree.getChildren(sean))[0]);
    assert.strictEqual(item(err).command.command, 'gannet.signIn');
    repoLists.seanahn = new GitHubError('sso', 403, 'SSO', { ssoUrl: 'https://github.com/orgs/c3-e/sso' });
    tree.refresh();
    [err] = await tree.getChildren((await tree.getChildren(sean))[0]);
    assert.strictEqual(item(err).contextValue, 'error-sso');
    assert.deepStrictEqual(item(err).command.arguments, ['https://github.com/orgs/c3-e/sso']);
    repoLists.seanahn = new GitHubError('rate', 403, 'rate', { retryAt: new Date(2026, 10, 25, 14, 5) });
    tree.refresh();
    [err] = await tree.getChildren((await tree.getChildren(sean))[0]);
    assert.strictEqual(item(err).label, 'Rate limited — try again at 14:05');
    repoLists.seanahn = { pushed: [R('seanahn/perch')], all: [R('seanahn/perch')] };

    // a repo GitHub no longer shows is dropped from Recent
    await recent.touch('seanahn', 'seanahn/gone');
    repoLists.seanahn.pushed = [R('seanahn/perch'), R('seanahn/gone')];
    tree.refresh();
    const goneNode = (await tree.getChildren((await tree.getChildren(sean))[0]))[0];
    assert.strictEqual(item(goneNode).label, 'seanahn/gone');
    listings.set('seanahn seanahn/gone ', new GitHubError('notFound', 404, 'Not Found'));
    assert.deepStrictEqual(await labels(goneNode), ['No longer on GitHub']);
    repoLists.seanahn.pushed = [R('seanahn/perch')];
    tree.refresh();
    assert.deepStrictEqual(await labels((await tree.getChildren(sean))[0]), ['seanahn/perch']);
    // review fix: a refused token is dropped, so after gh auth login and refresh the account works again
    {
      const forgotten = [];
      const t2 = new GannetTree({ vscode, accounts: { list: async () => accountList, forget: (l) => forgotten.push(l) }, clientFor: () => ({ listRepos: async () => { throw new GitHubError('auth', 401, 'Bad credentials'); } }), recent, local });
      const [acct] = await t2.getChildren();
      await t2.getChildren((await t2.getChildren(acct))[0]);
      assert.deepStrictEqual(forgotten, ['c3-sahn']);
    }
    console.log('TREE OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); });
