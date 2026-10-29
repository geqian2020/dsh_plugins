# 验证报告：P0-1 真机开机

> 本文的数字全部来自 `artifacts/host-check.json` 与两个原始日志，没有手写字段。
> 如果重跑，请以新生成的 artifact 为准，不要沿用本文的数值。

## 结论

在**真实 DSH 宿主**里，用**测试 profile `booktest`**（不是 desktop）跑通了一条完整的书童链路：

```
宿主启动 → 建书童会话（preset=book-companion）→ 假模型 3 轮
        → book_remember → book_recall → ROUNDTRIP_OK → 会话落盘 → 17/17 断言通过 → 退出码 0
```

同时建了一个**主对照会话**，用来证明「书童没拿到主画像」不是因为主画像根本没注入。

## 环境

| 项 | 值 |
| --- | --- |
| 测试 profile | `booktest`（`C:/Users/xiale/.dsh/profiles/booktest`） |
| 宿主 | DSH 桌面版 0.2.0-rc.2 |
| 运行时 | Node v24.18.1，Windows 11 26H2 build 26300.9711 |
| 宿主端口 | 19399（`--no-open`） |
| 模型 | 本地假网关 `fake-gateway / fake-model`，`127.0.0.1:19733` |
| 书童会话 | `session-ed5bbd36-b8a6-4dd5-8fbe-01f1f71af364` |
| 主对照会话 | `session-d54e9d23-8e96-4aa4-9d9c-b961b211cbf9` |
| 模型请求数 | 书童 3 次，主对照 1 次，合计 6 次（含重试/工具轮） |
| 工作目录 | `D:/DSH/shutong` |

## 17 条断言

| # | 断言 | 结果 | 实测值 |
| --- | --- | --- | --- |
| 1 | preset 解析为 `book-companion` | PASS | `book-companion` |
| 2 | 首条消息前会话 header 已是 `book-companion` | PASS | `book-companion` |
| 3 | 主对照会话不是 `book-companion` | PASS | `null` |
| 4 | 观测到书童模型请求 | PASS | 3 |
| 5 | 书童提示词含「阅读搭子」人设 | PASS | 977 字符 |
| 6 | 书童提示词**不含** `MAIN_PERSONA_SENTINEL` | PASS | — |
| 7 | 工具面恰好 7 个 `book_*` | PASS | `book_episode / book_forget / book_import_transcript / book_recall / book_remember / book_review / book_transcribe` |
| 8 | 第 1 个决策是 `book_remember` | PASS | `{kind:"tool",name:"book_remember"}` |
| 9 | 第 2 个决策是 `book_recall` | PASS | `{kind:"tool",name:"book_recall"}` |
| 10 | 第 3 个决策是含 `ROUNDTRIP_OK` 的最终文本 | PASS | 文本内含刚写入的记录 JSON |
| 11 | 工具结果以 `tool` 角色回传模型 | PASS | `["system","user","user","assistant","tool","assistant","tool"]` |
| 12 | 主对照提示词含 `MAIN_PERSONA_SENTINEL` | PASS | 1 次命中 |
| 13 | 观测到书童最终回答事件 | PASS | 3 |
| 14 | 书童会话落盘为 JSONL | PASS | `.../session.v4.jsonl.zstd` |
| 15 | 主对照会话落盘为 JSONL | PASS | `.../session.v4.jsonl.zstd` |
| 16 | 落盘 header 记录 `agentPreset: book-companion` | PASS | 见下 |
| 17 | 落盘的主对照 header 无预设 | PASS | 无 `agentPreset` 字段 |

落盘的 header（第 16 条）：

```json
{
  "type": "session",
  "version": 4,
  "id": "session-ed5bbd36-b8a6-4dd5-8fbe-01f1f71af364",
  "createdAt": 1793206942959,
  "cwd": "D:/DSH/shutong",
  "isSeeded": false,
  "delegationDepth": 0,
  "agentPreset": "book-companion"
}
```

## 三条最值得看的证据

### 1. 隔离是真的，不是假阴性

书童提示词 977 字符（补全后的 persona），只含自身人设；主对照会话的提示词 3049 字符，含探针注入的
`MAIN_PERSONA_SENTINEL`。两者在同一次宿主运行、同一个模型、同一个工作目录下产生，
所以「书童没有主画像」不是「主画像压根没加载」的结果。

### 2. 工具面是硬的

模型侧看到的工具名排序后精确等于七个 `book_*`，没有 `mcp__openviking__*`、没有文件工具、
没有命令工具。第 7 条断言用的是 `JSON.stringify(sorted) === JSON.stringify(expected)`，
不是 `includes`，多一个少一个都会失败。

### 3. 记忆链路是同一轮内完成的

