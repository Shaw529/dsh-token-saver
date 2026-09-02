# 为什么需要它

`dsh-token-saver` 解决的是 dsh 默认行为下的两个高占比 token 来源：

## 1. 一次性读出来的大文件

DSH 的 `read` 工具会原样返回文件内容。一次 read 一个 1MB 的 SQL 迁移就要消耗 **~250,000 tokens**。绝大多数 coding agent 任务里模型根本不会读完整个文件 —— 它只用头/尾定位 + 中间几行片段。

## 2. 反复搜索出来的命中结果

当用户说"找一下哪里用了 TODO"，模型会 grep 出几百行结果送回会话，token 大头其实是匹配行附近的"噪声"。这些噪声每轮都要再付一遍。

## 插件做什么

默认 conservative 档：

- **完整保留头 + 尾**（默认 16KB + 8KB，按行边界切）
- 中间用一行 metadata 替换：`[... content trimmed to save tokens: N bytes omitted; full result available via \`result.full\` ...]`
- 模型仍然知道"中间被截断了"；session log 也完整可回放

这种折叠是**无损**的：所有 model-visible 流都从 event 推导出来，session log 里被替换前的原 content 仍在。

## 数据

我们在 8 个合成场景（381 万 tokens）上测得：

| 模式 | 节省率 |
|---|---:|
| conservative（默认） | **97.6%** |
| balanced | **98.5%** |

详细数据见 [合成基准](../benchmark/synthetic)。

## 与 dsh 默认链路的兼容性

- 我们**不替换**官方 `dsh-compaction-basic`（除非显式 `aggressive`）
- 我们**不调用额外 LLM**（除非显式 `aggressive`）
- 我们所有 listener 都先 `await next()`，从不断路

其他高级用法的 spec 详见 [四种模式](./modes)。
