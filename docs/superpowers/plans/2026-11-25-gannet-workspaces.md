# Gannet Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use trivialpowers:subagent-driven-development (recommended) or trivialpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Workspaces view above Repos that lists workspace files and folders, and checks repos out into them.

**Architecture:** A new `src/workspaces.js` owns the list (global state), what this window's workspace is, and
reading/editing `.code-workspace` files. A new `src/workspaceTree.js` is the second view. `src/extension.js`
places a finished checkout into its target workspace; `src/checkout.js` is unchanged (it already reuses a repo
that is local anywhere).

**Tech Stack:** Plain JavaScript, Node's test runner style already in `test/` (plain `assert` scripts), stub
`vscode` in `test/stubs.js`, `jsonc-parser` for editing workspace files.

**Spec:** `docs/notes/101-gannet.md`, section **Workspaces** (and Checkout, Build details).

The design holds every design decision; this plan holds build steps and code-level names only, and is deleted
when the work merges. If a decision changes during the build, change the design in the same commit.

## Global Constraints

- VS Code ≥ 1.94; `extensionKind: ["workspace"]`; github.com only.
- One runtime dependency is allowed: `jsonc-parser` (^3.3.1). `make deps` runs `npm install --omit=dev`;
  `.vscodeignore` must keep `node_modules/jsonc-parser`.
- Never print or store a token. Never open a window except on Open / Open here.
- A repo already local anywhere is reused, never cloned again; its push account is unchanged.
- Workspace list key in global state: `gannet.workspaces`. Pending checkouts stay under `gannet.pending`.
- Tests: `make check test-offline` must stay green; every new test file is added to `test:offline`.
- Commits by Sean Ahn, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A workspace file with comments and trailing commas: adding a folder keeps both, and the file still opens.
2. Folder entries written relative (`"."`, `"../x"`, `"sub"`): resolved against the file's own folder.
3. This window is one folder that is itself a git repo: not listed; **Check out** goes to `gannet.checkoutFolder`.
4. The target file already lists the folder (absolute vs relative form): no duplicate entry.
5. The target workspace file is deleted or unparseable when the checkout finishes: the clone stays, a note
   names the clone and the file.

---

### Task 1: The workspace store and workspace files

**Files:**
- Create: `src/workspaces.js`
- Modify: `package.json` (dependency, `test:offline`), `Makefile` (`deps`), `.vscodeignore` (nothing to change if
  `node_modules` is not listed — verify)
- Test: `test/workspaces.test.js`

