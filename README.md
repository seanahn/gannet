# Gannet

Your GitHub repos as a tree in VS Code, the way a drive shows your files before any of them are downloaded.
Browse a repo's files without cloning it; when you want it, check it out into your workspace, and it pushes as the
account it came from.

## What you see

A **Gannet** icon in the activity bar opens one tree:

```
▾ seanahn                 gh
  ▾ Recent
    ▸ seanahn/perch       ● local · private
    ▸ c3-e/seclab-hub
  ▸ All repos             143
▾ c3-sahn                 VS Code
```

- **Accounts.** Every github.com account the `gh` CLI is logged into, and every GitHub account signed in to
  VS Code. **+** in the view's title adds another VS Code account. **Hide Account** (right-click an account) keeps
  one out of the tree; it never signs anything out.
- **Recent.** Up to 10 repos: the ones you opened or checked out in Gannet first, then GitHub's recently pushed.
- **All repos.** Every repo the account can reach, fetched when you open it. **⟳** refreshes.
- **Files.** Expanding a folder of a repo that is only on GitHub fetches just that folder. Files open read-only.
  Files over 10 MB offer **Open on GitHub** instead.

## Workspaces

The **Workspaces** view, above **Repos**, lists the places you keep repos on this machine:

- a **workspace file** (`.code-workspace`): its folders are repos wherever they live; new clones go to its repo
  folder — where most of its repos sit, or the folder you set with **Set Repo Folder…**;
- a **folder** whose subfolders are the repos (a home folder on a remote machine, say); new clones go inside it.

This window's workspace is listed by itself and marked **● this window** (one repo opened alone is not a
workspace). **+** adds a workspace file or a folder, or creates a new workspace file. Clicking a workspace opens it
in a new window; **Remove from List** forgets it and deletes nothing. Each machine has its own list. The design,
with the reasons behind each rule: [docs/notes/101-gannet.md](docs/notes/101-gannet.md).

## Checking out

**Check Out** (the cloud icon on a repo) clones into this window's workspace: into its folder, or into a workspace
file's repo folder and then adds it there. A window with no workspace uses `~/github/<repo>` (or
`~/github/<owner>-<repo>` if that name is taken) and adds the folder to the window. No new window opens.
**Check Out to…** lists your workspaces first, then **Other folder…**; checking out into another workspace writes
it into that workspace's file and leaves this window alone. A repo already checked out on this machine is reused,
never cloned twice.

A checked-out repo is set up, in its own `.git/config` only, to push as the account you checked it out with:

- for a **gh** account, git asks `gh auth token --user <login>` each time, so it works from any terminal;
- for a **VS Code** account, git asks the running VS Code through a small helper; pushing from a terminal while
  VS Code is closed tells you to open VS Code, or add the account to gh.

Gannet stores no token anywhere, and changes neither gh's setup nor your machine-wide git config. Repos already in
`~/github` that you cloned yourself show as local; **Push as This Account** sets them up the same way.

Under Remote-SSH, Gannet runs on the remote machine: checkouts land there, with that machine's gh logins.

## Settings

| Setting | Default | |
|---|---|---|
| `gannet.checkoutFolder` | `~/github` | Where Check Out puts repos. |
| `gannet.hiddenAccounts` | `[]` | Logins not shown. |

## Development

```
make test-offline   # no network
make test           # plus a live run against GitHub with gh's logins
make install        # symlink into VS Code's extension folders
make package        # gannet-<version>.vsix
```

The design, and why it is the way it is: [docs/notes/101-gannet.md](docs/notes/101-gannet.md).
