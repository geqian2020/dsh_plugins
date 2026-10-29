# 小书童（book-companion）

一个挂在 **DSH（DeepSeek Harness）** 上的阅读搭子：**独立人设 + 独立记忆**，与主助手物理隔离。
不是通用助手，只做阅读、讨论、纠错、回顾。

> 当前阶段：**P0-1 真机开机 17/17**，**P0-2 真模型 7/7**（`deepseek-flash` 写入 + 跨会话召回）；
> OpenViking 沙盒与 QQ 真号仍在等待外部凭据。
> 本仓库是开发快照，**尚未上线，也未改动任何正式 desktop 配置**。

## 它要解决的问题

主助手有全局画像、文件工具、命令工具和主记忆。把「陪读」直接塞进主助手，会出现三个问题：

1. 人设被通用助手稀释，聊着聊着就开始帮你写代码；
2. 阅读记忆和主记忆混在一起，画像被阅读内容污染；
3. 接 QQ 后，任何会话都能触发主助手，入口收不住。

小书童的做法是反过来：**先造一个受限的独立会话身份，再让它只带 7 个阅读工具**。

## 隔离模型（四层，逐层都有断言）

| 层 | 机制 | 证据 |
| --- | --- | --- |
| 组合层 | `cordis.patch.yml` 把运行时挂在 `@deepseek-ai/dsh-agent-preset` 的 `book-companion` 预设内，不全局注册 | 会话 header `agentPreset=book-companion` |
| 工具层 | `ctx.tools.guard` 拒绝一切非 `book_*` 调用；`agent/created` 时 `tools.restrict` 只放行 7 个工具 | 模型侧工具面恰好 7 个，无主记忆 / 文件 / 命令工具 |
| 提示词层 | `systemPrompt.section({complete:true})` 整体替换系统提示词 | 书童 1043 字符 vs 主会话 3049 字符，且不含 `MAIN_PERSONA_SENTINEL` |
| 记忆层 | `dsh-openviking-memory-isolated` fork：按预设 / 工作目录跳过主记忆的画像注入、召回、捕获、提交与 flush，并拦截 `mcp__openviking__*` | 新增会话/重启后仍不注入主画像（见 `docs/ARCHITECTURE.md`） |

书童自己的记忆落在 `~/.dsh/book-companion/reading.sqlite`，记录保留 `kind / text / source / session_id / created_at`，
区分「用户原话 / 助手观点 / 材料 / 暂定偏好」，删除后不会被事件重放复活。

## 状态

| # | 任务 | 状态 | 说明 |
| --- | --- | --- | --- |
| P0-1 | 真机开机（测试 profile） | ✅ 17/17 | 真实宿主、假模型、完整 `book_remember → book_recall` 链路 |
| P0-2 | 真模型 + 沙盒 OpenViking | 🟡 真模型已通，OpenViking 仍阻塞 | `deepseek-flash` 跑通「写入 → 新会话召回」7/7；OpenViking 仍缺沙盒 endpoint/key |
| P0-3 | QQ 真号 | ⏳ 阻塞 | 等待机器人凭据配置进测试 profile（不入仓库） |
| P1-4 | `verify-all.mjs` 一条命令复现 | 🟢 可做 | 串起 12 + 79 + 7 项测试、真机开机、构建导入冒烟 |
| P1-5 | 产品最小闭环 | 🟡 播客链路已通 | 链接→下载→转写→分段入库→知识库笔记；文章导入与端到端回顾待补 |
| P2 | 主动陪读、定时推送、推荐、记忆管理 UI | ⏸ | — |
| P3 | 上线：替换主记忆 bundle、备份回滚、7 天试用 | ⏸ | 不允许两套 bundle 同时监听同一会话 |

完整的目标、验收标准与风险见 [PLAN.md](PLAN.md)。

## 已实现 / 已验证 / 未验证

**已实现并有测试**（`node --test`，13 项通过）

- 预设、独立 system prompt、会话级工具允许列表与执行授权；
- 独立 SQLite 阅读记忆，保留来源与作者类别，对话自动留档并过滤注入上下文；
- 主记忆 0.5.20 的可重建补丁：排除画像注入 / 召回 / 捕获 / 提交 / flush；
- 专属目录中的非书童会话被拒绝运行（防分叉丢预设）；
- 小宇宙标题/简介读取（明确标注 metadata-only）、转写文本导入与分段、按时间范围回顾；
- 播客单集：链接 → 下载音频 → 本地 faster-whisper 转写 → 分段入库 + 知识库笔记（`<vault>/dsh/podcasts`）；
- QQ 补丁：固定预设与工作目录、绑定持久化、拒绝跨会话命令与入口切换；语音优先用平台 ASR 文本。

**已证实的真机行为**（`artifacts/host-check.json`，17/17）

