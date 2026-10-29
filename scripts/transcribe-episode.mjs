#!/usr/bin/env node
// 独立跑一期播客的转写链路（不经过 DSH 宿主），用于排查和冒烟。
// 用法：
//   node scripts/transcribe-episode.mjs <小宇宙单集链接> [--max-seconds 180] [--kb <目录>]
import path from 'node:path';
import os from 'node:os';
import { BookStore } from '../src/store.mjs';
import { transcribeEpisode } from '../src/podcast.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (!key.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith('--')) args.set(key.slice(2), true);
  else { args.set(key.slice(2), next); i += 1; }
}
const url = process.argv[2];
if (!url || url.startsWith('--')) {
  console.error('usage: node scripts/transcribe-episode.mjs <episode-url> [--max-seconds N] [--kb <dir>]');
  process.exit(2);
}

const dataDir = process.env.DSH_HOME
  ? path.join(process.env.DSH_HOME, 'book-companion')
  : path.join(os.homedir(), '.dsh', 'book-companion');
const kbRoot = args.get('kb') ?? process.env.BOOK_KB_ROOT ?? path.join(os.homedir(), 'Documents', 'ObsidianVault', 'dsh');
const maxSeconds = args.has('max-seconds') ? Number(args.get('max-seconds')) : undefined;

const store = new BookStore(path.join(dataDir, 'reading.sqlite'));
const agent = { session: { header: { id: 'cli-transcribe', agentPreset: 'book-companion' } } };

try {
  const result = await transcribeEpisode({ url, store, agent, dataDir, kbRoot, maxSeconds });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error('FAILED:', error?.message ?? error);
  process.exitCode = 1;
} finally {
  store.close();
}
