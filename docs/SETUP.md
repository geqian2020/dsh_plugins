# 搭建测试 profile 并复跑真机验证

目标：在不碰 `desktop` 的前提下，用独立 profile `booktest` 起一个真实 DSH 宿主，
装书童三件套 + 探针 + 自检插件，用假模型跑完一条记忆链路。

## 0. 前置

- DSH 桌面版 0.2.0-rc.2（路径记为 `<DSH>`），运行时 Node ≥ 24
- pnpm 11
- Windows 上建议把项目放在 NTFS 盘；exFAT 有坑（见第 5 节）

## 1. 构建三个本地包

```powershell
node scripts/extract-runtime.mjs        # 只读提取本机安装包依赖，供版本准确的测试
node scripts/prepare-memory-fork.mjs    # 从本机 0.5.20 生成隔离 fork；版本不符会拒绝
node scripts/sync-book.mjs              # 把 src/ 同步进 packages/book-companion/src
node scripts/patch-im.mjs               # 适配 dsh-im 5.7.0 源码（需要 vendor/dsh-im-source）
node scripts/patch-voice.mjs
node scripts/build-im.mjs               # 需要 build-tools 里的 esbuild 0.25.9
node scripts/verify.mjs                 # 12 项测试
node scripts/pack.mjs                   # 产出 dist/*.tgz + checksums.json
```

`packages/openviking-memory-isolated/`、`vendor/`、`dist/*.tgz` 都是生成物，仓库里不存。

## 2. 创建测试 profile

目录：`C:/Users/xiale/.dsh/profiles/booktest`（换成你的路径）。

`cordis.yml` 保持空树，所有组合走 patch：

```yaml
[]
```

`package.json` 声明 bundle 顺序：

```json
{
  "name": "dsh-profile-booktest",
  "private": true,
  "dependencies": {
    "dsh-book-companion": "file:<repo>/dist/dsh-book-companion-0.1.0.tgz",
    "dsh-openviking-memory-isolated": "file:<repo>/dist/dsh-openviking-memory-isolated-0.5.20.tgz",
    "dsh-im-book-isolated": "file:<repo>/dist/dsh-im-book-isolated-5.7.0-book.1.tgz",
    "dsh-host-probe": "file:<repo>/packages/host-probe",
    "dsh-book-host-check": "file:<repo>/packages/host-check"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-openviking-memory-isolated",
        "dsh-book-companion",
        "dsh-host-probe",
        "dsh-book-host-check"
      ]
    }
  }
}
```

`pnpm-workspace.yaml`：

```yaml
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
dangerouslyAllowAllBuilds: true
```

`cordis.patch.yml` 覆盖默认预设、接假网关、挂探针和自检：

```yaml
- id: agent-preset-registry
  config:
    default: book-companion
- id: llm-pi-ai
  config:
    providers:
      fake-gateway:
        displayName: Fake Gateway
        apiKeyEnv: FAKE_LLM_KEY
        api: openai-completions
        baseURL: http://127.0.0.1:19733/v1
        models:
          - id: fake-model
            name: Fake Model
            contextWindow: 200000
            maxTokens: 16384
- id: agent-default-model
  config: { provider: fake-gateway, model: fake-model }
- id: host-probe
  config:
    outFile: <repo>/artifacts/host-probe.jsonl
- id: book-host-check
  config:
    cwd: D:/DSH/shutong
    profileName: booktest
```

本仓库的 `profile/booktest/` 是实际使用的版本，可直接对照。

## 3. 安装

```powershell
cd C:/Users/xiale/.dsh/profiles/booktest
pnpm install
```

`file:` 依赖指向 `.tgz` 时，**改源码后必须重新 `pack.mjs` 并重装**，否则 profile 里还是旧代码。
指向目录（`packages/host-probe`）的依赖同理，pnpm 会做硬链接，改文件后需要 `pnpm install --force`。

## 4. 跑

```powershell
# 终端 A：假模型网关
node scripts/fake-llm-server.mjs

# 终端 B：宿主
$env:FAKE_LLM_KEY = "fake-key"
<DSH>/resources/runtime/cli/bin/dsh.cmd booktest --no-open --port 19399
```

`book-host-check` 会在宿主 ready 后自动：建书童会话 → 建主对照会话 → 跑断言 →
写 `artifacts/host-check.json` → `process.exit(ok ? 0 : 1)`。

看结果：

```powershell
$r = Get-Content artifacts/host-check.json -Raw | ConvertFrom-Json
"$($r.checks.Count) checks, $(($r.checks | Where-Object pass).Count) pass"
```

## 5. 已知坑（都实际踩过）

1. **pnpm 11 的 build script 拦截**：装 IM 包时报 `ERR_PNPM_IGNORED_BUILDS`，
   需要 `dangerouslyAllowAllBuilds: true`，且 PATH 里要有 node，否则 protobufjs / baileys
   的 build script 跑不起来。
2. **`file:` 依赖不刷新**：改了源码不重新打包/重装，profile 里仍是旧的。验证新代码前先确认
   `node_modules/dsh-book-companion/index.mjs` 的 mtime 或哈希。
3. **exFAT 不支持硬链接**：项目在 D 盘 exFAT 上时，DSH 的 write 工具会报 `EISDIR`。
   测试脚本改用 Node `fs.writeFileSync` / .NET `WriteAllText` 写入可绕开。
4. **端口占用**：假网关固定 19733，宿主默认 19399；重跑前先确认没有残留进程。
5. **profile 里不要放凭据**：`FAKE_LLM_KEY` 用环境变量注入；QQ / OpenViking 凭据只进
   DSH 本地凭据管理，不进仓库、不进聊天记录。

## 6. 清理

```powershell
Get-Process node | Where-Object { $_.Path -like '*primary-runtime*' } | Stop-Process
Remove-Item -Recurse -Force C:/Users/xiale/.dsh/profiles/booktest
```

测试 profile 与 desktop 完全独立；删除它不会影响正式环境。