假模型在一轮对话里先 `book_remember`，再 `book_recall`，第三次请求的消息序列里出现了 `tool` 角色，
最终回答里带回了刚写入的完整记录（含 UUID 与 `created_at`）。这说明：
写入 → 检索 → 结果回传 → 模型消费，四步都通。

## 真模型冒烟（2026-10-29，deepseek-flash）

假模型只能证明「管线通」，不能证明「模型会用」。所以在 persona 补到 977 字符后，
用真实 `deepseek-official / deepseek-flash` 跑了一轮**写 + 跨会话读**：

| # | 断言 | 结果 | 实测 |
| --- | --- | --- | --- |
| 1 | 预设解析为 `book-companion` | PASS | `book-companion` |
| 2 | 写入会话 header 带预设 | PASS | `book-companion` |
| 3 | `book_remember` 真的写进库 | PASS | `source=smoke-test` 命中 2 行（kind 由模型判为 `user-view`） |
| 4 | 召回发生在另一个会话 | PASS | `session-18d99e4d-...` |
| 5 | 召回会话调用了 `book_recall` | PASS | 事件流命中 |
| 6 | 跨会话召回拿到暗号 | PASS | 回答含 `SMOKE_SECRET_青鸾-7391` |
| 7 | 无错误事件 | PASS | 0 |

做法：写入会话只说一句「请把这条记到阅读记忆里（source 写 smoke-test）」；
随后**新开一个会话**，只给「我们之前记过一个暗号，请先 book_recall 再答」。
模型在第二个会话里没有任何上下文，能答对只能来自记忆读取。

复跑：

```powershell
dsh booktest --patch profile/booktest/real-model.patch.yml --no-open --port 19398
```

报告写入 `artifacts/host-smoke.json`。

**这只证明工具可用、记忆能跨会话取回**；陪读质量、延迟、费用仍未评估，也没有覆盖
长时间对话、材料导入、回顾等场景。

## 播客转写冒烟（2026-10-29）

目标：把「只有简介」补成「有转写可引用」。用一期真实单集跑通下载 → 转写 → 入库 → 知识库笔记。

| 项 | 结果 |
| --- | --- |
| 单集 | 《Vol.09 听说宫崎骏是极端feminist？》（小宇宙） |
| 覆盖 | 前 180 秒（冒烟切片；完整版单独跑） |
| 音频 | 26 MB m4a，下载约 6 秒 |
| 转写 | 41 段、1211 字，约 103 秒（含模型加载） |
| 入库 | `material` 行，`source = 标题 + URL + #segment=1` |
| 知识库 | `Documents/ObsidianVault/dsh/podcasts/2026-10-29-Vol.09 ....md` |
| 引擎 | hermes 自带 faster-whisper（`transcribe.py`），CPU int8，small 模型 |

过程中修掉的两个真实故障：

1. **Node 默认 UA 被 403**：小宇宙页面必须带浏览器 UA，否则 `fetchEpisode` 直接失败；
2. **HuggingFace 联网校验被代理拦成 502**：模型已缓存，转写时必须 `HF_HUB_OFFLINE=1`，否则整条链路卡在模型加载。

边界：CPU + small 约 0.5 倍实时（50 分钟单集约 20 分钟）；转写不是逐字稿，引用要注明「据转写」。
完整单集的转写结果见 `dsh/podcasts/`（若已跑完）。

## 数字口径（重要）

对话里曾总结为「18/18」，但 `artifacts/host-check.json` 里实际是 **17 条 check，17 条 pass，0 条 fail**
（`node -e` 统计：`checks: 17 pass: 17 fail: 0`）。本文与 README、PLAN 统一按 **17/17** 记录。
如果后续新增断言，请让报告数字从 JSON 推导，不要手写。

## 未证明的部分

- 真实模型在长对话、材料导入、回顾场景下的表现（冒烟只覆盖单轮记忆）；
- 真实 OpenViking 的 HTTP 写入与跨会话召回；
- QQ 真号的收发、限流、断线重连；
- 完整播客音频下载与外部 ASR；
- 定时主动推送与投递去重；
- 7 天真实陪聊的质量、延迟、费用。

## 证据文件

| 文件 | 说明 |
| --- | --- |
| `artifacts/host-check.json` | 17 条断言、会话 ID、宿主 PID、Node 版本、模型选择 |
| `artifacts/host-boot-evidence.md` | 由上面的 JSON 生成的可读报告 |
| `artifacts/fake-llm.jsonl` | 6 次模型请求原始记录：真实 system prompt、tools 名、消息角色、脚本决策 |
| `artifacts/host-probe.jsonl` | 探针事件流（probe-loaded / agent/created） |
| `artifacts/host-check.log` | 退出码与失败断言名（本次为空失败列表） |

复跑步骤见 [SETUP.md](SETUP.md)。
