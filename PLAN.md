# 小书童：目标、验收与执行计划

> 本文把「要做什么、按什么顺序做、每步怎么验收、现在到哪了、卡在哪」固定下来。
> 状态更新时间：2026-10-29 01:15（Asia/Shanghai）

## 1. 目的（要解决什么）

做一个**独立于主助手的阅读搭子「小书童」**，挂在 DSH 上：

1. **独立人设**：只做阅读/讨论/纠错/回顾，不越界当通用助手。
2. **独立记忆**：书童有自己的一套阅读记忆（用户原话、助手观点、材料、暂定偏好），**与主助手记忆物理隔离**，主助手看不到书童，书童也拿不到主记忆/主文件/主会话工具。
3. **可接入 QQ**：通过 QQ 官方机器人陪聊，入口锁定为书童（预设 + 工作目录固定），不接受跨会话/切换入口。
4. **能读材料**：逐步支持文章/播客的「读进去 → 分段 → 记住 → 回顾」；没读完/没听过就明确说没读，不编造。
5. **长期**：主动陪读、定时回顾/推送、推荐探索、记忆管理与导出。

## 2. 期望（什么算做好）

- **真机可用**：不是单测通过，而是在真实 DSH 宿主里能开机、能建书童会话、能接真模型、能接 QQ。
- **有可复现证据**：每一步留下 artifact（JSON/日志），一条命令能重跑；报告字段来自实际运行，不能手写。
- **不污染正式环境**：所有验证先在**测试 profile**（`booktest`）完成；`desktop` 的配置与主记忆数据不动，上线前保留备份与回滚。
- **诚实标注边界**：区分「已实现 / 已验证 / 未验证」，不能把测试数当成品质量。

## 3. 执行原则

1. **真机优先**：能用真实宿主组合验证的，不用 mock 代替；mock 只用于模型/网络外部依赖。
2. **先通链路，再加功能**：P0 真机链路没通之前不动产品功能。
3. **隔离双保险**：预设/工具层 + 主记忆插件补丁层都要有证据；主画像不得注入书童提示词。
4. **证据自动化**：`verify-all.mjs` 一次跑完，artifact 每次覆盖，写死字段一律删除。
5. **外部依赖先沙盒**：OpenViking、QQ、真模型都先用测试实例/测试账号，避免污染真实数据。

## 4. 执行顺序与依赖

```
P0-1 真机开机（✅ 完成）
  └─ P0-2 真模型 + 沙盒 OpenViking recall 往返（进行中，等待 OpenViking 信息）
       └─ P0-3 QQ 真号（等待 QQ 机器人凭据）
P1-4 verify-all.mjs（不依赖外部输入，可立即做）
P1-5 产品最小闭环「读进去 → 分段 → 记住 → 回顾」（P0-2/3 之后）
P2   主动陪读/定时推送/推荐、记忆管理 UI/导出
P3   上线关卡：替换主记忆 bundle、备份回滚、7 天真实试用评估
```

## 5. 各阶段：做法、验收、当前状态

### P0-1 真机开机（测试 profile）✅ DONE

- **做法**：测试 profile `booktest`（base + web-app + 书童三件套 + 测试探针），本地假 OpenAI 网关驱动一轮完整记忆链路。
- **验收（已达成，17/17 PASS；以 `artifacts/host-check.json` 为准，早期摘要误记为 18/18）**：
  - 首条消息前 header `agentPreset=book-companion`；
  - 书童系统提示词有人设、**无**主画像哨兵（主对照会话有，证明隔离真实生效）；
  - 工具面恰好 6 个 `book_*`；
  - `book_remember → book_recall → 最终回答` 链路通，工具结果回传模型；
  - 会话落盘 `session.v4.jsonl.zstd`，header 正确。
- **证据**：`artifacts/host-boot-evidence.md`、`artifacts/host-check.json`、`artifacts/fake-llm.jsonl`、`artifacts/host-probe.jsonl`。

### P0-2 真模型 + 沙盒 OpenViking（真模型 ✅ / OpenViking ⏳）

- **真模型部分已完成（7/7）**：`deepseek-official / deepseek-flash` 下，书童会话真实调用 `book_remember`（`source=smoke-test` 落库），随后**新开会话**只给一句「我们之前记过一个暗号」，模型先 `book_recall` 再答，取回正确内容。证据：`artifacts/host-smoke.json`，复跑用 `profile/booktest/real-model.patch.yml`。
- **仍未验证**：主记忆隔离插件在**真实 OpenViking** 下的行为——画像是否真的不注入、召回是否真的被跳过、是否不会写进主记忆空间；以及完整重启、压缩、后台任务各跑一遍。
- **阻塞**：本机没有 `~/.openviking/ovcli.conf`/`ov.conf`。需要：**A** 沙盒实例 endpoint + key；或 **B** 授权使用现有实例但指定独立 peer 隔离。
- **注意**：书童自己的记忆是 SQLite，不依赖 OpenViking；OpenViking 只影响「书童与主助手并存」时的隔离审计。