- 首条消息前 header 已带 `agentPreset: book-companion`；
- 主对照会话（3049 字符）带 `MAIN_PERSONA_SENTINEL`，书童（1043 字符）不带——隔离不是「没注入」造成的假阴性；
- 工具面恰好 7 个 `book_*`；
- 假模型一轮内完成 `book_remember → book_recall → ROUNDTRIP_OK`，工具结果以 `tool` 角色回传；
- 会话落盘 `session.v4.jsonl.zstd`，header 记录预设。

**真模型冒烟**（`artifacts/host-smoke.json`，7/7，`deepseek-flash`）

- 书童会话里真实调用 `book_remember`，SQLite 出现 `source=smoke-test` 的记录；
- **换一个全新会话**，只给一句「我们之前记过一个暗号」，模型先 `book_recall` 再答，取回了正确内容；
- 两次会话 header 都是 `book-companion`，无错误事件。

> 这只证明「真模型会用这 7 个工具、记忆能跨会话取回」，不等于陪读质量、延迟与费用已评估。

**未验证**

- 真实模型质量、延迟、费用；
- 真实 OpenViking HTTP 往返与跨重启召回；
- QQ 真号收发、断线重连；
- 完整播客音频下载与外部 ASR；
- 定时主动推送与投递去重。

## 复跑 P0-1

```powershell
# 1) 假模型网关（OpenAI-compatible，127.0.0.1:19733）
node scripts/fake-llm-server.mjs

# 2) 测试 profile（不要用 desktop）
$env:FAKE_LLM_KEY = "fake-key"
dsh booktest --no-open --port 19399
```

宿主启动后 `packages/host-check` 自动建两个会话（书童 + 主对照）、跑完断言、写
`artifacts/host-check.json`，用退出码表示结果。逐步搭建与已知坑见
[docs/SETUP.md](docs/SETUP.md)，断言明细见 [docs/VERIFICATION.md](docs/VERIFICATION.md)。

## 目录

```
packages/book-companion/     书童插件：preset、7 个工具、persona、SQLite 记忆
packages/openviking-memory-isolated/  主记忆隔离 fork（生成物，不入库）
packages/host-probe/         宿主探针：注入主画像哨兵、记录 agent 事件
packages/host-check/         开机自检：建会话、断言、写 artifact、退出码
src/                         共享源码（isolation / store / materials）
scripts/                     构建、打补丁、假网关、验证、打包
test/                        13 项单元/回归测试
patches/dsh-im/              QQ 路由与语音文本补丁
profile/booktest/            测试 profile 的组合与配置（不含凭据）
artifacts/                   本次真机验证的证据（报告 + 原始请求日志）
docs/                        架构、验证、环境搭建
```

## 知识库落盘（Obsidian）

转写与笔记写到 `~/Documents/ObsidianVault/dsh/`（`BOOK_KB_ROOT` 可覆盖）：

| 目录 | 内容 |
| --- | --- |
| `podcasts/` | 播客转写，`YYYY-MM-DD-标题.md`，带来源与覆盖范围 |
| `reading/` | 文章、书摘、材料笔记 |
| `reviews/` | 周/月回顾 |
| `inbox/` | 待归类 |

**它不是活库**：活库是 SQLite，删掉笔记不会让书童失忆。转写引擎复用 hermes 的 faster-whisper；
相关路径可用 `BOOK_ASR_PYTHON`、`BOOK_ASR_SCRIPT`、`BOOK_FFMPEG` 覆盖。

## 证据

| 文件 | 内容 |
| --- | --- |
| [artifacts/host-check.json](artifacts/host-check.json) | 17 条断言、会话 ID、模型选择、宿主版本 |
| [artifacts/host-boot-evidence.md](artifacts/host-boot-evidence.md) | 人类可读的验证报告（生成自上面的 JSON） |
| [artifacts/fake-llm.jsonl](artifacts/fake-llm.jsonl) | 模型实际收到的 system prompt、tools、消息角色序列 |
| [artifacts/host-probe.jsonl](artifacts/host-probe.jsonl) | 宿主探针事件流 |
| [artifacts/host-smoke.json](artifacts/host-smoke.json) | 真模型冒烟：写入 + 跨会话召回的 7 条断言 |
| [artifacts/verification.json](artifacts/verification.json) | 13 项测试报告与未验证清单 |
| [artifacts/im-verification.json](artifacts/im-verification.json) | QQ 回归 79 项 + 状态恢复 7 项 |

## 边界与安全

- 本仓库只证明**组合、身份、提示词隔离、工具面、记忆工具链路**，不等于真实模型质量。
- 所有验证在测试 profile `booktest` 完成，`desktop` 配置与主记忆数据未被修改。
- 仓库内**没有任何账号凭据**。QQ AppID/Secret、OpenViking key 只放 DSH 本地凭据管理。
- `dist/*.tgz`、`vendor/`、`packages/openviking-memory-isolated/` 为生成物/第三方源码，由脚本重建，不入库。
- 两个 fork（主记忆 bundle、dsh-im 源码改版）是主要维护成本，上游升级必须重做补丁并重跑验证。
