import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fetchEpisode, segmentTranscript, EPISODE_HEADERS } from './materials.mjs';

export const ASR_PYTHON = process.env.BOOK_ASR_PYTHON ?? 'C:/Users/xiale/AppData/Local/hermes/tools/python-3.14.7+20260901-win32-x64/python.exe';
export const ASR_SCRIPT = process.env.BOOK_ASR_SCRIPT ?? 'C:/Users/xiale/.workbuddy/skills/douyin-video-pipeline/scripts/transcribe.py';
export const FFMPEG = process.env.BOOK_FFMPEG ?? 'C:/Users/xiale/AppData/Local/hermes/tools/ffmpeg-9.0.1-win32-x64/bin/ffmpeg.exe';

const run = (cmd, args, { timeoutMs = 30 * 60 * 1000, env = {} } = {}) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { windowsHide: true, env: { ...process.env, ...env } });
  let out = '', err = '';
  const timer = setTimeout(() => { child.kill(); reject(new Error('process timeout')); }, timeoutMs);
  child.stdout?.on('data', (d) => { out += d; });
  child.stderr?.on('data', (d) => { err += d; });
  child.on('error', (e) => { clearTimeout(timer); reject(e); });
  child.on('close', (code) => {
    clearTimeout(timer);
    if (code === 0) resolve({ out, err });
    else reject(new Error(`${path.basename(cmd)} exit ${code}: ${err.slice(-600)}`));
  });
});

export async function downloadAudio(url, file, signal) {
  const res = await fetch(url, { redirect: 'follow', headers: EPISODE_HEADERS, signal: AbortSignal.any([AbortSignal.timeout(10 * 60 * 1000), ...(signal ? [signal] : [])]) });
  if (!res.ok || res.body === null) throw new Error(`audio download failed (${res.status})`);
  const tmp = file + '.part';
  const out = fs.createWriteStream(tmp);
  let bytes = 0;
  for await (const chunk of res.body) {
    bytes += chunk.length;
    if (bytes > 400 * 1024 * 1024) throw new Error('audio too large (>400MB)');
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
  }
  await new Promise((r) => out.end(r));
  fs.renameSync(tmp, file);
  return bytes;
}

const pad = (n) => String(Math.floor(n)).padStart(2, '0');

export function timedTranscript(raw) {
  return raw.split(/\r?\n/).map((line) => {
    const m = line.match(/^\[\s*([\d.]+)-\s*([\d.]+)\]\s*(.+)$/);
    if (m === null) return line.trim();
    const t = Number(m[1]);
    return `(${pad(t / 60)}:${pad(t % 60)}) ${m[3].trim()}`;
  }).filter(Boolean).join('\n');
}

export function writeKbNote(episode, text, segments, kbRoot, coverage = 'full') {
  const dir = path.join(kbRoot, 'podcasts');
  fs.mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const slug = episode.title.replace(/[\\/:*?"<>|#\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'episode';
  const file = path.join(dir, `${date}-${slug}.md`);
  const body = `---\ntitle: ${JSON.stringify(episode.title)}\nsource_url: ${episode.url}\naudio_url: ${episode.audioUrl}\ncreated: ${new Date().toISOString()}\nkind: podcast-transcript\nsegments: ${segments}\n---\n\n# ${episode.title}\n\n> 来源：${episode.url}\n> 转写：faster-whisper（本地 CPU），存在识别错误，引用时注明「据转写」\n> 覆盖：${coverage}\n\n${text}\n`;
  fs.writeFileSync(file, body, 'utf8');
  return file;
}

// 下载 → （可选切片）→ 本地转写 → KB 笔记 → 分段入库
export async function transcribeEpisode({
  url,
  store,
  agent,
  dataDir,
  kbRoot,
  python = ASR_PYTHON,
  script = ASR_SCRIPT,
  ffmpeg = FFMPEG,
  model = 'small',
  maxSeconds,
  signal
}) {
  const episode = await fetchEpisode(url, { signal });
  if (!episode.audioUrl) return { status: 'metadata-only', ...episode, reason: '页面没有可用音频地址' };

  const dir = path.join(dataDir, 'audio');
  fs.mkdirSync(dir, { recursive: true });
  const key = createHash('sha1').update(episode.audioUrl).digest('hex').slice(0, 12);
  const audio = path.join(dir, key + '.m4a');
  if (!fs.existsSync(audio) || fs.statSync(audio).size < 1024) await downloadAudio(episode.audioUrl, audio, signal);

  let source = audio;
  let note = 'full';
  if (maxSeconds) {
    const cut = path.join(dir, `${key}-${maxSeconds}s.m4a`);
    if (!fs.existsSync(cut)) await run(ffmpeg, ['-y', '-loglevel', 'error', '-t', String(maxSeconds), '-i', audio, '-vn', '-c:a', 'aac', cut]);
    source = cut;
    note = `first ${maxSeconds}s`;
  }

  const txt = source.replace(/\.m4a$/i, '.txt');
  if (!fs.existsSync(txt)) {
    // HF_HUB_OFFLINE：模型已缓存，禁止联网校验，否则会被本机代理拦成 502
    await run(python, [script, source, '-o', txt, '--model', model, '--language', 'zh'], {
      env: { HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' }
    });
  }

  const text = timedTranscript(fs.readFileSync(txt, 'utf8'));
  if (!text.trim()) throw new Error('转写结果为空');
  const imported = store.importTranscript(agent, segmentTranscript({ text, source: `${episode.title} ${episode.url}` }));
  const kb = writeKbNote(episode, text, imported.segments ?? 0, kbRoot, note);

  return {
    status: 'transcript-ready',
    title: episode.title,
    url: episode.url,
    coverage: note,
    segments: imported.segments ?? 0,
    chars: text.length,
    kb
  };
}
