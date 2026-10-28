#!/usr/bin/env node
// 在只能访问 api.github.com、无法走 git 协议（github.com 被网络策略拦截）的环境里，
// 用 GitHub Git Data API 把当前 HEAD 的完整树推成一个 commit。
//
// 用法：
//   node scripts/publish-github.mjs --owner geqian2020 --repo book-companion [--private]
//
// 令牌来源：环境变量 GITHUB_TOKEN，或本机 `gh auth token`。
// 不会打印令牌，也不会写入任何文件。

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const API = 'https://api.github.com';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (!key.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith('--')) args.set(key.slice(2), true);
  else { args.set(key.slice(2), next); i += 1; }
}

const owner = args.get('owner');
const repo = args.get('repo');
if (!owner || !repo) {
  console.error('usage: node scripts/publish-github.mjs --owner <owner> --repo <repo> [--private] [--description "..."]');
  process.exit(2);
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

let token;
const getToken = () => {
  if (token) return token;
  token = process.env.GITHUB_TOKEN ?? (() => {
    try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim(); }
    catch { throw new Error('No GITHUB_TOKEN and `gh auth token` failed; run `gh auth login` first'); }
  })();
  return token;
};

const call = async (method, url, body) => {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: {
      authorization: `Bearer ${getToken()}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'book-companion-publisher',
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const error = new Error(`${method} ${url} -> ${res.status} ${json?.message ?? text.slice(0, 200)}`);
    error.status = res.status;
    error.body = json;
    throw error;
  }
  return json;
};

const repoUrl = `/repos/${owner}/${repo}`;

// 1) 枚举 HEAD 树，算 git blob sha（sha1("blob <len>\0" + content)）
const files = git('ls-files', '-z').split('\0').filter(Boolean);
const entries = [];
for (const file of files) {
  // 读 git 对象而不是工作区文件：避免 CRLF / autocrlf 让内容与 HEAD 不一致
  const content = execFileSync('git', ['cat-file', 'blob', `HEAD:${file}`], { maxBuffer: 64 * 1024 * 1024 });
  const sha = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
  entries.push({ file, content, sha });
}
console.log(`staged ${entries.length} files (${entries.reduce((n, e) => n + e.content.length, 0)} bytes)`);

if (args.has('dry-run')) {
  const expected = new Map(git('ls-tree', '-r', 'HEAD').split('\n').filter(Boolean).map((line) => {
    const [meta, file] = line.split('\t');
    return [file, meta.split(' ')[2]];
  }));
  const bad = entries.filter((entry) => expected.get(entry.file) !== entry.sha);
  if (bad.length > 0) { console.error('sha mismatch:', bad.map((e) => e.file).join(', ')); process.exit(1); }
  console.log(`dry-run ok: ${entries.length} blobs match HEAD tree`);
  process.exit(0);
}

// 2) 仓库不存在就建（auto_init=false，避免多一个无父提交）
let exists = true;
try { await call('GET', repoUrl); }
catch (error) { if (error.status === 404) exists = false; else throw error; }

if (!exists) {
  await call('POST', '/user/repos', {
    name: repo,
    private: args.has('private'),
    description: args.get('description') ?? '',
    auto_init: false
  });
  console.log(`created ${owner}/${repo}`);
} else {
  console.log(`repository ${owner}/${repo} already exists`);
}

// 3) 逐个建 blob（GitHub 会按内容去重，重复推送不会产生新对象）
const uploaded = new Map();
const concurrency = 4;
let cursor = 0;
const workers = Array.from({ length: concurrency }, async () => {
  while (cursor < entries.length) {
    const index = cursor; cursor += 1;
    const entry = entries[index];
    const blob = await call('POST', `${repoUrl}/git/blobs`, {
      content: entry.content.toString('base64'),
      encoding: 'base64'
    });
    if (blob.sha !== entry.sha) throw new Error(`blob sha mismatch for ${entry.file}: ${blob.sha} != ${entry.sha}`);
    uploaded.set(entry.file, blob.sha);
    if ((index + 1) % 20 === 0) console.log(`  blobs ${index + 1}/${entries.length}`);
  }
});
await Promise.all(workers);

// 4) 建 tree
const tree = entries.map((entry) => ({
  path: entry.file,
  mode: '100644',
  type: 'blob',
  sha: uploaded.get(entry.file)
}));
const createdTree = await call('POST', `${repoUrl}/git/trees`, { tree });
console.log(`tree ${createdTree.sha}`);

// 5) 建 commit（空仓库无父提交）
const message = git('log', '-1', '--pretty=%B');
const commit = await call('POST', `${repoUrl}/git/commits`, {
  message,
  tree: createdTree.sha,
  parents: []
});
console.log(`commit ${commit.sha}`);

// 6) 建/更新 ref，并把默认分支设为 main
try {
  await call('POST', `${repoUrl}/git/refs`, { ref: 'refs/heads/main', sha: commit.sha });
} catch (error) {
  if (error.status !== 422) throw error;
  await call('PATCH', `${repoUrl}/git/refs/heads/main`, { sha: commit.sha, force: true });
}
await call('PATCH', repoUrl, { default_branch: 'main' });
console.log(`pushed -> https://github.com/${owner}/${repo}`);

// 7) 回读远端树做完整性校验（路径数 + blob sha 全等）
const remoteTree = await call('GET', `${repoUrl}/git/trees/main?recursive=1`);
const remote = new Map(remoteTree.tree.filter((n) => n.type === 'blob').map((n) => [n.path, n.sha]));
const missing = entries.filter((entry) => remote.get(entry.file) !== entry.sha);
if (missing.length > 0) {
  console.error('verification failed for:', missing.map((entry) => entry.file).join(', '));
  process.exit(1);
}
console.log(`verified ${remote.size}/${entries.length} blobs match local HEAD`);
