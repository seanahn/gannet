'use strict';
// Workspaces: the places repos are kept — a .code-workspace file, whose folders are repos wherever they live, or a
// folder whose subfolders are the repos. The list is kept in global state (per machine); workspace files are
// edited in place with jsonc-parser so their comments and settings survive.
const fs = require('fs');
const os = require('os');
const path = require('path');
const jsonc = require('jsonc-parser');
const { expandHome, isDir } = require('./localRepos.js');

const KEY = 'gannet.workspaces';
const EXT = '.code-workspace';
const PARTIAL_RE = /\.gannet-partial(?:-\d+)?$/;

const nameOf = (kind, p) => (kind === 'file' ? path.basename(p, EXT) : path.basename(p));
const isGitRepo = (dir) => fs.existsSync(path.join(dir, '.git'));
const exists = (ws) => (ws.kind === 'file' ? fs.existsSync(ws.path) && !isDir(ws.path) : isDir(ws.path));

function createWorkspaces({ memento, home = os.homedir() }) {
  const norm = (p) => path.resolve(expandHome(p, home));
  const load = () => memento.get(KEY, []) || [];
  const save = (list) => memento.update(KEY, list);
  return {
    list: () => load(),
    get: (p) => load().find((w) => w.path === norm(p)),
    add(ws) {
      const list = load();
      const p = norm(ws.path);
      if (list.some((w) => w.path === p)) return Promise.resolve();
      list.push({ ...ws, path: p, name: ws.name || nameOf(ws.kind, p) });
      return save(list);
    },
    remove(p) { const n = norm(p); return save(load().filter((w) => w.path !== n)); },
    setRepoFolder(p, folder) {
      const n = norm(p);
      return save(load().map((w) => (w.path === n ? { ...w, repoFolder: norm(folder) } : w)));
    },
  };
}

/** This window's workspace: a saved workspace file, or one folder that is not itself a repo; untitled; or null. */
function currentWorkspace({ workspaceFile, workspaceFolders } = {}) {
  if (workspaceFile) {
    if (workspaceFile.scheme === 'file') return { kind: 'file', path: workspaceFile.fsPath, name: nameOf('file', workspaceFile.fsPath) };
    return { untitled: true };
  }
  const folders = workspaceFolders || [];
  if (folders.length !== 1 || folders[0].uri.scheme !== 'file') return null;
  const p = folders[0].uri.fsPath;
  return isGitRepo(p) ? null : { kind: 'folder', path: p, name: nameOf('folder', p) };
}

function parseFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const errors = [];
  const data = jsonc.parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !data || typeof data !== 'object') throw new Error(`${file} is not a valid workspace file`);
  return { text, data };
}

/** Absolute paths of a workspace file's folders; remote (uri) entries are skipped. */
function readFolders(file) {
  const { data } = parseFile(file);
  const dir = path.dirname(file);
  return (Array.isArray(data.folders) ? data.folders : [])
    .filter((f) => f && typeof f.path === 'string')
    .map((f) => path.resolve(dir, expandHome(f.path)));
}

/** The file's own indentation and line endings, so an edit matches what is there. */
function styleOf(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const m = /\n([ \t]+)\S/.exec(text);
  if (m && m[1][0] === '\t') return { insertSpaces: false, tabSize: 4, eol };
  return { insertSpaces: true, tabSize: m ? m[1].length : 2, eol };
}

async function addFolderToFile(file, folder) {
  const { text, data } = parseFile(file);   // read just before writing, so another window's change is kept
  const dir = path.dirname(file);
  const target = path.resolve(folder);
  if (readFolders(file).includes(target)) return 'present';
  const rel = path.relative(dir, target);
  const entry = { path: rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : target };
  const at = Array.isArray(data.folders) ? data.folders.length : 0;
  const fmt = { formattingOptions: styleOf(text) };
  const edits = Array.isArray(data.folders)
    ? jsonc.modify(text, ['folders', at], entry, { ...fmt, isArrayInsertion: true })
    : jsonc.modify(text, ['folders'], [entry], fmt);
  fs.writeFileSync(file, jsonc.applyEdits(text, edits));
  return 'added';
}

function createWorkspaceFile(dir, name) {
  const file = path.join(dir, name + EXT);
  fs.writeFileSync(file, '{\n\t"folders": [],\n\t"settings": {}\n}\n', { flag: 'wx' });
  return file;
}

/** Where new clones go: a folder's own path; a workspace file's chosen repo folder, else the parent most of its folders share, else its own folder. */
function repoFolderOf(ws) {
  if (ws.kind === 'folder') return ws.path;
  if (ws.repoFolder) return ws.repoFolder;
  let folders = [];
  try { folders = readFolders(ws.path); } catch { /* unreadable: the file's folder */ }
  const counts = new Map();
  for (const f of folders) { const p = path.dirname(f); counts.set(p, (counts.get(p) || 0) + 1); }
  let best = null;
  for (const [p, n] of counts) if (!best || n > best[1]) best = [p, n];   // Map keeps file order: ties go to the first
  return best ? best[0] : path.dirname(ws.path);
}

function foldersOf(ws) {
  if (ws.kind === 'file') return readFolders(ws.path);
  let ents = [];
  try { ents = fs.readdirSync(ws.path, { withFileTypes: true }); } catch { return []; }
  return ents.filter((d) => d.isDirectory() && !d.name.startsWith('.') && !PARTIAL_RE.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((n) => path.join(ws.path, n));
}

module.exports = { createWorkspaces, currentWorkspace, readFolders, addFolderToFile, createWorkspaceFile, repoFolderOf, foldersOf, exists, isGitRepo, KEY };
