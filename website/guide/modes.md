# 四种模式

插件默认 `conservative` —— 只做工具结果的无损头尾折叠。要不要激进是你来定。

| 模式 | 头尾裁剪 | grep 折叠 | 触发 `ctx.compaction` | 替换 `dsh-compaction-basic` | LLM-summary engine |
|---|---|---|---|---|---|
| `off` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `conservative` (默认) | ✅ | ✅ | ❌（保留 dsh 默认） | ❌ | 可选 |
| `balanced` | ✅（更紧 budget） | ✅ | ✅ | ❌ | 推荐 |
| `aggressive` | ✅（更紧 budget） | ✅ | ✅ | ✅ | 推荐 |

## off

完全不做事。装上但禁用，适合做 A/B 测试的对照基线。

## conservative（默认）

- ✅ 工具结果头尾裁剪（16KB + 8KB）
- ✅ grep 结果折叠（30 个匹配 + 2 行上下文）
- ❌ 不调 `ctx.compaction` —— 让 dsh 原本压力阈值行为不受影响
- ❌ 不替换官方 compaction

**任务效果风险：零**。这是无损折叠，所有折后内容仍走 dsh 标准 `tool/result` 事件流。

## balanced

- 一切 conservative 提供的，加上：
- ✅ 在 `agent/pre-step` 监听压力比例，超过 50% 时调用 `ctx.compaction.compactIfNeeded()`（让官方 compaction 提前触发）
- ❌ 仍不替换 `dsh-compaction-basic`
- LLM-summary engine 可选（用户自己提供 `callLlm` 函数）

节省率比 conservative 多 0.5-1 个百分点。在合成场景外，好处主要在多步推理链里 —— 早一步做 summary 让后续步骤的 input 不再爆。

## aggressive

- 一切 balanced 提供的，加上：
- ✅ 通过 `scope.registry.replace('compaction', ...)` 替换掉 `dsh-compaction-basic`
- ✅ LLM-summary engine 成为默认入口；用户必须提供 `callLlm` 才会启用

**任务效果风险**：取决于用户给的 `callLlm` prompt 质量。如果不设 `llmSummaryPrompt`，我们会用内置 prompt（preserve 任务目标、决策、文件清单、pending 问题）。如果用户 LLM 不可用或失败，本实现会 `catch` 并 fallback 到"什么都不做"，再把上游 `ctx.compaction` 留给 `dsh-compaction-basic` —— 实际行为是 graceful degradation。
