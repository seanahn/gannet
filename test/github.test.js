'use strict';
// The GitHub REST client: paging, folder listings, raw files, and how GitHub's errors are told apart.
const assert = require('assert');
const { createClient, GitHubError, encodePath } = require('../src/github.js');

const TOKEN = 'ghp_secret_test_token';

function response(status, body, headers = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: (k) => (h.has(k.toLowerCase()) ? h.get(k.toLowerCase()) : null) },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    arrayBuffer: async () => new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)).buffer,
  };
}
function fakeFetch(answer) {
  const calls = [];
  const f = async (url, opts) => { calls.push({ url, opts }); return answer(url, opts, calls.length); };
  f.calls = calls;
  return f;
}
const apiRepo = (i) => ({ full_name: `o${i}/r${i}`, owner: { login: `o${i}` }, name: `r${i}`, private: i % 2 === 0, archived: false, default_branch: 'main', html_url: `https://github.com/o${i}/r${i}`, clone_url: `https://github.com/o${i}/r${i}.git` });

async function rejects(p) { try { await p; } catch (e) { return e; } throw new Error('expected a rejection'); }

(async () => {
  // listRepos follows Link: rel="next" over two pages
  {
    const fetch = fakeFetch((url) => url.includes('page=2')
      ? response(200, Array.from({ length: 50 }, (_, i) => apiRepo(100 + i)))
      : response(200, Array.from({ length: 100 }, (_, i) => apiRepo(i)), { Link: '<https://api.github.com/user/repos?per_page=100&page=2>; rel="next", <https://api.github.com/user/repos?per_page=100&page=2>; rel="last"' }));
    const gh = createClient({ fetch, token: async () => TOKEN });
    const repos = await gh.listRepos({ sort: 'pushed' });
    assert.strictEqual(repos.length, 150);
    assert.strictEqual(fetch.calls.length, 2);
    assert.deepStrictEqual(repos[1], { fullName: 'o1/r1', owner: 'o1', name: 'r1', private: false, archived: false, defaultBranch: 'main', htmlUrl: 'https://github.com/o1/r1', cloneUrl: 'https://github.com/o1/r1.git' });
    const first = fetch.calls[0];
    assert.ok(first.url.startsWith('https://api.github.com/user/repos?'), first.url);
    assert.ok(first.url.includes('affiliation=owner,collaborator,organization_member'));
    assert.ok(first.url.includes('per_page=100'));
    assert.ok(first.url.includes('sort=pushed'));
    assert.strictEqual(first.opts.headers.Authorization, 'Bearer ' + TOKEN);
    assert.strictEqual(first.opts.headers['X-GitHub-Api-Version'], '2022-11-28');
  }
  // max stops after the first page
  {
    const fetch = fakeFetch(() => response(200, Array.from({ length: 100 }, (_, i) => apiRepo(i)), { Link: '<https://api.github.com/user/repos?page=2>; rel="next"' }));
    const repos = await createClient({ fetch, token: async () => TOKEN }).listRepos({ sort: 'pushed', max: 10 });
    assert.strictEqual(repos.length, 10);
    assert.strictEqual(fetch.calls.length, 1);
  }
  // listDir: path segments encoded, dirs first then by name, truncated at 1000
  {
    assert.strictEqual(encodePath('a b/#c/?%/é'), 'a%20b/%23c/%3F%25/%C3%A9');
    const entry = (name, type, size = 1) => ({ name, path: 'x/' + name, type, size, html_url: 'https://github.com/o/r/blob/main/x/' + name });
    const fetch = fakeFetch(() => response(200, [entry('b.js', 'file', 10), entry('z', 'dir', 0), entry('a.js', 'file', 5), entry('lib', 'submodule', 0), entry('a', 'dir', 0)]));
    const gh = createClient({ fetch, token: async () => TOKEN });
    const { entries, truncated } = await gh.listDir('o', 'r', 'a b/#c');
    assert.strictEqual(fetch.calls[0].url, 'https://api.github.com/repos/o/r/contents/a%20b/%23c');
    assert.deepStrictEqual(entries.map((e) => e.name), ['a', 'z', 'a.js', 'b.js', 'lib']);
    assert.deepStrictEqual(entries[2], { name: 'a.js', path: 'x/a.js', type: 'file', size: 5, htmlUrl: 'https://github.com/o/r/blob/main/x/a.js' });
    assert.strictEqual(truncated, false);
    const root = fakeFetch(() => response(200, []));
    await createClient({ fetch: root, token: async () => TOKEN }).listDir('o', 'r', '');
    assert.strictEqual(root.calls[0].url, 'https://api.github.com/repos/o/r/contents/');
    const many = (n) => fakeFetch(() => response(200, Array.from({ length: n }, (_, i) => entry('f' + i, 'file'))));
    assert.strictEqual((await createClient({ fetch: many(1000), token: async () => TOKEN }).listDir('o', 'r', '')).truncated, true);
    assert.strictEqual((await createClient({ fetch: many(999), token: async () => TOKEN }).listDir('o', 'r', '')).truncated, false);
  }
  // readFile asks for the raw content and returns bytes
  {
    const fetch = fakeFetch(() => response(200, 'hello'));
    const bytes = await createClient({ fetch, token: async () => TOKEN }).readFile('o', 'r', 'src/a b.js');
    assert.strictEqual(fetch.calls[0].url, 'https://api.github.com/repos/o/r/contents/src/a%20b.js');
    assert.strictEqual(fetch.calls[0].opts.headers.Accept, 'application/vnd.github.raw');
    assert.ok(bytes instanceof Uint8Array);
    assert.strictEqual(new TextDecoder().decode(bytes), 'hello');
  }
  // errors are told apart, and never carry the token
  {
    const kindOf = async (status, headers = {}) => {
      const gh = createClient({ fetch: fakeFetch(() => response(status, { message: 'Bad credentials ' + TOKEN }, headers)), token: async () => TOKEN });
      const e = await rejects(gh.listDir('o', 'r', ''));
      assert.ok(e instanceof GitHubError, String(e));
      assert.ok(!e.message.includes(TOKEN), 'no token in ' + e.message);
      assert.strictEqual(e.status, status);
      return e;
    };
    assert.strictEqual((await kindOf(401)).kind, 'auth');
    const sso = await kindOf(403, { 'X-GitHub-SSO': 'required; url=https://github.com/orgs/x/sso?authorization_request=1' });
    assert.strictEqual(sso.kind, 'sso');
    assert.strictEqual(sso.ssoUrl, 'https://github.com/orgs/x/sso?authorization_request=1');
    const rate = await kindOf(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' });
    assert.strictEqual(rate.kind, 'rate');
    assert.strictEqual(rate.retryAt.getTime(), 1700000000 * 1000);
    assert.strictEqual((await kindOf(429)).kind, 'rate');
    assert.strictEqual((await kindOf(404)).kind, 'notFound');
    assert.strictEqual((await kindOf(409)).kind, 'empty');
    assert.strictEqual((await kindOf(500)).kind, 'other');
    const both = await kindOf(403, { 'X-GitHub-SSO': 'required; url=https://github.com/orgs/y/sso', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' });
    assert.strictEqual(both.kind, 'sso', 'SSO wins over rate');
  }
  console.log('GITHUB OK');
})().catch((e) => { console.error(e); process.exit(1); });
