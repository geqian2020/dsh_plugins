# 书童 0.2.0 验证记录

生成时间（UTC）：2026-10-29T15:29:59.053Z。数字从实际 artifact 推导。

| 检查 | 通过 / 总数 | 结果 |
| --- | --- | --- |
| 单元与进程内集成 | 19 / 19 | PASS |
| 真实宿主 / 假模型 | 17 / 17 | PASS |
| 真实模型跨会话记忆 | 7 / 7 | PASS |
| 真实模型探索陪读（虚构 RSS/正文） | 10 / 10 | PASS |

宿主：booktest；启动方式：Installed bundled Node and CLI extracted from the installed DSH archive。每次新建临时数据库，不写实际阅读库。

真实模型使用本地已配置的 deepseek-flash。探索测试中，模型找回双方的旧分歧，调用候选发现和正文读取，使用正文才出现的信息并保存自己的判断。模型明确指出虚构材料不能作为历史证据，保留用户立场。详见 `artifacts/companion-exploration-real.json`。

后台定时流程的空闲判断、日限额和重启去重由单测验证；没有把它说成真实 QQ 主动投递或真实定时触发的模型验收。外部订阅源可用性与推荐质量未验证。

## 产物校验和

- dsh-book-companion-0.2.0.tgz: SHA256 d79e7543754f5d7901151eb1d8cf0cfe2143d24e2a424c8f11e682a92336bb65
- dsh-openviking-memory-isolated-0.5.20.tgz: SHA256 5a3d3b356bf93b348d45045a828e49007339eb4c2db53302785cb56a26c8f96d
- dsh-im-book-isolated-5.7.0-book.1.tgz: SHA256 28fca0f7e07b751f831050014f74d8961b426d7d08cea4155c71f1b89c11976a

## 仍未验证

- Real OpenViking network audit
- QQ proactive delivery
- External feed availability and recommendation quality
- Seven-day user experience
- 长音频后台转写、完整宿主重启/压缩，以及七天真实体验。

## 证据

- `artifacts/verification.json`：单元及进程内集成输出。
- `artifacts/companion-host-verification.json`：各宿主阶段汇总。
- `artifacts/companion-fake.json` 与 `companion-fake-requests.jsonl`：真实工具面、system prompt 和主对照会话。
- `artifacts/companion-real.json`：跨会话真实模型记忆。
- `artifacts/companion-exploration-real.json`：探索工具调用、回答和双方观点。
