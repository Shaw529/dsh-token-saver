# 开发

## 环境要求

- Node.js ≥ 22.19
- pnpm ≥ 10（仓库用 `pnpm@11.7.0`，但我们是独立 monorepo，root range 提到 10）

## 命令清单

```bash
pnpm install            # 装依赖
pnpm run typecheck      # tsc --noEmit
pnpm run lint           # oxlint src test benchmark scripts
pnpm run test           # vitest run — 63 测试
pnpm run build          # tsc emit 到 lib/
pnpm run smoke          # mock dsh scope 端到端冒烟
pnpm run bench:compare  # 合成场景 token 对比输出 ASCII 表
```

## 双 tsconfig

- `tsconfig.json` — typecheck 模式（`noEmit: true` + `allowImportingTsExtensions: true`）
- `tsconfig.build.json` — emit 模式（`noEmit: false` + 关闭 .ts 扩展名）

## 文件树

```
dsh-token-saver/
├── src/                  # 插件主体
│   ├── lib/              # 纯函数（truncate, fold-grep）
│   ├── strategies/       # 事件策略（tool-result-trim, context-pressure, llm-summary, prompt-cache）
│   ├── config.ts         # ResolvedConfig + schema 元数据
│   ├── types.ts          # 最小 dsh 类型（无硬依赖）
│   └── index.ts          # Cordis plugin 默认导出
├── test/                 # 单元 + smoke + bench 回归
├── benchmark/            # 离线基准 + 真实 dsh 入口
├── scripts/              # mock-scope、local-smoke、generate-bench-fixture
├── website/              # VitePress 文档站
├── .github/workflows/    # CI + Pages
└── BENCHMARK.md          # 评测模板（任务清单 + 操作 + 验收）
```

## 提交 commit message 规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: 引入 tools/post-execute 折叠
fix: 修正 pre-step reject decision 透传
docs(bench): 加 stack-trace-1500 场景
refactor!: 把 strategies/ 重构成 service 三分
```

`!` 标识破坏性变更（dsh-token-saver 目前还没过 v1.0，使用前可以重排）。

## 发布版本

```bash
# 1. 改 package.json version（手动）
# 2. build + tag + push
pnpm run build
git tag v0.1.0
git push --tags

# 3. GitHub release（含 dist tarball）
gh release create v0.1.0 --title "v0.1.0" --generate-notes

# 4. npm publish
npm publish
```
