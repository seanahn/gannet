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

## Checking out

**Check Out** (the cloud icon on a repo) clones into `~/github/<repo>` — or `~/github/<owner>-<repo>` if that name
is taken — and adds the folder to the current workspace; no new window opens. **Check Out to…** picks another place.

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
