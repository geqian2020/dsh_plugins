import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import {BOOK_TOOL_NAMES} from 'dsh-book-companion';
import {BookStore} from 'dsh-book-companion/src/store.mjs';

export const name = 'book-host-check';
export const inject = ['agents', 'sessions', 'agentDefaultModel', 'agentPresets'];

const ART = 'D:/antigravity_veido/book-companion/artifacts';
const write = (file, value) => {
  fs.mkdirSync(ART, { recursive: true });
  fs.writeFileSync(path.join(ART, file), JSON.stringify(value, null, 2));
};
const appendLog = (line) => {
  fs.mkdirSync(ART, { recursive: true });
  fs.appendFileSync(process.env.BOOK_HOST_CHECK_LOG ?? path.join(ART, 'host-check.log'), line + '\n');
};
const readRequests = () => {
  const file = process.env.FAKE_LLM_LOG ?? path.join(ART, 'fake-llm.jsonl');
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

const bookDbPath = () => path.join(process.env.BOOK_TEST_DATA_DIR ?? path.join(process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'), 'book-companion'), 'reading.sqlite');
const countNotes = (needle) => {
  try {
    const db = new DatabaseSync(bookDbPath(), { readOnly: true });
    const row = needle === undefined
      ? db.prepare('SELECT COUNT(*) AS c FROM notes').get()
      : db.prepare('SELECT COUNT(*) AS c FROM notes WHERE instr(text, ?) > 0').get(needle);
    db.close();
    return Number(row?.c ?? 0);
  } catch (error) {
    return -1;
  }
};
const countRemembered = (needle) => {
  try {
    const db = new DatabaseSync(bookDbPath(), { readOnly: true });
    const row = db.prepare("SELECT COUNT(*) AS c FROM notes WHERE source LIKE 'smoke-test%' AND instr(text, ?) > 0").get(needle);
    db.close();
    return Number(row?.c ?? 0);
  } catch (error) {
    return -1;
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

    if(config.mode==='exploration-real'){
      const store=new BookStore(bookDbPath());
      const seedAgent={session:{header:{id:'fixture-seed',agentPreset:'book-companion'}}};
      const thread=store.thread(seedAgent,{action:'save',question:'性格 组织 制度',userView:'我目前觉得人物的选择主要由性格决定。',assistantView:'我更想检验组织和信息流能否提供另一种解释，暂时保留分歧。',evidence:'fixture:earlier-reading-conversation'});
      store.close();
      const run=await drive(bookSessionId,'book-companion','我们以前聊过一个还没解决的问题。请先找回它，然后自己从配置的订阅源选择相关材料并读取正文，给我一个有来源的新视角和你真正想继续讨论的问题。把你的判断和我们仍然存在的分歧保存下来；不要替我改变立场。');
      const toolNames=run.events.filter(e=>e.type==='tool/call').map(e=>e.data?.name);
      const answers=run.events.filter(e=>e.type==='assistant/message').map(e=>e.data?.message?.content?.filter(p=>p.type==='text').map(p=>p.text).join('\n')??'').join('\n');
      const after=new BookStore(bookDbPath());
      const threads=after.thread(seedAgent,{action:'list'});
      const savedViews=after.db.prepare("SELECT kind,source,text FROM notes WHERE kind='assistant-view'").all();
      const materials=after.db.prepare("SELECT source FROM notes WHERE kind='material'").all();
      after.close();
      check('exploration session has book identity',run.header.agentPreset==='book-companion');
      check('model retrieves a prior thread',toolNames.includes('book_thread'),toolNames);
      check('model discovers material from configured sources',toolNames.includes('book_discover'));
      check('model reads article body',toolNames.includes('book_read_article'));
      check('article body is stored with source segments',materials.some(n=>n.source.startsWith('https://reading-fixture.example/article#segment=')),materials);
      check('answer uses information only present in body',answers.includes('双向信使'),answers);
      check('answer identifies its material source',/reading-fixture\.example|测试材料|虚构/.test(answers));
      check('user position remains distinct',threads.some(t=>t.id===thread.id&&t.userView.includes('性格')&&t.assistantView.length>0),threads);
      check('assistant saves its own view or revises the thread',savedViews.length>0||threads.some(t=>t.id===thread.id&&t.evidence!=='fixture:earlier-reading-conversation'),savedViews.map(v=>({kind:v.kind,source:v.source})));
      check('no error events',!run.events.some(e=>String(e.type).includes('error')));
      const report={ok:checks.every(c=>c.pass),mode:config.mode,at:new Date().toISOString(),profile:config.profileName??'booktest',modelSelection:selection,sessionId:bookSessionId,tools:toolNames,checks,sourceKind:'synthetic RSS and HTML via test-only transport; real DSH and real model',dataIsolated:!!process.env.BOOK_TEST_DATA_DIR};
      write(config.reportFile??'companion-exploration-real.json',report);return report.ok;
    }

    // 真模型模式：判据不是「假网关脚本返回了什么」，而是
    //   1) 书童的库里真的出现了 material 行（写路径）
    //   2) 换一个全新会话，能否凭 book_recall 把这条内容取回来（读路径）
    if ((config.mode ?? 'fake') === 'real') {
      const secret = config.secret ?? 'SMOKE_SECRET_青鸾-7391';
      const taskWrite = config.bookTask
        ?? `请把这条记到你的阅读记忆里（source 写 smoke-test）：『暗号：${secret}』。记完回我一句确认，不要展开。`;
      const taskRecall = config.recallTask
        ?? '我们之前记过一个暗号。请先用 book_recall 查一下，再告诉我暗号内容。';

      const writeRun = await drive(bookSessionId, config.preset ?? 'book-companion', taskWrite);
      const rememberedRows = countRemembered(secret);

      const recallSessionId = 'session-' + randomUUID();
      const recallRun = await drive(recallSessionId, config.preset ?? 'book-companion', taskRecall);
      const recallSerialized = JSON.stringify(recallRun.events);
      const recallCalled = /book_recall/.test(recallSerialized);
      const recalledAnswer = recallRun.events.some((event) => event.type === 'assistant/message' && JSON.stringify(event.data).includes(secret));
      const failures = [...writeRun.events, ...recallRun.events].filter((event) => String(event.type).includes('error'));

      check('preset resolves to book-companion', writeRun.resolvedId === 'book-companion', writeRun.resolvedId);
      check('write session header.agentPreset is book-companion', writeRun.header.agentPreset === 'book-companion', writeRun.header.agentPreset);
      check('book_remember wrote a row with source smoke-test', rememberedRows >= 1, { secret, rememberedRows });
      check('recall happens in a different session', recallRun.header.id !== writeRun.header.id, recallRun.header.id);
      check('book_recall called in the recall session', recallCalled, recallSerialized.length);
      check('cross-session recall returned the secret', recalledAnswer, null);
      check('no error events', failures.length === 0, failures.length);

      const report = {
        ok: checks.every((entry) => entry.pass),
        mode: 'real',
        at: new Date().toISOString(),
        profile: config.profileName ?? 'booktest',
        hostPid: process.pid,
        node: process.version,
        modelSelection: selection,
        writeSessionId: bookSessionId,
        recallSessionId,
        secret,
        checks
      };
      write(config.reportFile ?? 'host-smoke.json', report);
      appendLog(JSON.stringify({ at: report.at, mode: 'real', ok: report.ok, failed: checks.filter((c) => !c.pass).map((c) => c.name) }));
      return report.ok;
    }

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
      const expected = BOOK_TOOL_NAMES;
      check('book tool surface matches the companion contract', JSON.stringify(toolNames) === JSON.stringify(expected), toolNames);
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
      mode: 'fake',
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
    write(config.reportFile ?? 'host-check.json', report);
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
