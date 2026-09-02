# 架构

## 文件树

```
src/
  lib/
    truncate.ts          # 字节预算头尾截断，按行边界切
    fold-grep.ts         # 匹配保留型 grep 折叠
  strategies/
    tool-result-trim.ts  # tools/post-execute: 按工具名路由、content 改写
    context-pressure.ts  # agent/pre-step: 查 tokenMeter、调 ctx.compaction
    llm-summary.ts       # CompactionEngine 子类（replaceBasicCompaction=true 时启用）
    prompt-cache.ts      # systemPrompt 段重排 utility，稳顺序提 cache 命中
  config.ts              # ResolvedConfig + schema 元数据
  types.ts               # 最小 dsh 形状类型（不硬依赖内部包）
  internal.ts            # 跨策略 import 桶
  index.ts               # Cordis 插件：name / Config / inject / apply
```

## 三个 dsh 扩展点

| 扩展点 | 我们用它做什么 | 默认档表现 |
|---|---|---|
| `tools/post-execute` (waterfall) | `decidePostTool` 决定是否折叠 content | conservative 起就启用 |
| `agent/pre-step` (waterfall) | `decidePreStep` 查 tokenMeter / 调 ctx.compaction | balanced 起启用 |
| `ctx.compaction` Service Definition | `LlmSummaryCompactionEngine` 子类化 | aggressive 才替换 |

## 设计原则

1. **不替换 dsh 默认行为，除非显式 `mode: 'aggressive' + replaceBasicCompaction: true`。**
2. **所有 fold 都走 dsh 的事件**，不进私有字段 → 重放/快照不变。
3. **不硬依赖 dsh 私有** —— `@deepseek-ai/cordis`、`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-compaction` 都是 peerDependencies（可 optional），编译期类型用 `import type`，运行时通过动态 trait 适配。
