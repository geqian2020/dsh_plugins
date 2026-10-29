# 交接说明（HANDOFF）

## 最新迭代：0.2.0 持续阅读搭子

已经修改人设，支持自然讨论经历、独立观点与阅读兴趣；新增 RSS/Atom 发现、文章正文提取/入库、共同问题和双方分歧持久化。可选后台阅读在会话空闲时读正文并续接 DSH 会话，默认关闭，带日限额、安静时段和持久化去重；尚未做 QQ 主动投递。

本轮已更新 booktest，不动 desktop。新宿主验证全部使用临时数据。实际测试结果以 `docs/COMPANION-VERIFICATION.md`、`artifacts/companion-host-verification.json` 和 `artifacts/verification.json` 为准；真模型探索测试使用虚构材料，不能当作真实选材质量证明。

核心位置：`src/persona.mjs`、`src/exploration.mjs`、`src/proactive.mjs`、`src/store.mjs`。共享源码经 `scripts/sync-book.mjs` 同步至包，工具合同是 `src/contract.mjs`。版本 0.2.0，新依赖 saxes/linkedom/Mozilla Readability。

复跑：安装根目录依赖后执行 `node scripts/verify.mjs`、`node scripts/pack.mjs`、`node scripts/install-booktest.mjs`、`node scripts/check-companion.mjs --real`。测试启动使用 DSH 随附 Node 与已提取的安装版 CLI；测试探针可以启用虚构阅读源传输，正常配置不启用。详见 `docs/COMPANION.md`。

后续：真实来源与体验评估、OpenViking 网络审计、QQ 真号及出站投递、长音频转写后台队列、统一回归、desktop 上线关卡。`publish.cmd` 已取消强制推送，不要覆盖远端历史。

---

以下是 0.1.x 的历史交接记录，其中数量、工具面和未完成项以最新迭代说明为准。

> 更新时间：2026-10-29 23:05 · 交给下一个接手的 AI
> 先读这份，再读 `PLAN.md`（目标与验收）和 `docs/ARCHITECTURE.md`（设计）。

## 0. 一句话

DSH（DeepSeek Harness）上的「书童」阅读搭子：**独立人设 + 独立记忆**，已在**测试 profile** 跑通真机与真模型；
**尚未接入正式 desktop，也尚未接 QQ 真号**。

## 1. 东西在哪

| 项 | 路径 |
| --- | --- |
| 代码（本地） | `D:/antigravity_veido/book-companion`（git，main） |
| 代码（远端） | `https://github.com/geqian2020/dsh_plugins`（公开） |
| 测试 profile | `C:/Users/xiale/.dsh/profiles/booktest`（**不要动 desktop**） |
| 书童活库 | `C:/Users/xiale/.dsh/book-companion/reading.sqlite` |
| Obsidian 知识库 | `C:/Users/xiale/Documents/ObsidianVault/dsh/`（podcasts / reading / reviews / inbox） |
| DSH 安装 | `C:/Users/xiale/AppData/Local/Programs/DeepSeek Harness` |

## 2. 已完成并验证（数字都来自 artifact）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| P0-1 真机开机（假模型） | **17/17** | `artifacts/host-check.json` |
| 真模型记忆链路 | **7/7**（`deepseek-flash`，写入 → 新会话 recall） | `artifacts/host-smoke.json` |
| 单元/回归测试 | **13/13** | `artifacts/verification.json` |
| 播客转写链路 | 13:34 音频 → 6653 字 / 5 段 / 8 分 05 秒 | `docs/VERIFICATION.md` 播客一节 |
| 工具面 | 恰好 7 个 `book_*`，无主记忆/文件/命令工具 | `host-check.json` 第 7 条 |

已实现：persona（1043 字符）、SQLite 记忆（来源/作者分类、tombstone 防复活）、
小宇宙简介（metadata-only）、转写分段、时间范围回顾、QQ 路由补丁、转写错字下的二元组召回。

## 3. 未完成（按优先级）

1. **`verify-all.mjs`**：一条命令串起 13 + 79 + 7 + 真机 17 + 真模型 7 + 构建导入；报告字段从运行推导。**建议先做这个**，后面所有改动都靠它回归。
2. **OpenViking 沙盒**：本机没有 `~/.openviking/ovcli.conf`。需要沙盒 endpoint + key，或授权用现有实例但指定独立 peer。要验的是「主记忆在真实网络下确实不注入/不召回/不写书童会话」。
3. **QQ 真号**：把机器人凭据配进 booktest（只进 DSH 本地凭据），验 `/new`、文本/图片/语音、断线重连、跨会话拒绝。
4. **文章导入 + 端到端回顾**：播客链路已通，文章正文还没接；补一条「读进去 → 分段 → 记住 → 回顾」的演示命令并留 artifact。
5. **desktop 上线方案**：必须用隔离版主记忆**替换**现有 bundle，不能两套并存；先备份、留回滚。
6. **长音频后台队列**：现在 `book_transcribe` 是同步调用，50 分钟单集约 30 分钟会占住会话。

