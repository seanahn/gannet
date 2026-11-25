# Gannet

Your GitHub repos as a tree in VS Code, the way a drive shows your files before any of them are downloaded.
Browse a repo's files without cloning it; when you want it, check it out into your workspace, and it pushes as the
account it came from.

## What you see

A **Gannet** icon in the activity bar opens two views: a small **Workspaces** panel on top, and the repos tree:

```
▾ WORKSPACES                       [+]
    /git
    ~/github
▾                                  [+ account] [⟳]
  ▾ c3-e              via c3-sahn
    ▸ Recent
    ▸ All repos       312
  ▸ c3-sahn
  ▸ c3-taehokgil      via c3-sahn
  ▾ seanahn
    ▾ Recent
      ▸ perch         /git · ~/github      (green Octocat: checked out)
    ▸ All repos       143
```

- **Owners.** The tree is grouped by owner: each account you are signed in to, each organization it belongs to,
  and every other owner it can reach repos of (shown `via <account>`). Organizations start expanded; an account
  that belongs to organizations starts collapsed. **+** adds a VS Code account; **Hide Account** (right-click an
  account) keeps one out of the tree and never signs anything out.
- **Recent.** Per owner, up to 10 repos: the ones you opened or checked out in Gannet first, then GitHub's
  recently pushed.
- **All repos.** Per owner, every repo of that owner the account can reach. The account's full list is fetched
  once and kept on disk, so later starts and other windows show it at once; its tooltip says when it was fetched.
  **⟳** marks every list stale, and the next opening fetches it again.
- **Checked out.** A repo checked out on this machine has a green Octocat, and lists where its checkouts are. One
  checkout expands to its files on disk; several expand to one node per checkout.
- **Files.** Expanding a folder of a repo that is only on GitHub fetches just that folder. Files open read-only.
  Files over 10 MB offer **Open on GitHub** instead.

## Workspaces

The **Workspaces** panel lists the directories you keep checkouts in on this machine, such as `/git` and
`~/github` locally or `~/` on a remote machine. **+** adds a directory (not a repo itself); **Reveal in File
Manager** shows one; **Remove from List** forgets it and deletes nothing. A directory that is gone shows
**Missing**. Each machine has its own list, and every listed directory is scanned on start for clones. Upgrading
from 0.2.0 carries its list over once, with each workspace file replaced by its repo folder, plus `~/github` if it
exists. The design, with the reasons behind each rule: [docs/notes/101-gannet.md](docs/notes/101-gannet.md).

## Checking out

**Check Out** (the cloud icon on a repo, or right-click) clones the repo:

- with **no workspace yet**, it asks where Gannet should check out repos — `~/github` or a folder you choose — and
  adds that directory to Workspaces;
- with **one workspace**, it goes there, with no question;
- with **several**, or when the repo is **already checked out**, a quick pick chooses the workspace (the one
  holding this window's folders first, and which ones already have a copy), ending with **Other folder…** when
  there is a copy.

The folder is the first free one of `<repo>`, `<owner>-<repo>`, `<repo>-2`, `<repo>-3`, …, with no prompt, so a repo
can be checked out more than once. **Check Out to…** picks any folder for one checkout. The new folder is added to
this window unless it already sits inside one of the window's folders; no new window opens.

A checked-out repo is set up, in its own `.git/config` only, to push as the account you checked it out with:

- for a **gh** account, git asks `gh auth token --user <login>` each time, so it works from any terminal;
- for a **VS Code** account, git asks the running VS Code through a small helper; pushing from a terminal while
  VS Code is closed tells you to open VS Code, or add the account to gh.

Gannet stores no token anywhere, and changes neither gh's setup nor your machine-wide git config. Repos you cloned
yourself into a listed workspace show as checked out; **Push as This Account** sets them up the same way.

Under Remote-SSH, Gannet runs on the remote machine: checkouts land there, with that machine's gh logins.

## Settings

| Setting | Default | |
|---|---|---|
| `gannet.hiddenAccounts` | `[]` | Logins not shown. |

## Development

```
make test-offline   # no network
make test           # plus a live run against GitHub with gh's logins
make install        # symlink into VS Code's extension folders
make package        # gannet-<version>.vsix
```

The design, and why it is the way it is: [docs/notes/101-gannet.md](docs/notes/101-gannet.md).
