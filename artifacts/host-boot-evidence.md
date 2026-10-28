# 书童真机开机验证（测试 profile，非 desktop）

- 生成时间：2026-10-28T17:02:26.431Z
- 测试 profile：`booktest`（从 shipped headless 模板复制，组合 `dsh-base` + `dsh-web-app` + 书童三件套 + 探针/检查插件）
- 宿主：DSH 桌面版 0.2.0-rc.2；运行时 Node v24.18.1；Windows 11 26H2 build 26300.9711
- 模型：本地假 OpenAI-compatible 网关（`scripts/fake-llm-server.mjs`，端口 19733），脚本化为 book_remember → book_recall → 最终回答
- 结果：**全部通过**（17/17）

## 断言明细

| 结果 | 断言 | 值 |
| --- | --- | --- |
| PASS | preset resolves to book-companion | "book-companion" |
| PASS | book session header.agentPreset is book-companion | "book-companion" |
| PASS | main comparison session is not book-companion | null |
| PASS | book model requests observed | 3 |
| PASS | book system prompt contains companion persona | 231 |
| PASS | book system prompt excludes MAIN_PERSONA_SENTINEL | null |
| PASS | book tool surface is exactly the six companion tools | ["book_episode","book_forget","book_import_transcript","book_recall","book_remember","book_review"] |
| PASS | decision 1 is book_remember | {"kind":"tool","name":"book_remember","args":"{\"kind\":\"material\",\"text\":\"《史记·项羽本纪》测试材料：项王军壁垓下，兵少食尽；于是项王乃悲歌慷慨。\",\"source\":\"fixture:史记/项羽本纪\"}"} |
| PASS | decision 2 is book_recall | {"kind":"tool","name":"book_recall","args":"{\"query\":\"史记\"}"} |
| PASS | decision 3 is final text with ROUNDTRIP_OK | {"kind":"text","text":"ROUNDTRIP_OK [{\"id\":\"14576e97-d3c5-4ec4-b68b-00f5b2ffde74\",\"session_id\":\"session-ed5bbd36-b8a6-4dd5-8fbe-01f1f71af364\",\"kind\":\"material\",\"text\":\"《史记·项羽本纪》测试材料：项王军壁垓下，兵少食尽；于是项王乃悲歌慷慨。\ |
| PASS | tool result returned to the model | ["system","user","user","assistant","tool","assistant","tool"] |
| PASS | main session prompt carries MAIN_PERSONA_SENTINEL | 1 |
| PASS | book assistant final answer observed | 3 |
| PASS | book session persisted as JSONL | "C:\\Users\\xiale\\.dsh\\sessions\\--D-DSH-shutong--\\session-ed5bbd36-b8a6-4dd5-8fbe-01f1f71af364\\session.v4.jsonl.zstd" |
| PASS | main session persisted as JSONL | "C:\\Users\\xiale\\.dsh\\sessions\\--D-DSH-shutong--\\session-d54e9d23-8e96-4aa4-9d9c-b961b211cbf9\\session.v4.jsonl.zstd" |
| PASS | persisted book session header records book-companion | {"type":"session","version":4,"id":"session-ed5bbd36-b8a6-4dd5-8fbe-01f1f71af364","createdAt":1793206942959,"cwd":"D:/DSH/shutong","isSeeded":false,"delegationDepth":0,"agentPreset":"book-companion"} |
| PASS | persisted main session header records no book preset | {"type":"session","version":4,"id":"session-d54e9d23-8e96-4aa4-9d9c-b961b211cbf9","createdAt":1793206943212,"cwd":"D:/DSH/shutong","isSeeded":false,"delegationDepth":0} |

## 证据文件

- `artifacts/host-check.json`：本次断言报告（含失败时的错误栈）
- `artifacts/fake-llm.jsonl`：模型请求原始记录（含实际 system prompt、tools 名、消息角色序列与脚本决策），共 6 条
- `artifacts/host-probe.jsonl`：宿主探针记录（probe-loaded / agent/created 的事件流，共 3 条）
- 会话落盘：`C:/Users/xiale/.dsh/sessions/--D-DSH-shutong--/<session-id>/session.v4.jsonl.zstd`

## 关键结论

1. 首条消息发出前，会话 header 已带 `agentPreset: book-companion`；主对照会话的 header 无 preset。
2. 书童会话的系统提示词只包含书童 persona（231 字符），**不包含**主画像哨兵 `MAIN_PERSONA_SENTINEL`；对照主会话的提示词（3049 字符）包含该哨兵——隔离是真实生效的，不是没注入造成的假阴性。
3. 模型侧看到的工具面恰好是 6 个 `book_*` 工具，没有主记忆 MCP 工具、没有文件/命令工具。
4. 假模型一轮内完成 `book_remember` → `book_recall` → 最终回答；工具结果以 `tool` 角色回传给模型（ROUNDTRIP_OK）。
5. 会话已持久化为 session.v4 JSONL(Zstd)，header 记录 `agentPreset: book-companion`。

## 复跑方式

```powershell
# 1) 假模型网关（已在运行；重跑用）
$N = "<DSH>/resources/runtime/primary-runtime/dependencies/node/bin/node.exe"
& $N D:/antigravity_veido/book-companion/scripts/fake-llm-server.mjs

# 2) 启动测试 profile（host-check 会在开机后自动执行并写 artifacts/host-check.json，然后以退出码表示结果）
$env:FAKE_LLM_KEY = "fake-key"
& "<DSH>/resources/runtime/cli/bin/dsh.cmd" booktest --no-open --port 19399
```

## 边界

- 本验证证明的是 **组合、身份、提示词隔离、工具面、记忆工具链路**；不等于真实模型质量或真实 OpenViking 网络往返（下一步）。
- 测试用 profile 位于 `C:/Users/xiale/.dsh/profiles/booktest`；desktop profile 未被修改。
- `packages/host-probe`、`packages/host-check` 是测试基础设施，不进入 dist 包。
