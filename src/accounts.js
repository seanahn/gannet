'use strict';
// The GitHub accounts Gannet shows: every github.com account the gh CLI is logged into, and VS Code's own GitHub
// sign-ins. Tokens are read when first needed and kept in memory only; gh's setup is never changed.
const { spawn } = require('child_process');
const { GitHubError } = require('./github.js');

const HOST = 'github.com';
const SCOPES = ['repo'];

/** Runs a program without a shell: { code, stdout, stderr }; rejects only when it cannot start (e.g. ENOENT). */
function runProcess(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts }); } catch (e) { reject(e); return; }
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function createAccounts({ vscode, run = runProcess, hidden = () => [] }) {
  const tokens = new Map();     // login -> token, memory only
  const sources = new Map();    // login -> 'gh' | 'vscode', from the last list()
  const vsAccounts = new Map(); // login -> VS Code AuthenticationSessionAccountInformation
  const changed = new vscode.EventEmitter();

  vscode.authentication.onDidChangeSessions((e) => {
    if (e && e.provider && e.provider.id === 'github') { for (const [l, s] of sources) if (s === 'vscode') tokens.delete(l); changed.fire(); }
  });

  async function ghLogins() {
    let res;
    try { res = await run('gh', ['auth', 'status', '--hostname', HOST]); } catch { return []; }   // gh not installed
    const text = `${res.stdout}\n${res.stderr}`;
    const out = [];
    for (const m of text.matchAll(/Logged in to github\.com account (\S+)/g)) if (!out.includes(m[1])) out.push(m[1]);
    return out;
  }

  async function list() {
    const gh = await ghLogins();
    let vs = [];
    try { vs = await vscode.authentication.getAccounts('github'); } catch { vs = []; }
    sources.clear(); vsAccounts.clear();
    for (const a of vs) { vsAccounts.set(a.label, a); sources.set(a.label, 'vscode'); }
    for (const l of gh) sources.set(l, 'gh');   // gh is preferred when a login is in both
    const hide = new Set(hidden() || []);
    return [...sources].filter(([l]) => !hide.has(l)).map(([login, source]) => ({ login, source }))
      .sort((a, b) => (a.login < b.login ? -1 : a.login > b.login ? 1 : 0));
  }

  async function token(login) {
    if (tokens.has(login)) return tokens.get(login);
    if (!sources.size) await list();
    const source = sources.get(login);
    let t = '';
    if (source === 'gh') {
      let res;
      try { res = await run('gh', ['auth', 'token', '--hostname', HOST, '--user', login]); } catch { res = { code: 1 }; }
      if (res.code === 0) t = String(res.stdout || '').trim();
      if (!t) throw new GitHubError('auth', 401, `gh has no token for ${login} — run gh auth login`);
    } else if (source === 'vscode') {
      let s;
      try { s = await vscode.authentication.getSession('github', SCOPES, { account: vsAccounts.get(login), silent: true }); } catch { s = undefined; }
      t = s && s.accessToken;
      if (!t) throw new GitHubError('auth', 401, `${login} is signed out of VS Code`);
    } else {
      throw new GitHubError('auth', 401, `${login} is not a known account`);
    }
    tokens.set(login, t);
    return t;
  }

  async function addVsCodeAccount() {
    const s = await vscode.authentication.getSession('github', SCOPES, { createIfNone: true, clearSessionPreference: true });
    if (!s) return undefined;
    const login = s.account.label;
    vsAccounts.set(login, s.account);
    if (sources.get(login) !== 'gh') { sources.set(login, 'vscode'); tokens.set(login, s.accessToken); }
    return { login, source: sources.get(login) };
  }

  return {
    list, token, addVsCodeAccount,
    forget: (login) => { tokens.delete(login); },
    sourceOf: (login) => sources.get(login),
    onDidChange: changed.event,
  };
}

module.exports = { createAccounts, runProcess };
