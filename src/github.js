'use strict';
// GitHub's REST API, the few calls Gannet makes: the repos an account can reach, a folder's entries, a file's bytes.
// Errors are sorted into kinds the tree can act on; none of them ever carries the token.

const API = 'https://api.github.com';
const LISTING_LIMIT = 1000;   // GitHub's contents API returns at most this many entries for a folder

class GitHubError extends Error {
  constructor(kind, status, message, extra = {}) {
    super(message);
    this.name = 'GitHubError';
    this.kind = kind;   // 'auth' | 'sso' | 'rate' | 'notFound' | 'empty' | 'other'
    this.status = status;
    Object.assign(this, extra);
  }
}

/** Each '/'-separated segment percent-encoded, so names with spaces, '#', '?', '%' or non-ASCII survive. */
function encodePath(path) {
  return String(path || '').split('/').map(encodeURIComponent).join('/');
}

function scrub(text, token) {
  return token ? String(text).split(token).join('***') : String(text);
}

async function toError(res, token) {
  let message = '';
  try { const body = await res.json(); message = body && body.message ? String(body.message) : ''; } catch { /* no body */ }
  message = scrub(message || `GitHub answered ${res.status}`, token);
  const sso = res.headers.get('x-github-sso');
  if (res.status === 403 && sso) {
    const m = /url=(\S+)/.exec(sso);
    return new GitHubError('sso', 403, message, m ? { ssoUrl: m[1] } : {});
  }
  if (res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')) {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    return new GitHubError('rate', res.status, message, reset ? { retryAt: new Date(reset * 1000) } : {});
  }
  const kind = { 401: 'auth', 404: 'notFound', 409: 'empty' }[res.status] || 'other';
  return new GitHubError(kind, res.status, message);
}

function nextLink(res) {
  const link = res.headers.get('link');
  if (!link) return null;
  const m = /<([^>]+)>;\s*rel="next"/.exec(link);
  return m ? m[1] : null;
}

const mapRepo = (r) => ({
  fullName: r.full_name, owner: r.owner && r.owner.login, name: r.name, private: !!r.private, archived: !!r.archived,
  defaultBranch: r.default_branch, htmlUrl: r.html_url, cloneUrl: r.clone_url,
});
const ORDER = { dir: 0, file: 1, symlink: 1, submodule: 1 };
// GitHub lists a submodule inside a folder as type "file" with no download_url; only fetching it says "submodule"
const typeOf = (e) => (e.type === 'file' && e.download_url === null ? 'submodule' : e.type);
const mapEntry = (e) => ({ name: e.name, path: e.path, type: typeOf(e), size: e.size || 0, htmlUrl: e.html_url || '' });

function createClient({ fetch, token }) {
  async function get(url, accept = 'application/vnd.github+json') {
    const t = await token();
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: 'Bearer ' + t, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'gannet' } });
    } catch (e) {
      throw new GitHubError('other', 0, scrub(`Could not reach GitHub: ${e.message}`, t));
    }
    if (!res.ok) throw await toError(res, t);
    return res;
  }

  return {
    async listRepos({ sort = 'full_name', max = Infinity } = {}) {
      const out = [];
      let url = `${API}/user/repos?affiliation=owner,collaborator,organization_member&per_page=100&sort=${sort}`;
      while (url && out.length < max) {
        const res = await get(url);
        for (const r of await res.json()) out.push(mapRepo(r));
        url = nextLink(res);
      }
      return out.slice(0, max);
    },
    /** The logins of the organizations the account belongs to, every page. */
    async listOrgs() {
      const out = [];
      let url = `${API}/user/orgs?per_page=100`;
      while (url) {
        const res = await get(url);
        for (const o of await res.json()) if (o && o.login) out.push(o.login);
        url = nextLink(res);
      }
      return out;
    },
    async listDir(owner, repo, path) {
      let res;
      try {
        res = await get(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(path)}`);
      } catch (e) {
        // an empty repo's root answers 404 "This repository is empty." (409 elsewhere)
        if (!path && e.kind === 'notFound' && /repository is empty/i.test(e.message)) e.kind = 'empty';
        throw e;
      }
      const body = await res.json();
      const list = Array.isArray(body) ? body : [body];
      const entries = list.map(mapEntry).sort((a, b) => (ORDER[a.type] - ORDER[b.type]) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return { entries, truncated: list.length >= LISTING_LIMIT };
    },
    async readFile(owner, repo, path) {
      const res = await get(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(path)}`, 'application/vnd.github.raw');
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

module.exports = { createClient, GitHubError, encodePath, LISTING_LIMIT };