### P0-3 QQ 真号（等待凭据）

- **做法**：测试 profile 启用 IM bundle，安装其外部运行时依赖；按**正确层级**配置 `config.qq.bookCompanionBots`（注意 `config.example.json` 的 `imHost` 只是示意分组，插件实际读 `config.qq.*`，并在启动时加“配置了但未生效”的校验）；用真实 QQ 官方机器人凭据联调。
- **验收**：`/new` 创建书童会话（预设与工作目录固定）；文本、图片、语音（平台 ASR）各一轮；断线重连；发送拒绝/延迟回复；跨会话命令被拒；入口切换被拒。
- **阻塞**：需要把 QQ 机器人凭据配置到测试 profile（凭据只放 DSH 本地凭据管理，不写进仓库/聊天）。
- **风险**：当前 QQ 改版包是源码打补丁 + 重打包产物，真实账号联调是最大未知数；失败时回退到“先只做 web 端书童”。

### P1-4 verify-all.mjs（可立即做）

- **做法**：一条命令串起：12 项书童测试 + 79 项 QQ/会话回归 + 7 项状态恢复 + 真机开机 + 构建导入冒烟 + profile 组合校验；报告字段从运行结果推导（session id、PASS/FAIL、耗时、版本、profile、artifact 哈希），每次覆盖 `artifacts/verification.json`；失败退出非零。
- **验收**：在干净机器上 `node scripts/verify-all.mjs` 一条命令复现全部证据；日志分组可读；不再有硬编码字段。
- **备注**：要处理已发现的坑：pnpm 11 `allowBuilds`、`file:` 依赖不刷新（改用版本化 tgz 或重装）、D 盘 exFAT 不支持 hardlink（DSH write 工具会 EISDIR）。

### P1-5 产品最小闭环（P0-2/3 之后）

- **做法**：先做不依赖 ASR 的闭环：文章正文/播客转写文本导入 → 按段入库（已有 `book_import_transcript`/`segmentTranscript`）→ 书童记忆 → 按时间范围回顾（已有 `book_review`）→ 端到端演示脚本。音频下载/外部 ASR 后置。
- **验收**：一个真实材料（一篇文章或一段播客转写）跑完「读进去→分段→记住→回顾」，书童能引用来源、区分用户与自己的观点；演示命令与证据入 artifact。

## 6. 当前完成的基础设施

| 组件 | 位置 | 说明 |
| --- | --- | --- |
| 测试 profile | `C:/Users/xiale/.dsh/profiles/booktest` | 不影响 desktop |
| 假模型网关 | `scripts/fake-llm-server.mjs` | 记录真实 prompt/tools 请求 |
| 宿主探针 | `packages/host-probe/` | 模拟主画像 + 记录 agent 事件 |
| 宿主检查 | `packages/host-check/` | 开机自动跑断言、写 artifact、退出码表示结果 |
| 证据 | `artifacts/host-*` | 每次运行覆盖 |

## 7. 需要决策/提供的信息

1. **OpenViking**：A 沙盒实例 endpoint + key；B 用现有实例 + 独立 peer；C 先跳过。
2. **QQ**：机器人 AppID/Secret（仅配到 DSH 本地凭据，不进仓库）；或先跳过、只做 web/headless 书童。
3. **上线策略**：确认最终是“用修改后的主记忆 bundle 替换旧 bundle”，并接受备份/回滚步骤；还是保持双实例并存（README 明确说不能并存监听同一会话，需要确认）。

## 8. 风险与边界

- 现在证明的是“组合/身份/提示词隔离/工具面/记忆工具链路”，**不等于**真实模型质量与真实 OpenViking 网络往返。
- 书童系统提示词已从 231 字符补到 977 字符（工具语义、记忆纪律、诚实边界），并用 `deepseek-flash` 跑通「写入 → 跨会话召回」7/7；长对话、材料导入、回顾仍未验证。
- 两个 fork（主记忆 bundle、dsh-im 源码改版）是主要维护成本，上游升级必须重做补丁并重跑 verify-all。
- 正式上线前必须：备份原配置、保留回滚、7 天真实试用评估质量/速度/费用。