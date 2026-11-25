# 101 — Gannet: GitHub as a drive in VS Code

Built, 2026-11-25 (0.1.0); Workspaces built, 2026-11-25 (0.2.0); 0.3.0 (owners, workspace directories) designed, not built. How to build, install and use it: [README.md](../../README.md).
Built on `main` with no PR (the first commits of a new repo); the build plan was last present at `0569daa`.
Workspaces were also built on `main` with no PR; their plan was last present at `701cd3b`.

## Intent

VS Code's file explorer starts from the disk: a folder is opened, and it may happen to be a git repo. Gannet
starts from the other end — from what GitHub says is available to you — the way Google Drive shows your files
before any of them are downloaded. You browse a repo's files without having it locally, and when you want one,
you check it out. *(Sean)*

The why, as guessed and not corrected: Sean works across several GitHub accounts and orgs (seanahn, c3-sahn and
C3's orgs), and finding a repo, then cloning it into the right place with the right account, takes too many
steps today. *(guess)*

### Goals

- A new VS Code extension, separate from Perch. *(Sean)*
- Several GitHub accounts, with a way to configure them. *(Sean)*
- Accounts come from the `gh` CLI (every account it is logged into) **and** from VS Code's GitHub login, through
  which more can be added. *(Sean)*
- The tree's root shows the most recently used repos; an **All repos** entry opens the full list of every repo
  you can reach. *(Sean)*
- A folder's contents are fetched from GitHub only when it is expanded, while the repo is only on GitHub. *(Sean)*
- Files of a repo not checked out open read-only. *(Sean)*
- Check out into one default folder, or into any location you pick. *(Sean)*
- A checked-out repo is added to the current workspace; no new window opens. *(Sean)*

### Non-goals

- Branch switching while browsing, pull requests, issues — "that's going too far". *(Sean)* Browsing shows the
  repo's default branch only.
- Editing or committing through GitHub's API. Editing happens after checkout, on disk. *(Sean)*
- Replacing VS Code's file explorer or its git support; after checkout, those take over. *(builder's call)*

### Anti-goals

