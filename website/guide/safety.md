# 安全保证：如何不影响任务效果

`dsh-token-saver` 的所有削减都遵循 dsh 的两条硬性约束：

## 1. "Model-visible means logged."

任何送进模型的输入都必须能从 session log 重建出来。

我们的削减**全部走事件**：

- `tools/post-execute` 返回新的 `accept` 决策（dsh 自动落 `tool/result`）
- `agent/pre-step` 委托给 `ctx.compaction`（官方 `compaction/*` 事件记录了替换区间）

我们**从不在 plugin 内部直接 mutate session**，因此 `deriveMessages()` 仍然能在任何节点重新投射一致的模型可见流。

## 2. "Waterfall listeners must call `next()`."

我们的每个 listener 都先 `await next()` 拿到上游决策，再在此基础上修改 messages 或 content；从不短路 dsh 的默认链路。

## 附加安全保障

| 风险点 | 缓解措施 |
|---|---|
| 错误结果被截断丢掉诊断信息 | `decidePostTool` 在 `payload.result.isError === true` 时**直接 passthrough**，永不裁剪错误结果 |
| 极小工具结果被过度折叠 | budget = `headBytes + tailBytes + 256`，超过这个 budget 才会折叠 |
| 关键工具（如 `ask_user`、`confirm`）被裁剪 | `excludeToolNames` 黑名单建议保留交互类工具 |
| `replaceBasicCompaction` 误开 | 仅 `aggressive` 模式默认 `true`；开就是显式接管，warn log 提示 |
| LLM-summary 调用失败 | 我们 `LlmSummaryCompactionEngine.compactIfNeeded` 失败 catch 并 fallback 到官方基础实现，warn log 提示 |

## 在真实环境验证任务输出

跑 [真实环境评测](../benchmark/real) 模板，对比 baseline 和 with-plugin 两个 profile 的 task 输出。验收 checklist 写在 §8：8 个任务中至少 7 个产出**语义等价**。
