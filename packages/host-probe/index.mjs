import fs from 'node:fs';
export const name = 'host-probe';
export const inject = ['systemPrompt', 'agents'];
export function apply(ctx, config = {}) {
  const outFile = config.outFile ?? 'D:/antigravity_veido/book-companion/artifacts/host-probe.jsonl';
  const log = (record) => {
    try {
      const dir = outFile.slice(0, outFile.lastIndexOf('/'));
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n');
    } catch (error) {
      ctx.logger?.warn?.(`host-probe write failed: ${error?.message ?? error}`);
    }
  };
  ctx.systemPrompt.section({
    name: 'host-probe:main-persona-sentinel',
    order: 20000,
    complete: false,
    interpolate: false,
    text: 'MAIN_PERSONA_SENTINEL 主助手画像（模拟主记忆/主 persona 注入，不得进入书童提示词）',
  });
  log({ event: 'probe-loaded', pid: process.pid });
  ctx.on('agent/created', ({ agent }) => {
    log({
      event: 'agent/created',
      sessionId: agent?.session?.id ?? null,
      agentPreset: agent?.session?.header?.agentPreset ?? null,
      cwd: agent?.session?.header?.cwd ?? null,
      origin: agent?.session?.header?.origin ?? null,
    });
  });
  ctx.on('session/event', (session, event) => {
    if (event?.type === 'agent-preset/selected') {
      log({ event: 'agent-preset/selected', sessionId: session?.id ?? null, agentPreset: event?.data?.agentPreset ?? null });
    }
  });
}