- Gannet stores or prints a token. Tokens are read when needed (from `gh`, or from VS Code's session) and kept in
  memory only. *(builder's call, in line with how Sean's other extensions treat tokens)*
- Gannet changes `gh`'s setup or the machine-wide git configuration. The one exception is each checked-out
  repo's own `.git/config`, set up to push as its account (see Checkout). *(Sean chose the exception)*

## How it is made

Same setup as Perch, all builder's calls Sean has not objected to:

- Plain JavaScript, no bundler; Node's test runner with stubs of `vscode`; a Makefile with `test-offline`
  (no network) and `test` (live, against GitHub with a real account).
- Repo `/git/gannet`, `github.com/seanahn/gannet`; publisher `seanahn`, extension id `seanahn.gannet`; MIT.
- `extensionKind: ["workspace"]`: under Remote-SSH (seclab) it runs on the remote machine, so checkouts land
  there and the `gh` logins used are the remote machine's.
- GitHub's REST API over `fetch`, no Octokit.

## What the user sees

Its own icon in the activity bar, **Gannet**, holding one tree view.

```
GANNET                                   [+ account] [⟳]
▾ seanahn                               (gh)
  ▾ Recent
    ▸ seanahn/perch            ● local
    ▸ seanahn/roost
    ▸ c3-e/seclab-hub
  ▸ All repos  (143)
▾ c3-sahn                               (VS Code)
  ▸ Recent
  ▸ All repos
```

### Accounts

- Each account is a top-level node, labelled with its login and where it came from: `gh` or `VS Code`.
- **From gh:** every github.com account `gh auth status` lists. The token for an account is read with
  `gh auth token --user <login>` each time it is needed after a restart, then kept in memory.
- **From VS Code:** `vscode.authentication` with the `github` provider and the `repo` scope; VS Code keeps the
  sign-in. The **+ account** button runs VS Code's GitHub sign-in, letting the user pick another account.
- The same login from both sources shows once; gh's token is preferred. *(builder's call)*
- **Configure:** a setting `gannet.hiddenAccounts` (logins not to show), with a **Hide account** action on an
  account node that adds to it. Hiding never touches gh, nor VS Code's sign-in. An extension cannot sign out of
  VS Code's built-in GitHub session, and doing so would sign the account out of every extension using it
  (Copilot too), so for a VS Code account Hide is the whole of "remove"; the node's tooltip says to use VS Code's
  Accounts menu to sign out. *(builder's call)*
- github.com only for now; GitHub Enterprise hosts that gh knows about are left for later. *(builder's call)*

### Recent

- Up to 10 repos per account, most recent first. *(builder's call on the number)*
- "Recent" is made of two lists merged: repos the user opened, browsed into or checked out **in Gannet**
  (remembered per account in the extension's global state), then topped up with GitHub's own
  `GET /user/repos?sort=pushed`. *(builder's call — Sean said "most recently used"; GitHub cannot tell us
  what Sean used, only what was pushed)*

### All repos

- Expanding it fetches every repo the account can reach (`GET /user/repos`, owner + collaborator + org member,
  all pages), sorted by `owner/name`, shown as a flat list. *(builder's call; grouping by owner is possible
  later)*
- Fetched once per session and cached; the ⟳ button refreshes. *(0.3.0: cached on disk across sessions, see
  below)*
- Opening a repo from here puts it at the top of Recent.

### A repo node

- Label `owner/name`; description shows **● local** when checked out, and **private** / **archived** when so.
- Expanding a repo that is only on GitHub lists its root from GitHub; expanding a subfolder fetches that folder
  only then (`GET /repos/{owner}/{repo}/contents/{path}` on the default branch), cached for the session.
- Expanding a checked-out repo lists the files **on disk** instead, editable like any local file. *(guess Sean
  did not correct)*
- Actions on a repo node: **Check out**, **Check out to…**, **Open on GitHub**. A checked-out repo instead has
  **Reveal in Explorer** and **Add to workspace** (if it was removed from it). *(builder's call)*

### A file, before checkout

- Clicking opens it in an editor, read-only, through a `gannet:` file system provider
  (`gannet://<login>/<owner>/<repo>/<path>`) that fetches the file's raw content on read.
- Binary files open the way VS Code opens any binary file. Files over 10 MB show a note instead and offer
  **Open on GitHub**. *(builder's call on the size)*

## Owners and workspace directories (0.3.0)

0.3.0 replaces how 0.2.0 grouped the tree, and replaces its Workspaces design. Where this section and the older
sections above or below disagree, this section wins. *(Sean, on seeing 0.2.0 on seclab: "not quite what i was
thinking of")*

```
GANNET
▾ WORKSPACES                                    [+]
    /git
    ~/github
▾ REPOS                                         [+ account] [⟳]
  ▾ c3-e                     via c3-sahn
      c3reliability          private
      c3nexus                ~/ · /git            (green Octocat: checked out)
      ▸ All repos
  ▸ c3-sahn
  ▸ c3-taehokgil             via c3-sahn
  ▾ seanahn
      perch                  /git
      ▸ All repos
```

### The tree is grouped by owner

- The top-level nodes are **owners**, meaning the GitHub users and organizations whose repos an account can reach,
  labelled with the owner alone: `c3-e`, `c3-sahn`, `c3-taehokgil`, `seanahn`. There are no account nodes. *(Sean:
  "c3-e, c3-sahn, c3-taehokgil and seanahn nodes")* An owner reached through an account with another login says
  so in its description: `via c3-sahn`. *(builder's call, in place of 0.3.0's first draft `c3-e (c3-sahn)`)*
- An owner reachable through two accounts gets two nodes, one per account, told apart by their `via`.
  *(builder's call)*
- **Which start expanded:** an account's organizations start expanded; the account's own login and other users'
  owners start collapsed, unless the account has no organizations, when its own login starts expanded. So
  `c3-e` and `seanahn` open, `c3-sahn` and `c3-taehokgil` closed. *(Sean: "collapse all others except for
  c3-e"; the rule is the builder's)* Owner nodes carry ids, so VS Code remembers what Sean opens or closes
  after that.
- The owners shown for an account:
  - the account's own login;
  - its organizations (`GET /user/orgs`);
  - owners of repos it recently pushed to;
  - once its full repo list has been fetched, any other owner in that list (a repo you collaborate on).
  *(builder's call)*
- Order: by owner name, then by account (`c3-e`, `c3-sahn`, `c3-taehokgil`, `seanahn`), as Sean listed them.
  Owner names are compared ignoring case, as GitHub does. *(builder's call)*
- If `/user/orgs` fails for an account (a token without `read:org`, say), its owners still come from its repos;
  none of them starts expanded as an organization. *(builder's call)*
- Repo names drop the owner: `c3reliability`, not `c3-e/c3reliability`. *(Sean)*
- **Each owner node lists its recent repos, then an All repos link** that expands to every repo of that owner the
  account can reach. *(Sean: "per owner")* Recent per owner works as before (repos used in Gannet first, then
  GitHub's recently pushed list), filtered to that owner, at most 10. All repos is the account's full list,
  fetched once and shared by all its owner nodes, filtered to the owner.
- **The full list is cached on disk, once read.** Fetching every page takes long for an account that reaches many
  repos, so after the first fetch each account's list is kept in a file in Gannet's global storage and used on
  every later start, in every window, with no fetch. Only ⟳ fetches it again (and replaces the file); the
  tooltip on All repos says when it was fetched. *(Sean: "cache the list once read")* With the list on disk, the
  owners found in it (such as `c3-taehokgil`) show from the start. A repo created since shows in Recent once
  pushed to, and in All repos after ⟳. *(builder's call)*
- Account things live on the account's own node:
  - its source (`gh` or `VS Code`) in the tooltip;
  - **Hide account**;
  - a signed-out or rate-limit error in place of its children. A signed-out account lists no organizations, since
    they cannot be fetched.
  *(builder's call)*

### Checked-out repos

- A repo checked out anywhere on this machine has a **green Octocat** (`github-alt` coloured `charts.green`),
  instead of 0.2.0's clone icon. *(Sean)*
- Its description lists the workspaces it is checked out in, after private/archived, e.g. `~/ · /git`. *(Sean:
  "each repo may say - <workspace>")* A checkout in a folder outside every workspace shows that folder's parent.
- **A repo can be checked out more than once**, into different folders. *(Sean)* This reverses 0.2.0's "one copy
  per repo".
- Expanding a repo:
  - with one checkout, it lists that checkout's files from disk;
  - with more than one, it lists one node per checkout (its path, e.g. `/git/perch-2`), each expanding to its
    files;
  - with none, it lists the files on GitHub, as before.
  *(builder's call)*
- **Reveal in Explorer** and **Push as** act on one checkout. On a repo with more than one checkout they are on each
  checkout node. *(builder's call)*

### Workspaces are directories

- The **Workspaces** panel stays a separate view above the tree. It is a small settings panel: a list of
  directories that hold checkouts, e.g. `/git` and `~/github` locally, `~/` on seclab. *(Sean: "workspace can
  just be managing workspace directories … a little configuration panel on top")*
- A workspace node shows the directory (with `~` for home), with the full path as its tooltip. It does not expand.
  A directory that no longer exists shows **Missing**. *(builder's call)*
- **+** picks a directory and adds it; **Remove from list** forgets one and deletes nothing; **Reveal** shows it in
  the system's file manager. *(builder's call)*
- `.code-workspace` files are no longer workspaces, and Gannet no longer edits them. That drops the `jsonc-parser`
  dependency. *(builder's reading of "managing workspace directories", stated to Sean and not corrected)*
- Nothing is added to the list automatically, except once, on upgrading: 0.2.0's list carries over (its folders
  as they are, each workspace file replaced by its repo folder), and so does the `gannet.checkoutFolder` folder
  (`~/github` by default) if it exists, so earlier users keep checking out there without being asked. The setting
  is then retired. *(builder's call)*
- A checkout belongs to the deepest listed workspace that contains it (with `~/` and `~/github` both listed,
  `~/github/perch` shows as `~/github`). *(builder's call)*
- The list stays per machine, in `machine.json`, as in 0.2.0.
- Every listed workspace is scanned on start for clones, by their `origin`. A
  workspace can hold several clones of one repo. Partial clones of dead windows are removed there too.

### Checking out

- **Check out** *(Sean)*:
  - **No workspace yet:** it asks for a directory, suggesting `~/github`, and saves it as a workspace. *(builder's
    guess, not corrected)*
  - **One workspace:** the repo goes there, with no question.
  - **Several:** a quick pick of the workspaces chooses where; the first entry is the workspace that holds the
    most folders of this window. *(builder's call on the order)*
  - **Already checked out:** the quick pick is shown even with one workspace, so Sean decides where the next copy
    goes; it ends with **Other folder…**. *(Sean; builder's call on Other folder…)*
  - **Missing** workspaces are not offered; when every workspace is Missing, it is as if there were none.
    *(builder's call)*
- **Folder name:** the first free one of `<repo>`, `<owner>-<repo>`, `<repo>-2`, `<repo>-3`, … — so a second copy
  in the same workspace is `<repo>-2`, with no prompt. A folder is never reused, by **Check out** or **Check out
  to…**: 0.1.0's "same repo already there: just remember and add it" is gone, since a checkout already there is
  already listed; the folder can be renamed later,
  since Gannet finds checkouts by their `origin`. *(Sean chose no prompt)*
- **Check out to…** still picks any folder for one checkout, without adding it to the list. *(builder's call)*
- Every copy pushes as the account it was checked out from. *(Sean, from 0.1.0)*
- After cloning, the folder is added to the open window, unless it already sits inside one of the window's
  folders (seclab, where the window is `~/`). *(as 0.2.0)* No window is ever opened.
- A checkout cut off by an extension restart is resumed by the next start of the same window's extension host,
  as in 0.2.0. The pending record names the target folder once it is chosen; if that folder already holds the
  clone when the job resumes (the restart came after the rename), the job only finishes setting it up and adding
  it, and never clones a copy. *(builder's call, from the builder check)*
- Unchanged from 0.1.0: the token is fetched before git runs (stop with the signed-out error if there is none),
  one clone at a time, progress with **Cancel**, and if VS Code refuses the folder a note offers **Add to
  workspace**.

```
 User            Tree               Workspaces list       git / Disk              This window
  |                |                      |                    |                        |
  |-- Check out -->|-- list ------------->|                    |                        |
  |                | [none / all Missing]  ask a directory (suggest ~/github), save it; [cancel] stop |
  |                | [one]   use it        |                    |                        |
  |                | [several, or already checked out]  quick pick of workspaces        |
  |<-- pick -------|                      |                    |                        |
  |                |-- first free name: <repo>, <owner>-<repo>, <repo>-2… ->|              |
  |                |-- pending {repo, account, target} in machine.json  |                       |
  |                |-- token; clone into a partial folder (queue, progress, Cancel), rename ->|    |
  |                | [fails / Cancel]  partial removed, git's error shown              |
  |                |-- push as the account; remember this checkout  |                       |
  |                |-- add to window, unless inside one of its folders --------------------->|
  |                | [refused]  note with Add to workspace;  then clear pending                 |
  |                | [restart after the rename]  resume finds the clone at target: set up + add, no new clone |
  |<-- green Octocat, "~/ · /git" ---------|                    |                        |
```

## Checkout

- **Default folder:** setting `gannet.checkoutFolder`, default `~/github`. A repo goes to `<folder>/<repo>`; if
  that folder is taken by a different repo, `<folder>/<owner>-<repo>`. *(Sean: one folder by default;
  builder's call on the name and on clashes)*
- **Check out to…:** a folder picker; the repo is cloned into `<picked>/<repo>`.
- Cloning runs `git clone https://github.com/<owner>/<repo>.git` with the account's token passed for that one
  command in git's environment (`GIT_CONFIG_COUNT`/`KEY`/`VALUE`), never on the command line where other users
  of the machine could read it, and never in `.git/config`. The remote stays a plain https URL. *(builder's
  call; moved off the command line after review)*
- **The repo pushes as the account it came from.** *(Sean)* After the clone, Gannet writes, in that repo's
  `.git/config` only:
  - `credential.https://github.com.helper` first set empty (so the machine's helpers are skipped for this repo),
    then a Gannet helper, and `credential.https://github.com.username = <login>`;
  - for a **gh** account the helper answers git with `gh auth token --user <login>`, run each time git asks, so
    no token is stored and it works from any terminal; *(builder's call on the mechanism)*
  - for a **VS Code** account the token lives only in VS Code, so the helper is a small script shipped with
    Gannet that asks the running Gannet for it over a local socket readable only by the user. Pushes from
    VS Code work; from a terminal with VS Code closed they fail with a message saying to open VS Code or add
    the account to gh. *(builder's call)*
  - A repo recognised as local but not cloned by Gannet (found in the default folder) is left as it is, with a
    **Push as <login>** action on its node that writes the same settings. *(builder's call)*
  - Commit author (`user.name`, `user.email`) is not changed. *(builder's call)*
- If the account has no usable token, checkout stops before git runs, with the signed-out error.
- If the target folder already exists: the same repo (matching `origin`) is treated as already checked out and
  just remembered and added; anything else picks the `<owner>-<repo>` name, and if that is taken too, asks for a
  location.
- Progress shows in a notification with **Cancel**; cancelling stops git and removes the partial folder.
- One clone at a time; a second **Check out** waits in a queue. Git clones into `<target>.gannet-partial-<pid>`
  (the window's process) and is renamed when it succeeds. On start Gannet removes the partial folders in the
  checkout folder whose window is gone, never one another window is still filling. *(builder's call)*
- A checkout is kept in `machine.json` (with the process of the window doing it) until it is in its workspace, so one cut off by an extension restart is
  started again on the next start. *(builder's call, after review)*
- After a successful clone, the folder is appended to the current workspace with
  `vscode.workspace.updateWorkspaceFolders`; no new window. *(Sean)* Note: adding a second folder to a
  single-folder window turns it into an untitled multi-root workspace, and VS Code restarts extensions when
  that happens; Gannet must cope with being restarted right after a checkout.
- Where each repo was checked out is remembered (`machine.json`, per machine; 0.1.0's entries in global state
  are carried over once, and those not on this machine's disk dropped). On start Gannet also recognises
  clones already sitting in the default folder by their `origin` URL, so repos cloned by hand show as local.
  A remembered folder that no longer exists **on disk** is forgotten (not one that is merely missing from the
  workspace, since right after a restart the workspace may not list it yet). If `updateWorkspaceFolders`
  refuses, the repo stays checked out and remembered, and a note offers **Add to workspace**.

## Errors

- A gh account whose `gh auth token` fails, or any account whose token GitHub refuses (401): the account node
  shows **signed out**, with **Sign in** (VS Code accounts) or a note to run `gh auth login` (gh accounts).
- Rate limit (403/429 with the rate-limit headers): the node shows the error and when to try again.
- An org that enforces SAML SSO and has not authorized the token: GitHub answers 403 with an `X-GitHub-SSO`
  header. The node says the org needs authorizing, with **Authorize** opening the URL from that header. In All
  repos, such orgs' repos are simply missing (GitHub leaves them out); a 403 with the SSO header on any call is
  reported this way, never as a rate limit. *(builder's call — C3's orgs may enforce SSO)*
- The `gannet:` provider asks Accounts for the token itself, so a read-only editor restored after a restart
  works; if the token is gone it shows the signed-out error in place of the file.
- A repo the account cannot see any more (404): removed from Recent.
- Clone failure: git's last error line in the notification; the partial folder is removed.

## Build details

Rulings settled while planning the build, all builder's calls:

- VS Code ≥ 1.94, for `vscode.authentication.getAccounts`.
- Recent merges the repos used in Gannet (most recent first, only those GitHub still lists) with GitHub's
  `sort=pushed` list, without duplicates, at most 10.
- A folder of more than 1,000 entries (GitHub's contents API limit) ends with an item **More files — open on
  GitHub**. An empty repo expands to **Empty repository** and can still be checked out. Submodules and symlinks
  do not expand; a submodule opens its repo on GitHub.
- Clone sign-in is `http.https://github.com/.extraHeader=Authorization: Basic base64("x-access-token:<token>")`
  plus `credential.helper=` (so a refused token fails instead of quietly cloning as gh's active account), both in
  git's environment; git's error line is shown with the token masked. Needs git ≥ 2.31.
- A gh account's push helper, in the repo's `.git/config`:
  `!f() { test "$1" = get || exit 0; echo username=<login>; echo password=$(gh auth token --hostname github.com --user <login>); }; f`.
- A VS Code account's push helper is `!"<shim>" <login>`. The shim, `gannet-credential` in Gannet's global
  storage folder (a path that survives updates), is rewritten on every start to run the current VS Code's own
  Node (`ELECTRON_RUN_AS_NODE=1 <execPath>`) on `bin/gannet-credential.js`. Every VS Code window serves its own
  socket, `token-<pid>.sock` (0600, in `<global storage>/sockets`, 0700; under the temp folder if the path would
  be too long); the helper tries each, moving past a window that does not hold the account, and removes dead
  ones. The line protocol is `<login>` in, `ok <token>` or `err <message>` out.
- When the window cannot serve tokens — the socket fails, or on **Windows**, where this is not supported — a
  VS Code account's checkout gets no push settings at all (a warning says so) and is remembered with no account,
  so it uses the usual git sign-in and offers **Push as** later. gh accounts work everywhere.
- Repos found on disk but not cloned by Gannet are remembered with no account, and offer **Push as <login>**.
  Checking out a repo already local, from any account, only adds it to the workspace and keeps its push account.
- Hidden accounts are written to the user (global) settings.
- GitHub reports an empty repo's root as 404 "This repository is empty." (not 409), and lists a submodule inside
  a folder as a `file` with no `download_url`; both are recognised.
- **Push as** can be run again on a repo already set up: it clears the earlier helpers first. Repo names are
  matched without regard to case.
- A refused token is dropped from memory, and ⟳ drops every cached token, so `gh auth login` then ⟳ is enough.
- Recent's pool is one page (100) of GitHub's recently pushed repos plus All repos once opened; a repo used in
  Gannet but in neither is not shown until All repos is opened. A repo GitHub answers 404 for shows **No longer
  on GitHub** and leaves Recent. Tree items carry no ids, since a repo shows under both Recent and All repos.
- **Sign in** on a signed-out VS Code account runs VS Code's account picker. **Reveal in Explorer** reveals the
  folder in VS Code's explorer when it is a workspace folder, and in the system's file manager otherwise.
- Workspaces (0.2.0):
  - An edit to a workspace file follows the file's own indentation (tabs, or the width of its spaces) and line
    endings, so the lines it does not touch stay as they were.
  - A new window resumes only the checkouts whose window is gone, so opening a workspace while a checkout runs
    does not start it twice. An extension-host restart is a new process, so its cut-off checkouts are resumed.
  - **Add folder…** refuses a folder that is itself a git repo, so Check out never clones inside a repo.
  - On a workspace: an inline **Open in new window** button; **Open here** is not offered on this window's own
    workspace; **Set repo folder…** only on workspace files.
  - Workspace files are edited with `jsonc-parser` (`modify` + `applyEdits`), Gannet's one runtime dependency,
    so comments, trailing commas and other settings survive. A folder already listed, in either absolute or
    relative form, is not added twice; `uri` entries (remote folders) are ignored.
  - A workspace file's repo folder is the parent folder shared by the most of its folders, with ties going to the
    first such parent in the file. If there are no folders, or the file can't be read, it's the file's own folder.
  - This window's workspace is added to the stored list on activation, so other windows on the machine see it.
  - **Push as** on a repo in the Workspaces view asks which account first, since a folder there has none.
  - **New workspace…** writes `{"folders": [], "settings": {}}`, and refuses a name that already exists.
- Known gaps, left for later: the All repos count does not show; **More files** links break for branch names
  with `/`; mixed-case logins may not reopen `gannet:` editors after a restart; partial folders outside the
  default checkout folder and the listed workspaces' folders are not cleaned; logins are not validated before being written into git config.
  From the Workspaces review: a workspace file starting with a byte-order mark cannot be read; after a fresh clone
  that lands outside a folder workspace the note says "already checked out"; two checkouts of one repo into two
  workspace files sharing a repo folder share one pending entry; drive-letter case is compared exactly on
  Windows; a workspace file is written in place rather than through a temporary file; repo nodes in Workspaces do
  not show **● local**; symlinked subfolders of a folder workspace are not listed; **New workspace…** with a name
  already taken shows the system's error.

## Flows

Expanding a folder of a repo that is only on GitHub, and opening a file:

```
 User          Tree view          Accounts        gh CLI        GitHub API        gannet: FS
  |                |                  |               |               |                 |
  |-- expand src/->|                  |               |               |                 |
  |                |-- token(login) ->|               |               |                 |
  |                |                  |-- auth token --user (first use) ->|             |
  |                |                  |<-- token -----|               |                 |
  |                |<-- token --------|               |               |                 |
  |                |-- GET contents/src (unless cached) -------------->|                 |
  |                | [200]            |               |               |                 |
  |                |<-- entries, sizes ---------------------------------|                |
  |<-- children ---|  (repo moves to top of Recent)  |               |                 |
  |                | [401]  account shown signed out  |               |                 |
  |                | [403 + X-GitHub-SSO]  "authorize org" with link   |                 |
  |                | [403/429 rate limit]  error + retry time         |                 |
  |-- click a.js ->| [size > 10 MB]  note + Open on GitHub             |                 |
  |                |-- open gannet://login/o/r/src/a.js ----------------------------------->|
  |                |                  |<-- token(login) ------------------------------------|
  |                |                  |-- token ----------------------------------------->|
  |                |                  |               |               |<-- GET raw ------|
  |                |                  |               |               |-- bytes -------->|
  |<-- read-only editor (or the error in its place) --------------------------------------|
```

Checking out, with the failures that matter most:

```
 User          Tree view          Accounts          git              Disk             Workspace
  |                |                  |               |                 |                  |
  |-- Check out -->|  (Check out to…: workspace list, or Other folder…)   |                  |
  |                |-- queue (one clone at a time)   |                 |                  |
  |                |-- token -------->|               |                 |                  |
  |                | [no token]  stop: signed-out error                 |                  |
  |                |<-- token --------|               |                 |                  |
  |                |-- pick target in the workspace's repo folder ------>|                  |
  |                | [same repo already there]  remember + add, no clone|                  |
  |                |-- clone into <target>.gannet-partial-<pid> (auth in env) ->|            |
  |<-- progress notification with Cancel             |                 |                  |
  |                | [success]        |               |                 |                  |
  |                |<-- exit 0 -------------------------|               |                  |
  |                |-- rename to <target> ------------------------------>|                  |
  |                |-- set repo's .git/config: push as <login> -------->|                  |
  |                |-- remember path; mark ● local   |                 |                  |
  |                |-- place in its workspace (this window: append) --------------------->|
  |                |                  |               |                 |  (extension host may restart)
  |<-- repo in Explorer, tree shows local files -----------------------------------------|
  |                | [refused]  note with Add to workspace             |                  |
  |                | [failure / Cancel]               |                 |                  |
  |                |<-- error line / killed -----------|               |                  |
  |                |-- remove <target>.gannet-partial-<pid> ------------>|                  |
  |<-- notification with git's error                |                 |                  |
  |                | [cut off by a restart]  next start: dead window's partial removed, checkout resumed
```

## Left to the builder

- Icons, wording of actions and notes, the activity-bar icon.
- Caching details and when caches expire, beyond "per session, ⟳ refreshes".
- How the tree is split into modules, and the tests' shape (offline stubs of `vscode`, `gh` and GitHub; one live
  test per flow above).
- README and Marketplace listing.
