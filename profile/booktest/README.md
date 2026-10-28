# 测试 profile `booktest`

这是 P0-1 真机验证时实际使用的 profile 配置，原样归档，用于复现与审计。

- 它**不是**可直接使用的配置：`package.json` 里的 `file:` 路径指向本机仓库目录，换机器需改。
- 它**不含任何凭据**：假网关的 key 由环境变量 `FAKE_LLM_KEY` 注入。
- 它**不影响** `desktop`：profile 目录独立，宿主用 `dsh booktest` 启动。

| 文件 | 作用 |
| --- | --- |
| `cordis.yml` | 空树，组合全部由 bundle + patch 完成 |
| `cordis.patch.yml` | 默认预设、假模型 provider、探针与自检插件 |
| `package.json` | bundle 顺序与本地包依赖 |
| `pnpm-workspace.yaml` | `nodeLinker: hoisted`、`dangerouslyAllowAllBuilds: true` |

搭建步骤与已知坑见 [`../docs/SETUP.md`](../docs/SETUP.md)。
