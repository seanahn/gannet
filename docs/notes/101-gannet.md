# 101 — Gannet: GitHub as a drive in VS Code

Design, 2026-11-25. Not built yet.

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
- Fetched once per session and cached; the ⟳ button refreshes.
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

## Checkout

- **Default folder:** setting `gannet.checkoutFolder`, default `~/github`. A repo goes to `<folder>/<repo>`; if
  that folder is taken by a different repo, `<folder>/<owner>-<repo>`. *(Sean: one folder by default;
  builder's call on the name and on clashes)*
- **Check out to…:** a folder picker; the repo is cloned into `<picked>/<repo>`.
- Cloning runs `git clone` with the account's token passed for that one command
  (`git -c http.extraHeader="Authorization: Basic …" clone https://github.com/<owner>/<repo>.git`), so the token
  never lands in `.git/config`. The remote stays a plain https URL. *(builder's call)*
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
- One clone at a time; a second **Check out** waits in a queue. Git clones into `<target>.gannet-partial` and is
  renamed when it succeeds, so a clone cut off by an extension restart leaves only a `.gannet-partial` folder,
  which Gannet removes on start. *(builder's call)*
- After a successful clone, the folder is appended to the current workspace with
  `vscode.workspace.updateWorkspaceFolders`; no new window. *(Sean)* Note: adding a second folder to a
  single-folder window turns it into an untitled multi-root workspace, and VS Code restarts extensions when
  that happens; Gannet must cope with being restarted right after a checkout.
- Where each repo was checked out is remembered (global state, per machine). On start Gannet also recognises
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
- Clone sign-in is `http.extraHeader=Authorization: Basic base64("x-access-token:<token>")` on the command line
  only; git's error line is shown with that value masked.
- A gh account's push helper, in the repo's `.git/config`:
  `!f() { test "$1" = get || exit 0; echo username=<login>; echo password=$(gh auth token --hostname github.com --user <login>); }; f`.
- A VS Code account's push helper is `!"<shim>" <login>`. The shim, `gannet-credential` in Gannet's global
  storage folder (a path that survives updates), is rewritten on every start to run the current VS Code's own
  Node (`ELECTRON_RUN_AS_NODE=1 <execPath>`) on `bin/gannet-credential.js`. Every VS Code window serves its own
  socket, `token-<pid>.sock` (0600, in a 0700 folder; under the temp folder if the path would be too long; a
  named pipe on Windows); the helper tries each and removes dead ones. The line protocol is `<login>` in,
  `ok <token>` or `err <message>` out.
- Repos found on disk but not cloned by Gannet are remembered with no account, and offer **Push as <login>**.
  Checking out a repo already local, from any account, only adds it to the workspace and keeps its push account.
- Hidden accounts are written to the user (global) settings.

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
  |-- Check out -->|  (Check out to…: folder picker first)               |                  |
  |                |-- queue (one clone at a time)   |                 |                  |
  |                |-- token -------->|               |                 |                  |
  |                | [no token]  stop: signed-out error                 |                  |
  |                |<-- token --------|               |                 |                  |
  |                |-- pick target: <repo>, else <owner>-<repo> -------->|                  |
  |                | [same repo already there]  remember + add, no clone|                  |
  |                |-- clone into <target>.gannet-partial (one-off auth header) ->|           |
  |<-- progress notification with Cancel             |                 |                  |
  |                | [success]        |               |                 |                  |
  |                |<-- exit 0 -------------------------|               |                  |
  |                |-- rename to <target> ------------------------------>|                  |
  |                |-- set repo's .git/config: push as <login> -------->|                  |
  |                |-- remember path; mark ● local   |                 |                  |
  |                |-- updateWorkspaceFolders (append) ----------------------------------->|
  |                |                  |               |                 |  (extension host may restart)
  |<-- repo in Explorer, tree shows local files -----------------------------------------|
  |                | [refused]  note with Add to workspace             |                  |
  |                | [failure / Cancel]               |                 |                  |
  |                |<-- error line / killed -----------|               |                  |
  |                |-- remove <target>.gannet-partial ------------------>|                  |
  |<-- notification with git's error                |                 |                  |
  |                | [cut off by a restart]  on next start, leftover .gannet-partial removed|
```

## Left to the builder

- Icons, wording of actions and notes, the activity-bar icon.
- Caching details and when caches expire, beyond "per session, ⟳ refreshes".
- How the tree is split into modules, and the tests' shape (offline stubs of `vscode`, `gh` and GitHub; one live
  test per flow above).
- README and Marketplace listing.
