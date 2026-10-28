import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

export const name = 'book-host-check';
export const inject = ['agents', 'sessions', 'agentDefaultModel', 'agentPresets'];

const ART = 'D:/antigravity_veido/book-companion/artifacts';
const write = (file, value) => {
  fs.mkdirSync(ART, { recursive: true });
  fs.writeFileSync(path.join(ART, file), JSON.stringify(value, null, 2));
};
const appendLog = (line) => {
  fs.mkdirSync(ART, { recursive: true });
  fs.appendFileSync(path.join(ART, 'host-check.log'), line + '\n');
};
const readRequests = () => {
  const file = path.join(ART, 'fake-llm.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter((entry) => entry && entry.event === 'request');
};
const findSessionFile = (sessionId) => {
  const root = path.join(process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'), 'sessions');
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name === sessionId) {
        const files = fs.readdirSync(full);
        const sessionFile = files.find((name) => name.startsWith('session.') && (name.endsWith('.jsonl') || name.endsWith('.jsonl.zstd')));
        if (sessionFile !== undefined) return path.join(full, sessionFile);
      }
      stack.push(full);
    }
  }
  return null;
};
const readPersistedHeader = (file) => {
  try {
    const raw = fs.readFileSync(file);
    const text = file.endsWith('.zstd') ? zlib.zstdDecompressSync(raw).toString('utf8') : raw.toString('utf8');
    const firstLine = text.split('\n').find((line) => line.trim().length > 0);
    return JSON.parse(firstLine);
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
};

export function apply(ctx, config = {}) {
  const run = async () => {
    const checks = [];
    const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail: detail ?? null });
    await ctx.get('loader')?.await();
    const agents = ctx.get('agents');
    const sessions = ctx.get('sessions');
    const defaultModel = ctx.get('agentDefaultModel');
    const presets = ctx.get('agentPresets');
    const cwd = config.cwd ?? 'D:/DSH/shutong';
    const selection = defaultModel.currentSelection();

    const drive = async (sessionId, presetId, task) => {
      const agentOptions = { provider: selection.provider, model: selection.model };
      let meta = { cwd };
      let resolvedId;
      let setup;
      if (presetId !== undefined) {
        const resolved = await presets.resolve(presetId);
        resolvedId = resolved.id;
        meta = { cwd, agentPreset: resolvedId };
        setup = async (agentCtx) => { await presets.mount(agentCtx, resolvedId); };
      }
      const { agent } = await agents.create({ sessionId, meta, agentOptions, setup });
      await agent.whenIdle();
      const header = { id: agent.session.id, agentPreset: agent.session.header.agentPreset ?? null, cwd: agent.session.header.cwd ?? null };
      agent.followup(createUserMessage({ content: [{ type: 'text', text: task }], source: { kind: 'user' } }));
      await agent.whenIdle();
      await sessions.flush(agent.session);
      const events = [];
      for (let index = 0; index < agent.session.seq; index += 1) {
        const event = agent.session.eventAt(index);
        if (event !== undefined) events.push({ type: event.type, data: event.data });
      }
      return { header, resolvedId, events };
    };

    const bookSessionId = 'session-' + randomUUID();
    const book = await drive(bookSessionId, config.preset ?? 'book-companion', config.bookTask ?? '请读一下这段材料并记住，然后回忆给我。');
    check('preset resolves to book-companion', book.resolvedId === 'book-companion', book.resolvedId);
    check('book session header.agentPreset is book-companion', book.header.agentPreset === 'book-companion', book.header.agentPreset);

    const mainSessionId = 'session-' + randomUUID();
    const main = await drive(mainSessionId, undefined, config.mainTask ?? '你好，请简短回复。');
    check('main comparison session is not book-companion', main.header.agentPreset !== 'book-companion', main.header.agentPreset);

    const requests = readRequests();
    const bookRequests = requests.filter((entry) => (entry.toolNames ?? []).includes('book_remember') || String(entry.systemPrompt ?? '').includes('阅读搭子'));
    const mainRequests = requests.filter((entry) => String(entry.systemPrompt ?? '').includes('MAIN_PERSONA_SENTINEL'));
    check('book model requests observed', bookRequests.length >= 3, bookRequests.length);
    const firstBook = bookRequests[0];
    if (firstBook !== undefined) {
      check('book system prompt contains companion persona', String(firstBook.systemPrompt).includes('阅读搭子'), firstBook.systemPromptChars);
      check('book system prompt excludes MAIN_PERSONA_SENTINEL', !String(firstBook.systemPrompt).includes('MAIN_PERSONA_SENTINEL'), null);
      const toolNames = (firstBook.toolNames ?? []).slice().sort();
      const expected = ['book_episode', 'book_forget', 'book_import_transcript', 'book_recall', 'book_remember', 'book_review'];
      check('book tool surface is exactly the six companion tools', JSON.stringify(toolNames) === JSON.stringify(expected), toolNames);
      const decisions = bookRequests.map((entry) => entry.decision);
      check('decision 1 is book_remember', decisions[0]?.kind === 'tool' && decisions[0]?.name === 'book_remember', decisions[0] ?? null);
      check('decision 2 is book_recall', decisions[1]?.kind === 'tool' && decisions[1]?.name === 'book_recall', decisions[1] ?? null);
      check('decision 3 is final text with ROUNDTRIP_OK', decisions[2]?.kind === 'text' && String(decisions[2]?.text).includes('ROUNDTRIP_OK'), decisions[2] ?? null);
      check('tool result returned to the model', (bookRequests[2]?.messageRoles ?? []).includes('tool'), bookRequests[2]?.messageRoles ?? null);
    }
    check('main session prompt carries MAIN_PERSONA_SENTINEL', mainRequests.length >= 1, mainRequests.length);
    const assistantTexts = book.events.filter((event) => event.type === 'assistant/message').map((event) => JSON.stringify(event.data ?? {}));
    check('book assistant final answer observed', assistantTexts.some((text) => text.includes('ROUNDTRIP_OK')), assistantTexts.length);

    const bookSessionFile = findSessionFile(bookSessionId);
    check('book session persisted as JSONL', bookSessionFile !== null, bookSessionFile);
    const mainSessionFile = findSessionFile(mainSessionId);
    check('main session persisted as JSONL', mainSessionFile !== null, mainSessionFile);
    const bookPersisted = bookSessionFile === null ? null : readPersistedHeader(bookSessionFile);
    check('persisted book session header records book-companion', bookPersisted?.agentPreset === 'book-companion', bookPersisted);
    const mainPersisted = mainSessionFile === null ? null : readPersistedHeader(mainSessionFile);
    check('persisted main session header records no book preset', mainPersisted?.agentPreset === undefined || mainPersisted?.agentPreset === null, mainPersisted);

    const report = {
      ok: checks.every((entry) => entry.pass),
      at: new Date().toISOString(),
      profile: config.profileName ?? 'booktest',
      hostPid: process.pid,
      node: process.version,
      modelSelection: selection,
      bookSessionId,
      mainSessionId,
      modelRequests: { book: bookRequests.length, main: mainRequests.length, total: requests.length },
      checks,
    };
    write('host-check.json', report);
    appendLog(JSON.stringify({ at: report.at, ok: report.ok, failed: checks.filter((c) => !c.pass).map((c) => c.name) }));
    return report.ok;
  };

  run().then((ok) => {
    appendLog(JSON.stringify({ event: 'host-check-exit', ok }));
    setTimeout(() => process.exit(ok ? 0 : 1), 300);
  }).catch((error) => {
    write('host-check.json', { ok: false, at: new Date().toISOString(), error: String(error?.stack ?? error) });
    appendLog(JSON.stringify({ event: 'host-check-throw', error: String(error?.message ?? error) }));
    setTimeout(() => process.exit(1), 300);
  });
}