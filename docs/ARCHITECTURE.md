# 架构：小书童如何做到「独立人设 + 独立记忆」

本文描述代码里实际生效的机制，以及每层机制对应的断言。设计目标只有一个：
**书童会话拿不到主助手的画像、工具、文件和记忆；主助手也看不到书童的阅读记录。**

## 1. 组合方式：预设内挂载，不全局注册

`packages/book-companion/cordis.patch.yml` 只做一件事：往宿主里插入一个 agent preset。

```yaml
- insert:
    - id: preset-book-companion
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: book-companion
        plugins:
          - id: book-companion-runtime
            name: dsh-book-companion
```

`dsh-book-companion` 因此只存在于 `book-companion` 预设的插件树里。
主会话不挂这个插件，书童会话也不继承主会话的插件。

插件入口在启动时做两道自检：

```js
const isolation = ctx.get('bookMemoryIsolation');
if (isolation?.version !== 1 || !isolation.excludes({ header: { agentPreset: PRESET } }))
  throw new Error('Verified main-memory exclusion is required before book companion can start');
```

也就是说：**没有装隔离版主记忆，书童拒绝启动**。这是一个 fail-closed 设计，
避免「忘了装补丁，书童静默共享主记忆」这种最难发现的故障。

## 2. 工具面：6 个工具，双保险

书童只有六个工具：

| 工具 | 作用 | 边界 |
| --- | --- | --- |
| `book_remember` | 保存材料 / 用户原话 / 助手观点 / 暂定偏好 | 必须带 `source`，`kind` 白名单校验 |
| `book_recall` | 检索书童自己的阅读记忆 | 字面量匹配，中文不依赖分词 |
| `book_forget` | 按 ID 删除 | 写 tombstone，事件重放不会复活 |
| `book_episode` | 读取小宇宙节目标题与简介 | 只允许 canonical 链接，返回 `metadata-only` |
| `book_import_transcript` | 导入转写并按段保存 | 1600 字一段，digest 去重，Savepoint 原子写入 |
| `book_review` | 按时间范围回顾 | 200 条上限，超限返回 `truncated: true` |

双保险指的是：

1. **执行期 guard**：任何 `exec.name` 不以 `book_` 开头、或会话预设不对，直接拒绝；
2. **会话期 restrict**：`agent/created` 时对书童 agent 调 `ctx.tools.restrict({ allow: [...] })`，
   模型侧连工具定义都看不到别的。

`ctx.tools.presentAs('native')` 让这六个工具以原生工具形式出现，而不是 MCP 代理。

## 3. 提示词：整体替换，而不是追加

```js
ctx.systemPrompt.section({
  name: 'book-companion:persona',
  order: 0,
  complete: true,
  interpolate: false,
  text: `你是独立的阅读搭子书童……`
});
```

`complete: true` 表示**这一节就是全部系统提示词**：DSH 内置的工具 SDK 说明、结构化输出指导、
环境说明都不会再注入。好处是绝不会混入主画像；代价是提示词只有 231 字符（主会话 3049 字符），
真实模型在工具调用格式上可能打折。这是 P0-2 之前要补的已知项，不是「已解决」。

## 4. 记忆：两套存储，物理分开

### 4.1 主记忆侧：按会话排除

`dsh-openviking-memory-isolated` 是上游 `@openviking/dsh-memory-plugin@0.5.20` 的可重建 fork，
由 `scripts/prepare-memory-fork.mjs` 从本机安装副本生成，补丁点只有四处：

```js
const excluded = createPolicy(input);
const skipMemory = session => excluded(session) || (skipSubagentSessions && origin === 'subagent');
ctx.tools.guard(memoryToolGuard(excluded));           // 拒绝 mcp__openviking__*
assertManagedIdentity(agent.session, excluded);       // 受保护工作区里的非书童会话直接报错
ctx.provide('bookMemoryIsolation', Object.freeze({ version: 1, excludes: excluded }));
```

`createPolicy` 的判定是「预设命中 **或** 工作目录在受保护根目录下」：

```js
if (presets.has(header?.agentPreset)) return true;
return roots.some(root => 工作目录在 root 之内);
```

命中后，画像注入、召回、捕获、提交、flush 全部跳过。
`assertManagedIdentity` 还堵了一个坑：如果有人用非书童预设打开书童工作目录
（分叉导致预设丢失），会直接抛错，而不是悄悄用主记忆继续跑。

### 4.2 书童侧：自己的 SQLite

`~/.dsh/book-companion/reading.sqlite`（可用 `config.dataDir` 覆盖），WAL 模式，四张表：

- `notes`：`id / session_id / kind / text / source / created_at`
- `notes_fts`：FTS5 索引（检索实际走 `instr()`，因为中文分词不可靠）
- `imports`：转写 digest，防重复导入
- `tombstones`：删除标记，防事件重放复活

两类写入：

- **显式写入**：`book_remember`，`kind` 限定 `user-view / assistant-view / material / preference-hypothesis`；
- **自动留档**：监听 `session/event`，只收 `role` 为 user/assistant 的文本消息，
  且用户消息 `source.kind` 必须是 `user`——**注入的上下文不会被当成用户原话存下来**。
  记录 ID 是 `sha256("session:<id>/event:<seq>")`，天然幂等。

## 5. QQ 入口：把「入口」钉死

`patches/dsh-im/book-route.mjs` 对 dsh-im 5.7.0 做源码级补丁：

- `/new` 创建的会话固定 `agentPreset=book-companion` 与固定工作目录；
- 机器人与会话的绑定持久化，重启后仍指向同一个书童会话；
- 拒绝跨会话命令（不能在 A 会话里操作 B 会话）；
- 拒绝入口切换（不能把机器人切到主助手）；
- 语音消息优先使用平台提供的 ASR 文本；没有识别结果时明确告知，不猜内容。

这部分有 79 项回归 + 7 项状态恢复测试，但**没有真号联调**，是当前最大的未知数。

## 6. 验证基础设施

| 组件 | 作用 |
| --- | --- |
| `scripts/fake-llm-server.mjs` | 本地 OpenAI-compatible 网关，按脚本依次返回 `book_remember` / `book_recall` / 最终文本，并记录真实 system prompt、tools、消息角色序列 |
| `packages/host-probe` | 在宿主里注入 `MAIN_PERSONA_SENTINEL` 模拟主画像，并记录 agent 事件 |
| `packages/host-check` | 开机后建两个会话（书童 + 主对照），跑 17 条断言，写 artifact，用退出码表达结果 |

`host-check` 是「真机断言」而不是单测：它走的是 `agents.create` → `presets.mount` → `agent.followup`
的真实路径，最后还会解压 `session.v4.jsonl.zstd` 检查落盘 header。

## 7. 已知设计债

1. **231 字符提示词**：`complete: true` 清掉了宿主内置指令，接真模型前要补工具使用说明与输出约束。
2. **两个 fork**：主记忆 bundle 与 dsh-im 都是源码补丁，上游升级必须重做并重跑验证。
3. **QQ 未真号**：路由逻辑有测试，真实协议、限流、重连未验证。
4. **无音频链路**：只有平台 ASR 与手动转写导入，不能声称「听完了播客」。