**Interfaces:**
- Produces, from `src/workspaces.js`:
  - `Workspace = { kind: 'file'|'folder', path: string, name: string, repoFolder?: string }`
    (`name`: basename without `.code-workspace`).
  - `createWorkspaces({ memento, home }) -> { list(): Workspace[], add(ws): Promise, remove(path): Promise,
    setRepoFolder(path, folder): Promise, get(path): Workspace|undefined }` — paths compared after `expandHome`
    and `path.resolve`; `add` of a known path is a no-op.
  - `currentWorkspace({ workspaceFile, workspaceFolders }) -> Workspace | { untitled: true } | null` — saved
    `file:` workspaceFile → file kind; `untitled:` workspaceFile → `{ untitled: true }`; exactly one folder that
    is not a git repo → folder kind; one folder that is a git repo, or none → `null`.
  - `readFolders(file) -> string[]` absolute paths of `folders[].path` (resolved against the file's folder);
    `uri` entries skipped; throws on unreadable file or parse errors.
  - `addFolderToFile(file, folder) -> Promise<'added'|'present'>` — re-reads the file, uses `jsonc-parser`'s
    `modify` + `applyEdits` to append `{ "path": <rel or abs> }`; relative (posix separators) when `folder` lies
    under the file's folder, else absolute; `'present'` when an entry already resolves to `folder`.
  - `createWorkspaceFile(dir, name) -> string` writes `<dir>/<name>.code-workspace` as
    `{\n\t"folders": [],\n\t"settings": {}\n}\n`; throws if it exists.
  - `repoFolderOf(ws) -> string` — folder kind: `ws.path`; file kind: `ws.repoFolder`, else the parent folder
    shared by the most of `readFolders` (ties: the first such parent in file order), else `dirname(ws.path)`;
    a file that cannot be read gives `dirname(ws.path)`.
  - `foldersOf(ws) -> string[]` — file: `readFolders`; folder: its non-hidden subfolders, minus partial clones,
    sorted case-insensitively.
  - `exists(ws) -> boolean`, `isGitRepo(dir) -> boolean` (a `.git` file or folder).

- [ ] **Step 1: Write the failing tests** in `test/workspaces.test.js` (tmp dirs, `makeMemento`):
  - store: `add` twice → one entry; `remove` → gone; `setRepoFolder` persists; `get('~/x')` finds `<home>/x`.
  - `currentWorkspace`: `{ workspaceFile: Uri.file('/a/f.code-workspace') }` → `{kind:'file', name:'f'}`;
    `Uri.parse('untitled:Untitled-1')` → `{untitled:true}`; one plain folder → folder kind; one folder with `.git`
    → `null`; two folders and no file → `null`; no folders → `null`.
  - `readFolders` on `{ // c\n "folders": [ {"path": "."}, {"path": "../x"}, {"uri": "vscode-remote://h/p"}, ], }`
    in `<t>/w/` → `[<t>/w, <t>/x]`; garbage text → throws.
  - `addFolderToFile`: the commented file above gains `<t>/w/new` as `"new"` and `/elsewhere/r` as absolute;
    afterwards the text still contains `// c`, `JSON` parse via `jsonc-parser` has 4 folders; adding `<t>/w/new`
    again → `'present'`; adding `<t>/x` (listed as `../x`) → `'present'` (Review Focus 1, 2, 4); missing file →
    rejects.
  - `createWorkspaceFile` writes exactly the text above; a second call throws.
  - `repoFolderOf`: folders `/git/a`, `/git/b`, `/home/c` → `/git`; set `repoFolder` wins; empty folders →
    the file's folder; unreadable file → the file's folder; folder kind → its path.
  - `foldersOf` folder kind skips `.hidden` and `x.gannet-partial-1`.

- [ ] **Step 2: Run** `node test/workspaces.test.js` — Expected: FAIL, `Cannot find module '../src/workspaces.js'`.
- [ ] **Step 3:** `npm install jsonc-parser@^3.3.1` (adds `dependencies`); `Makefile` `deps:` runs
  `npm install --omit=dev --silent`; implement `src/workspaces.js`.
- [ ] **Step 4: Run** `node test/workspaces.test.js` — Expected: `WORKSPACES OK`. Add it to `test:offline`
  after `state.test.js`; run `make check test-offline` — Expected: all suites OK.
- [ ] **Step 5: Commit** `feat: workspace list and workspace files`.

### Task 2: The Workspaces view

**Files:**
- Create: `src/workspaceTree.js`
- Modify: `src/tree.js` (export the disk helpers it already has, no behaviour change)
- Test: `test/workspaceTree.test.js`

**Interfaces:**
- Consumes: Task 1's `foldersOf`, `exists`, `isGitRepo`; `parseOrigin`, `originOf`, `isDir` from
  `src/localRepos.js`; `local.get(fullName)`.
- Produces:
  - from `src/tree.js`: `diskChildren(dir) -> node[]` (the current `diskDir`) and
    `diskTreeItem(vscode, node) -> TreeItem` (the current `'disk'` case); `GannetTree` uses both.
  - `class WorkspaceTree({ vscode, workspaces, local, current: () => Workspace|{untitled:true}|null })` with
    `getChildren`, `getTreeItem`, `refresh()`, `onDidChangeTreeData`.
  - Nodes: `{ kind:'workspace', ws, current: boolean }`, `{ kind:'untitled' }`,
    `{ kind:'wsrepo', path, fullName, ws }` (a folder whose origin is on github.com),
    `{ kind:'disk', path, dir }` (any other folder, and everything below), `{ kind:'info', label }`.
  - Context values: `workspace`, `workspace-current`, `workspace-missing`, `repo-local`, `repo-local-foreign`.

- [ ] **Step 1: Write the failing tests** in `test/workspaceTree.test.js`:
  - root with stored `[folder A, file B]` and current = B → B first, labelled `B`, description
    `● this window`, contextValue `workspace-current`; A's description is its path with `~` for home; current =
    `{untitled:true}` → a last node labelled `Untitled workspace — save it to list it`.
  - a workspace whose path is gone → description `Missing`, contextValue `workspace-missing`, no children, state
    `None`.
  - workspace item `command` is `gannet.openWorkspace` with `[node]`; file kind icon `folder-library`, folder kind
    icon `root-folder`.
  - children of file B (folders `<t>/r1` with origin `https://github.com/o/r1.git`, `<t>/plain`) → `r1`
    (`wsrepo`, fullName `o/r1`, contextValue `repo-local-foreign`; after `local.remember('o/r1', {login:'sean'})`
    → `repo-local`, description contains `sean`) and `plain` (`disk`, collapsible); expanding `r1` lists its
    files with `.git` hidden; a listed folder missing on disk → `disk` node whose children are
    `Not found on disk`.
  - an unreadable file workspace → one `info` child `Cannot read <path>`.
  - `tree.test.js` still passes unchanged (the helper export is a refactor).
- [ ] **Step 2: Run** `node test/workspaceTree.test.js` — Expected: FAIL, module not found.
- [ ] **Step 3:** export `diskChildren`/`diskTreeItem` from `src/tree.js`; implement `src/workspaceTree.js`.
  Workspace order: current first, then the rest by name.
- [ ] **Step 4: Run** `node test/workspaceTree.test.js && node test/tree.test.js` — Expected: `WORKSPACETREE OK`,
  `TREE OK`. Add to `test:offline`; `make check test-offline` green.
- [ ] **Step 5: Commit** `feat: Workspaces view`.

### Task 3: Wiring — commands, checkout placement, manifest

**Files:**
- Modify: `src/extension.js`, `package.json`, `test/stubs.js`, `test/host.test.js`

**Interfaces:**
- Consumes: Tasks 1–2; `createCheckout().checkout({repo, account, folder, …}) -> {path, existing}` (unchanged).
- Produces:
  - Pending job shape `{ repo, account, folder, workspace: Workspace|null }`.
  - `place(path, ws) -> Promise` in `extension.js`: `ws` null → append to this window (today's
    `addToWorkspace`); `ws` is this window's file → `addToWorkspace`; this window's folder → nothing if `path`
    is inside it, else info `<repo> is already checked out at <path>` with `Reveal in Explorer`; another file →
    `addFolderToFile`, on failure warning `Checked out to <path>, but could not update <file>: <reason>`;
    another folder → same rule as this window's folder.
  - Commands: `gannet.addWorkspace`, `gannet.openWorkspace`, `gannet.openWorkspaceHere`,
    `gannet.removeWorkspace`, `gannet.setRepoFolder`.
  - Stub additions in `test/stubs.js`: `opts.workspaceFile` (path or `'untitled'`) behind
    `workspace.workspaceFile`; `window.showQuickPick(items)` answered by `opts.quickPick(items)`;
    `window.showInputBox()` answered by `opts.inputBox`; `workspace.onDidChangeWorkspaceFolders`;
    `window.createTreeView` already records ids.

- [ ] **Step 1: Write the failing tests** in `test/host.test.js` (new blocks, each with its own context):
  - activation with `workspaceFile` = `<t>/ws/main.code-workspace` (folders `../git/a`): the list stores it
    (`gannet.workspaces`), both views are registered with `gannet.workspaces` before `gannet.repos`, every
    manifest command is registered (the existing loop), and a dead partial in `<t>/git` is removed (repo folder
    `<t>/git`).
  - **Check out** with that window → cloned to `<t>/git/perch`, `updateWorkspaceFolders` called with it.
  - folder window `<t>/home` (no `.git`) → listed; **Check out** clones to `<t>/home/perch` and makes no
    `updateWorkspaceFolders` call.
  - folder window that is a git repo → not listed; **Check out** clones under `gannet.checkoutFolder`
    (Review Focus 3).
  - **Check out to…** with quick pick choosing another file workspace `<t>/other.code-workspace` → clone in its
    repo folder, the file lists it, no `updateWorkspaceFolders` call; the quick pick items exclude a Missing
    workspace and end with `Other folder…`.
  - the same repo checked out again into a third workspace → no second clone (only one `git clone`), that file
    lists the existing path.
  - target file deleted before the clone finishes (delete it in the quick-pick callback) → clone exists, a
    warning mentioning both paths (Review Focus 5).
  - pending job `{…, workspace: <other file ws>}` in a fresh context → resumed into that file, no
    `updateWorkspaceFolders`.
  - `gannet.addWorkspace` with quick pick `New workspace…`, input box `team`, open dialog `<t>/new` → file
    `<t>/new/team.code-workspace` exists and is listed; `Add folder…` lists the picked folder;
    `gannet.removeWorkspace` forgets it and leaves the file; `gannet.openWorkspace` executes `vscode.openFolder`
    with the file Uri and `{ forceNewWindow: true }`; `gannet.openWorkspaceHere` with `{ forceNewWindow: false }`;
    `gannet.setRepoFolder` stores the picked folder.
- [ ] **Step 2: Run** `node test/host.test.js` — Expected: FAIL on the first new assertion.
- [ ] **Step 3: Implement.**
  - `package.json`: view `gannet.workspaces` ("Workspaces") listed before `gannet.repos`; the five commands
    (titles `Add Workspace` with `$(add)`, `Open Workspace in New Window`, `Open Workspace Here`,
    `Remove from List`, `Set Repo Folder…`), hidden from the palette except `gannet.addWorkspace`;
    `view/title` `gannet.addWorkspace` on `view == gannet.workspaces`; `view/item/context` for
    `viewItem =~ /^workspace/` (open, open here, remove; set repo folder only for file kind — use context
    values `workspace-file` / `workspace-folder` suffixes if needed and update Task 2's tests); repo menus
    (`revealLocal`, `pushAs`, `openOnGitHub`) also on `view == gannet.workspaces`.
  - `extension.js`: on activation `currentWorkspace` → `workspaces.add` when it is a Workspace; scan and
    clean partials for `checkoutFolder()` and every listed, existing workspace's `repoFolderOf`; refresh
    the Workspaces view on `onDidChangeWorkspaceFolders` and after a checkout.
  - **Check out**: target = this window's workspace if it is one, else `null`; folder = `repoFolderOf(target)`
    or `checkoutFolder()`.
  - **Check out to…**: quick pick of existing workspaces (this window's first, label = name, description =
    `this window` or the path) then `Other folder…` (the old picker, target `null`).
  - `pushAs` on a `wsrepo` node (no account): quick pick of `accounts.list()` logins first.
- [ ] **Step 4: Run** `make check test-offline` — Expected: all suites OK, `HOST OK`.
- [ ] **Step 5: Commit** `feat: check out into workspaces`.

### Task 4: Close-out

**Files:** `docs/notes/101-gannet.md`, `README.md`, `package.json`, `Makefile`, this plan.

- [ ] **Step 1:** Design: status line `Built, <date> (0.2.0)`; copy every `Ruling:` from the ledger that changes
  the design into Workspaces/Build details; record "Built on `main` with no PR; the Workspaces plan was last
  present at `<sha>`"; update the checkout diagram's `Check out to…` and target-picking lines to the workspace
  rules.
- [ ] **Step 2:** README: a Workspaces section (what it lists, +, Check out rules), linking the design (the design
  already links README).
- [ ] **Step 3:** `package.json` version `0.2.0`; `Makefile` `OLD_IDS = seanahn.gannet-0.1.0`.
- [ ] **Step 4:** Run `make check test` — Expected: all suites OK including `LIVE OK`.
- [ ] **Step 5:** Delete this plan; commit `docs: Gannet Workspaces built; drop the plan`.