## 4. 复跑命令

```powershell
cd D:\antigravity_veido\book-companion

# 单测
node --test test/*.test.mjs

# 假模型真机断言（另开终端先跑 node scripts/fake-llm-server.mjs）
$env:FAKE_LLM_KEY="fake-key"
& "<DSH>\resources\runtime\cli\bin\dsh.cmd" booktest --no-open --port 19399
# 结果看 artifacts/host-check.json，退出码 0/1

# 真模型（deepseek-flash）
dsh booktest --patch profile/booktest/real-model.patch.yml --no-open --port 19398

# 播客转写（独立于宿主，便于排查）
node scripts/transcribe-episode.mjs "https://www.xiaoyuzhoufm.com/episode/<id>" [--max-seconds 180]

# 重新打包
node scripts/pack.mjs
```

**改完代码必须重打包并手动解包进 profile**：

```powershell
rm -rf C:\Users\xiale\.dsh\profiles\booktest\node_modules\dsh-book-companion
mkdir  C:\Users\xiale\.dsh\profiles\booktest\node_modules\dsh-book-companion
tar -xzf D:\antigravity_veido\book-companion\dist\dsh-book-companion-0.1.0.tgz -C C:\Users\xiale\.dsh\profiles\booktest\node_modules\dsh-book-companion --strip-components=1
```

## 5. 已知坑（都实际踩过，别再踩）

1. **小宇宙页面 403**：Node 默认 UA 被拦，必须带浏览器 UA（`src/materials.mjs` 的 `EPISODE_HEADERS`）。
2. **HuggingFace 502**：faster-whisper 会联网校验；模型已缓存，转写必须 `HF_HUB_OFFLINE=1`、`TRANSFORMERS_OFFLINE=1`。
3. **pnpm `file:` tgz 不刷新**：改包后 `pnpm install` 会说 “Already up to date”，必须手动解包（见上）。
4. **D 盘 exFAT 不支持 hardlink**：DSH write 工具会报 `EISDIR`，脚本改用 Node/WriteAllText。
5. **cmd 里的中文会按 GBK 解析**：批处理只能是纯 ASCII，否则命令串行（`publish.cmd` 已改）。
6. **PowerShell 没有 git**：本机 git 是 WorkBuddy 自带 PortableGit，不在 PATH；脚本里用绝对路径。
7. **假网关日志跨轮追加**：`host-check` 会读到上一轮的 prompt（曾把 231 当成新结果）。已改为每次启动清空。
8. **`complete: true` 会清空宿主指令**：工具用法、输出格式都要自己写进 persona，否则真模型不会调工具。
9. **ASR 错字**：`宫崎骏` 被识别成 `宫崎俊`，精确检索会落空；`book_recall` 已加二元组退化（半数命中阈值）。

## 6. 硬约束

- **不要动 `desktop` profile 和主记忆数据**；所有验证在 `booktest`。
- **凭据不进仓库、不进聊天**：QQ AppID/Secret、OpenViking key 只放 DSH 本地凭据管理。
- 主记忆 bundle 不能两套并存监听同一会话，上线必须替换 + 备份 + 回滚。
- 报告字段必须从运行结果推导，禁止手写数字（历史上出现过 18/17 的口径偏差）。

## 7. 远端

`geqian2020/dsh_plugins` 已推 10 个 commit / 73 个文件（公开仓库）。
沙盒访问不了 `github.com`（只通 `api.github.com`），所以**推送要在本机终端跑 `publish.cmd`**；
GitHub 连接器只有读权限（写操作 403），别指望用它推代码。

## 8. 建议的接手顺序

1. 先读 `PLAN.md` 第 5 节，确认目标没跑偏；
2. 跑一遍 `node --test` 和假模型真机断言，确认基线是 13/13 + 17/17；
3. 做 `verify-all.mjs`；
4. 拿到 OpenViking 沙盒信息后做隔离审计；
5. QQ 凭据到位再做真号；
6. 最后才谈 desktop 替换与 7 天试用。
