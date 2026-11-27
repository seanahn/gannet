# Gannet

Your GitHub repos as a tree in VS Code, the way a drive shows your files before any of them are downloaded.
Browse a repo's files without cloning it; when you want it, check it out into your workspace, and it pushes as the
account it came from.

## What you see

A **GitHub** cat icon in the activity bar opens one sidebar: the directories you keep checkouts in on top, and your
repos, grouped by owner, below.

```
GITHUB                               [+ account] [⟳]
  /git                                  [📂] [✕]     (buttons show on hover)
  ~/github                              [📂] [✕]
  + Add Workspace…
 ───────────────────────────────────────────────
 ▾ (org) c3-e                via c3-sahn
   ▸ (cat) c3nexus           ~
   ▸ All repos               312
 ▸ (person) c3-sahn
 ▾ (person) seanahn
   ▾ (green cat) perch       /git · ~/github       (checked out twice: one row each)
     ▾ /git/perch
       ▸ src
         (file) README.md
     ▸ ~/github/perch
   ▸ All repos               143
```

- **Owners.** Each account you are signed in to, each organization it belongs to, and every other owner it can
  reach repos of (shown `via <account>`) is a top-level row. Organizations start expanded; an account that belongs
  to organizations starts collapsed. **+** adds a VS Code account; **Hide Account** (right-click an account) keeps
  one out of the list and never signs anything out; **Hide Owner** (the eye on hover, or right-click, on an organization or a `via` owner)
  keeps that owner out. Whatever you hid is listed under **Hidden**, the last row (only when something is
  hidden); the open eye on one shows it again.
- **Recent repos.** Under an owner come up to 10 repos: the ones you opened or checked out in Gannet first, then
  the ones checked out on this machine, most recently worked on first (the last commit, checkout, pull or staging
  in that checkout), then GitHub's recently pushed. Then **All repos**: every repo of that owner the account can reach. The account's full
  list is fetched once and kept on disk, so later starts and other windows show it at once; its tooltip says when
  it was fetched. **⟳** marks every list stale, and the next opening fetches it again.
- **Checked out.** A repo checked out on this machine has a green Octocat, and lists where its checkouts are. One
  checkout expands to its files on disk; several expand to one row per checkout. Hovering shows each checkout's
  path, its branch, and the account it pushes as; a repo only on GitHub says **Only on GitHub**.
- **Files.** Folders have only an arrow; files have a file icon. Expanding a folder of a repo that is only on
  GitHub fetches just that folder. Files open read-only. Files over 10 MB offer **Open on GitHub** instead.
- **Using it.** Clicking a row opens or toggles it; what is expanded is remembered across reloads. Right-click a
  row for its menu (Check Out, Check Out to…, Reveal, Add to Window, Push as This Account, Open on GitHub, Hide
  Account, Hide Owner). With the list focused, Up/Down move, Right/Left expand and collapse, Enter or Space clicks.

## Workspaces

The panel on top lists the directories you keep checkouts in on this machine, such as `/git` and `~/github`
locally or `~/` on a remote machine. **Add Workspace…** adds a directory to the list (not a repo itself). Each
directory always shows **New Folder…**; hovering it also shows **Reveal** and **Remove from List**, which forgets it and deletes nothing. Reveal shows the directory in the
Explorer when it is in this window, else in your file manager; in a remote window, where there is no file manager,
a directory outside the window has no Reveal. A directory that
is gone shows **Missing**. Each machine has its own list, and every listed directory is scanned on start for
clones. Upgrading from 0.2.0 carries its list over once, with each workspace file replaced by its repo folder,
plus `~/github` if it exists. The design, with the reasons behind each rule:
[docs/notes/101-gannet.md](docs/notes/101-gannet.md).

## New folders

For a repo that is not on GitHub yet (often a work repo that only the git admins can create), hover a workspace
directory and click **New Folder…**. Type a name in the box that opens under it (Enter to take it, Escape to
cancel), then pick the owner it is meant for from the list that opens in the same place; Gannet creates the folder,
adds it to the window, and shows it as a dim row first under that owner, "not on GitHub yet". A name that is
already a plain folder there is adopted, not created. Gannet never runs git in it; it only records which owner the
folder belongs to, on this machine.

Drag the row onto another owner, or right-click **Move to Owner…**, to move it; right-click **Forget** drops the
row and keeps the folder. Reveal and Add to Window work on it as on a checkout. Once the folder's origin names a
repo GitHub lists, it shows as an ordinary checkout under that repo's owner. ⟳ also rescans the workspaces, so a
clone you made by hand shows up. The design: [docs/notes/101-gannet.md](docs/notes/101-gannet.md).

## Checking out

**Check Out** (the cloud icon on a repo, or right-click) clones the repo; on a repo already checked out the
cloud icon is **Check Out Another Copy**:

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
| `gannet.hiddenOwners` | `[]` | Organizations and other owners not shown. |

## Development

```
make test-offline   # no network
make test           # plus a live run against GitHub with gh's logins
make install        # symlink into VS Code's extension folders
make package        # gannet-<version>.vsix
```

The design, and why it is the way it is: [docs/notes/101-gannet.md](docs/notes/101-gannet.md).
