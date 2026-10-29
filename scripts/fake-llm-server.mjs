// 假 OpenAI-compatible 网关：用于 book-companion 真机开机的确定性模型。
// 记录每个请求（含 system prompt / tools）到 artifacts/fake-llm.jsonl。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.FAKE_LLM_PORT ?? 19733);
const ART = 'D:/antigravity_veido/book-companion/artifacts';
const LOG = process.env.FAKE_LLM_LOG ?? path.join(ART, 'fake-llm.jsonl');
fs.mkdirSync(ART, { recursive: true });
// 每次启动清空日志：否则 host-check 会读到上一轮的请求，把旧 prompt 长度当成这一轮的结论。
fs.writeFileSync(LOG, '');
const log = (record) => fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n');
const uid = () => 'call_' + Math.random().toString(36).slice(2, 12);
const toolCall = (name, args) => ({ id: uid(), type: 'function', function: { name, arguments: JSON.stringify(args) } });

function decide(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const toolNames = tools.map((t) => t?.function?.name).filter(Boolean);
  const isAgent = toolNames.includes('book_remember') || toolNames.includes('book_recall');
  const toolMsgCount = messages.filter((m) => m.role === 'tool').length;
  if (!isAgent) return { kind: 'text', text: '测试会话' };
  if (toolMsgCount === 0) {
    return {
      kind: 'tool',
      call: toolCall('book_remember', {
        kind: 'material',
        text: '《史记·项羽本纪》测试材料：项王军壁垓下，兵少食尽；于是项王乃悲歌慷慨。',
        source: 'fixture:史记/项羽本纪',
      }),
    };
  }
  if (toolMsgCount === 1) return { kind: 'tool', call: toolCall('book_recall', { query: '史记' }) };
  const lastTool = [...messages].reverse().find((m) => m.role === 'tool');
  return { kind: 'text', text: 'ROUNDTRIP_OK ' + String(lastTool?.content ?? '').slice(0, 300) };
}

function chunk(delta, finish = null) {
  return { id: 'chatcmpl-fake', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'fake-model', choices: [{ index: 0, delta, finish_reason: finish }] };
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'fake-model', object: 'model', owned_by: 'fake' }] }));
    return;
  }
  if (req.method !== 'POST') { res.writeHead(404); res.end(); return; }
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { /* keep empty */ }
    const decision = decide(body);
    const systemText = (body.messages ?? []).filter((m) => m.role === 'system' || m.role === 'developer').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
    const toolNames = (body.tools ?? []).map((t) => t?.function?.name).filter(Boolean);
    log({
      event: 'request',
      url: req.url,
      stream: body.stream !== false,
      model: body.model,
      toolNames,
      messageRoles: (body.messages ?? []).map((m) => m.role),
      systemPromptChars: systemText.length,
      systemPrompt: systemText,
      lastUserText: [...(body.messages ?? [])].reverse().find((m) => m.role === 'user')?.content ?? null,
      decision: decision.kind === 'tool' ? { kind: 'tool', name: decision.call.function.name, args: decision.call.function.arguments } : { kind: 'text', text: decision.text },
    });
    const stream = body.stream !== false;
    if (!stream) {
      const message = decision.kind === 'tool'
        ? { role: 'assistant', content: null, tool_calls: [decision.call] }
        : { role: 'assistant', content: decision.text };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'chatcmpl-fake', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: 'fake-model', choices: [{ index: 0, message, finish_reason: decision.kind === 'tool' ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const write = (o) => res.write('data: ' + JSON.stringify(o) + '\n\n');
    write(chunk({ role: 'assistant', content: '' }));
    if (decision.kind === 'tool') {
      write(chunk({ tool_calls: [{ index: 0, id: decision.call.id, type: 'function', function: { name: decision.call.function.name, arguments: decision.call.function.arguments } }] }));
      write(chunk({}, 'tool_calls'));
    } else {
      write(chunk({ content: decision.text }));
      write(chunk({}, 'stop'));
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
server.listen(PORT, '127.0.0.1', () => console.log('fake-llm listening on http://127.0.0.1:' + PORT));
