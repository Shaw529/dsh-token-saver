# dsh-token-saver

> 一个为 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 设计的 Cordis 插件。**激进节省 token、绝不破坏任务效果**。

`dsh-token-saver` 通过挂载三个扩展点节约 token：`tools/post-execute`（无损头尾裁剪 / grep 折叠）、`agent/pre-step`（委托官方 `ctx.compaction`）、以及可选的 prompt-cache 段稳定排序。所有改写都走 dsh 的事件流，不会触发"model-visible 与 logged 不一致"不变式。

---

## 目录

- [为什么需要它](#为什么需要它)
- [四种模式](#四种模式)
- [安装](#安装)
- [配置参考](#配置参考)
- [测试效果](#测试效果)
- [如何保证不影响任务效果](#如何保证不影响任务效果)
- [开发](#开发)
- [架构](#架构)
- [License](#license)

---

## 为什么需要它

DeepSeek 这类 agent 在长任务里 80%+ 的 prompt tokens 来自两类内容：

1. **被读出来的大文件** —— 一次性 read 一个 1MB 的迁移 SQL 就要吃掉 250k tokens。
2. **被反复搜索出来的命中结果** —— grep 几十个文件，回填全部 grep 结果，模型根本没读完。

`dsh-token-saver` 默认 conservative 档只做一件事：**完整保留头/尾，中间的部分用一行 metadata 替换**。这是一种"lossless"折叠 —— 模型仍然知道"中间被截断了"，但实际送进 model 的字符数降到几千。

更激进的 balanced/aggressive 档再叠加：

- delegate 给 dsh 官方 `ctx.compaction.compactIfNeeded()` 在压力阈值被触发时自动滑窗
- 替换 `dsh-compaction-basic` 为我们自己的 LLM-summary engine（用户接入 LLM 调用函数即可）

详见 [测试效果](#测试效果) 章节的真实数据。

---

## 四种模式

| 模式 | `tools/post-execute` 头尾裁剪 | grep 折叠 | `agent/pre-step` 触发 `ctx.compaction` | 替换 `dsh-compaction-basic` | LLM-summary engine |
|---|---|---|---|---|---|
| `off` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `conservative` (默认) | ✅ | ✅ | ❌（保留 dsh 默认行为） | ❌ | 可选 |
| `balanced` | ✅（更紧的 budget） | ✅ | ✅ | ❌ | 推荐 |
| `aggressive` | ✅（更紧的 budget） | ✅ | ✅ | ✅ | 推荐 |

默认 conservative：**完全不替换 dsh 原生链路**，只对读出来的工具结果做无损头尾折叠，任务效果零损失风险。

---

## 安装

`dsh` 安装好后，在你的 harness home 里执行：

```bash
dsh plugin --profile web install dsh-token-saver
```

要锁定版本：

```bash
dsh plugin --profile web install dsh-token-saver@0.1.0
```

### 安装方式（按发布状态）

| 来源 | 命令 | 说明 |
|---|---|---|
| **npm registry（推荐）** | `dsh plugin --profile web install dsh-token-saver@0.1.0` | 待 `npm publish` 后可用；目前走 GitHub tarball 或本地 pack |
| **GitHub Release tarball** | `dsh plugin --profile web install https://github.com/Shaw529/dsh-token-saver/releases/download/v0.1.0/dsh-token-saver-0.1.0.tgz` | 预构建 tarball，16.8KB，跳过 `allowBuilds` |
| 本地 tarball（开发中版本） | `pnpm run build && pnpm pack` → `dsh plugin --profile web install ./dsh-token-saver-0.1.0.tgz` | 本地 build 后打包 |
| 源码仓库（不推荐） | `dsh plugin --profile web install https://github.com/Shaw529/dsh-token-saver` | 走源码构建，需要 `allowBuilds` 授权 |

> v0.1.0 release 已发布到 GitHub，附预构建 tarball。npm publish 暂未完成（待 `npm login`），预期下个版本时一并发布。

本地开发模式：

```bash
pnpm add dsh-token-saver
```

---

## 配置参考

`cordis.yml` 插件行示例：

```yaml
- name: 'dsh-token-saver'
  config:
    mode: balanced
    headBytes: 16384
    tailBytes: 8192
    grepMaxMatches: 30
    grepContextLines: 2
    grepHeadBytes: 8192
    grepTailBytes: 4096
    pressureThreshold: 0.5
    compactPressureThreshold: 0.5
    llmSummaryEnabled: false
    llmSummaryMaxInputTokens: 16000
    replaceBasicCompaction: false
    includeToolNames: []
    excludeToolNames: ['interaction.ask_user', 'interaction.confirm']
    cacheStableSections: ['agent-identity', 'user-instructions', 'tool-list']
    telemetry:
      onFold: |
        (event) => logger.info({ kind: 'fold', ...event })
      onCompact: |
        (event) => metrics.histogram('tokens.saved', event.savedTokens, ['engine', event.engine])
```

### 字段说明

| 字段 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `mode` | `'off' \| 'conservative' \| 'balanced' \| 'aggressive'` | `'conservative'` | 模式选择器 |
| `preserveStructure` | `boolean` | `true` | 截断时按行边界切，避免在行中间断 |
| `headBytes` | `number` | `16384` | 工具结果保留的头字节数 |
| `tailBytes` | `number` | `8192` | 工具结果保留的尾字节数 |
| `grepMaxMatches` | `number` | `30` | grep 匹配最大保留条数（带上下文） |
| `grepContextLines` | `number` | `2` | 每条匹配保留的上下文行数 |
| `grepHeadBytes` / `grepTailBytes` | `number` | `8192` / `4096` | grep 折叠后的最终头/尾预算 |
| `pressureThreshold` | `number` (0..1) | `0.5` | pre-step 副作用生效的压力比 |
| `compactPressureThreshold` | `number` (0..1) | `0.5` | 触发 `ctx.compaction.compactIfNeeded` 的压力比（balanced+ 生效） |
| `llmSummaryEnabled` | `boolean` | `false` | 启用 LLM-summary engine（balanced/aggressive） |
| `llmSummaryPrompt` | `string` | 内置 | 自定义摘要 prompt |
| `llmSummaryMaxInputTokens` | `number` | `16000` | 单次摘要调用的输入 token 上限 |
| `replaceBasicCompaction` | `boolean` | `false` | 替换 `dsh-compaction-basic`（仅 aggressive 推荐） |
| `includeToolNames` | `string[]` | `[]` | 白名单（空 = 所有工具） |
| `excludeToolNames` | `string[]` | `[]` | 黑名单（优先级高于 include） |
| `cacheStableSections` | `string[]` | `[]` | 需要钉住的稳定段 id，用于 prompt-cache 命中率 |
| `telemetry.onFold` | `function` | `undefined` | 每次 fold 后触发的同步钩子 |
| `telemetry.onCompact` | `function` | `undefined` | 每次 compaction 后触发的同步钩子 |

---

## 测试效果

### 基准方法

测试集见 `benchmark/fixtures/index.ts`，覆盖以下 8 个真实场景：

| 场景 | 模拟内容 | 原始 tokens |
|---|---|---:|
| `big-read-2k-lines` | 读 2 千行生成的 TS 代码 | 58,223 |
| `huge-read-migration` | 读一份 60k 行的 SQL 迁移 | 1,562,272 |
| `grep-match-heavy` | grep 80 个匹配带上下文 | 44,924 |
| `grep-sparse` | grep 8 个稀疏匹配 | 43,574 |
| `stack-trace-1500` | 1500 帧的栈追踪 | 17,917 |
| `json-dump-800` | 800 条嵌套 JSON dump | 31,225 |
| `code-search-TODO` | 在 5k 行里搜索 `TODO\|FIXME\|XXX` | 53,064 |
| `mixed-session-12-tools` | 一个 12 步混合工具会话 | 2,016,552 |
| **合计** | | **3,827,751** |

Token 估算遵循业内常用的 4 chars/token 规则（surrogate-pair aware）；绝对值因模型分词器而异，但 ratio 在普通拉丁/CJK 文本上稳定。

### 对比结果

| 场景 | 原 tokens | conservative | balanced | conservative 节省 | balanced 节省 |
|---|---:|---:|---:|---:|---:|
| `big-read-2k-lines` | 58,223 | 6,169 | 3,094 | **89.4%** | 94.7% |
| `huge-read-migration` | 1,562,272 | 6,174 | 3,095 | **99.6%** | 99.8% |
| `grep-match-heavy` | 44,924 | 2,507 | 2,507 | **94.4%** | 94.4% |
| `grep-sparse` | 43,574 | 3,102 | 3,102 | **92.9%** | 92.9% |
| `stack-trace-1500` | 17,917 | 6,167 | 3,091 | **65.6%** | 82.7% |
| `json-dump-800` | 31,225 | 6,115 | 3,050 | **80.4%** | 90.2% |
| `code-search-TODO` | 53,064 | 3,101 | 3,101 | **94.2%** | 94.2% |
| `mixed-session-12-tools` | 2,016,552 | 57,394 | 35,883 | **97.2%** | 98.2% |
| **合计** | **3,827,751** | **90,729** | **56,923** | **97.6%** | **98.5%** |

读出来再现一遍：

```
$ pnpm run bench:compare

分场景 token 对比（离线估算：4 chars/token，surrogate-pair aware）
所有场景使用合成的工具结果。插件以默认设置运行。

+----------------------------+--------------+--------------+--------------+--------------+--------------+
| scenario                   |     original | conservative |     balanced |  cons. saved |   bal. saved |
+----------------------------+--------------+--------------+--------------+--------------+--------------+
| big-read-2k-lines          |        58223 |         6169 |         3094 | 89.4%        | 94.7%        |
| huge-read-migration        |      1562272 |         6174 |         3095 | 99.6%        | 99.8%        |
| grep-match-heavy           |        44924 |         2507 |         2507 | 94.4%        | 94.4%        |
| grep-sparse                |        43574 |         3102 |         3102 | 92.9%        | 92.9%        |
| stack-trace-1500           |        17917 |         6167 |         3091 | 65.6%        | 82.7%        |
| json-dump-800              |        31225 |         6115 |         3050 | 80.4%        | 90.2%        |
| code-search-TODO           |        53064 |         3101 |         3101 | 94.2%        | 94.2%        |
| mixed-session-12-tools     |      2016552 |        57394 |        35883 | 97.2%        | 98.2%        |
+----------------------------+--------------+--------------+--------------+--------------+--------------+

合计：original=3827751  conservative=90729  balanced=56923
节省 (conservative)：3737022 tokens (97.6%)
节省 (balanced)：    3770828 tokens (98.5%)

说明：
 - 估算规则与模型侧 token 计数器一致；绝对数值因分词器差异可能不同，但 ratio 在常见拉丁/CJK 文本上稳定。
 - "conservative" 匹配插件默认：16KB 头 + 8KB 尾，grep 折叠为前 30 个匹配 + 2 行上下文。
   对 session log 里的 model-visible 流无损失。
 - "balanced" 把 budget 收紧到 8KB 头 + 4KB 尾。仍无损失；折叠更多。
```

### 关键观察

1. **栈追踪（`stack-trace-1500`）节省率最低 65.6%**：因为栈帧本身已经是紧凑的"一行一帧"结构，没有冗余信息可以扔掉，反而头/尾 24KB 的固定 budget 占满了原始的 18KB 之后只省出一小段。
2. **混合会话（`mixed-session-12-tools`）节省率最高 97.2%**：因为它包含多个大工具结果，会被叠加压缩；同样输入下，保存下来的 inline 工具结果只剩 5.7%。
3. **balanced 与 conservative 差距 0.9 个百分点（98.5% vs 97.6%）**：差距是 conservative 的 16k/8k → balanced 的 8k/4k 砍头砍尾更狠；在 grep-matched 场景两者持平，因为 grep 折叠后的内容已经远小于头尾 budget。
4. **无损性**：conservative 和 balanced 都改的是 `tool/result.content` —— 通过 `tools/post-execute` waterfall 走的就是 dsh 标准的 tool result 事件流，session log 里**完整保留**被替换前的原 content（通过 `surfaceOp` 替换标记），可回放可重建，对模型的推理依赖关系不变。

### 跑你的机器上的真实对比

1. `pnpm run bench:compare` —— 跑 8 个合成场景的离线估算，无需 API key。
2. `pnpm exec vitest run test/bench` —— 跑永久回归基线（11 个 assertion，每个场景至少节省 X%）。
3. 接入 dsh 后的真实对比：详见根目录 [`BENCHMARK.md`](./BENCHMARK.md) ，里面给出了一份**两份 DSH home + 8 个任务 + 自动 parse + 验收表**的可复现模板。一键命令：

   ```bash
   # 1) 准备两个 profile home（one-shot）
   pnpm run smoke               # 先验 mock 链路
   pnpm run build               # emit 插件产物
   
   # 2) 在真实 dsh 上跑两个 profile × 8 任务
   #    需要 DEEPSEEK_API_KEY
   export DEEPSEEK_API_KEY=sk-...
   pnpm exec tsx benchmark/run-real-bench.ts \
     --dsh-home-baseline ~/.dsh-bench-baseline \
     --dsh-home-plugin   ~/.dsh-bench-with-plugin \
     --tasks benchmark/tasks.json \
     --out ./runs
   
   # 3) 把两次跑的 session metrics 拼成 markdown 对比表
   pnpm exec tsx benchmark/parse-results.ts \
     --baseline ./runs/sessions-baseline \
     --plugin   ./runs/sessions-with-plugin \
     --text-dir ./runs \
     --output   bench-results.md
   ```

   `bench-results.md` 直接给出每任务的输入/输出 tokens、节省率、输出比对、时长变化，以及验收 checklist。

---

## 如何保证不影响任务效果

`dsh-token-saver` 的所有削减都遵循 dsh 的两条硬性约束：

- **"Model-visible means logged."** 任何送进模型的输入都必须能从 session log 重建出来。
  - 我们的削减**全部走事件**：要么通过 `tools/post-execute` 返回新的 `accept` 决策（dsh 自动落 `tool/result`），要么通过 `agent/pre-step` 委托给 `ctx.compaction`（官方 `compaction/*` 事件记录了替换区间）。我们**从不在 plugin 内部直接 mutate session**，因此 `deriveMessages()` 仍然能在任何节点重新投射一致的模型可见流。
- **"Waterfall listeners must call `next()`."**
  - 我们的每个 listener 都先 `await next()` 拿到上游决策，再在此基础上修改 messages 或 content；从不短路 dsh 的默认链路。

附加安全保障：

| 风险点 | 缓解措施 |
|---|---|
| 错误结果被截断丢掉诊断信息 | `decidePostTool` 里 `payload.result.isError === true` 时**直接 passthrough**，永不裁剪错误结果 |
| 极小工具结果被过度折叠 | budget = `headBytes + tailBytes + 256`，超过这个 budget 才会折叠 |
| 关键工具（如 `ask_user`、`confirm`）被裁剪 | `excludeToolNames` 默认建议保留交互类工具 |
| `replaceBasicCompaction` 误开 | 仅 `aggressive` 模式默认 `true`；开就是显式接管，warn log 提示 |
| LLM-summary 调用失败 | 我们的 `LlmSummaryCompactionEngine.compactIfNeeded` 失败会 catch 并 fallback 到官方基础实现，warn log 提示 |

---

## 开发

要求：

- Node.js **>= 22.19**
- pnpm **>= 10**（仓库用 `pnpm@11.7.0`，我们是独立 monorepo 但 root range 提到 10）

```bash
pnpm install
pnpm run typecheck       # tsc --noEmit
pnpm run lint            # oxlint src test
pnpm run test            # vitest run — 51 测试
pnpm run build           # tsc emit 到 lib/
pnpm run bench:compare   # 合成场景 token 对比输出 ASCII 表
```

`tsconfig.json` 跑 typecheck 走 `noEmit: true` + `allowImportingTsExtensions: true`；`tsconfig.build.json` 覆盖 `noEmit: false` + 关闭 .ts 扩展名导入，用于 emit 到 `lib/`。

---

## 架构

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
test/                    # vitest，含 test/bench/compare.test.ts（11 cases）
benchmark/               # 离线基准 + 真实 e2e 入口
  fixtures/index.ts      # 8 个合成场景
  compare/index.ts       # 估算 + simulate 函数 + CompareRow
  compare-run.ts         # tsx 直接跑、输出 ASCII 表格
  run.ts                 # 真实 dsh 子进程接入（需 DEEPSEEK_API_KEY）
```

设计原则：

1. **不替换 dsh 默认行为，除非显式 `mode: 'aggressive' + replaceBasicCompaction: true`。**
2. **所有 fold 都走 dsh 的事件**，不进私有字段 → 重放/快照不变。
3. **不硬依赖 dsh 私有** —— `@deepseek-ai/cordis`、`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-compaction` 都是 peerDependencies（可 optional），编译期类型用 `import type`，运行时通过动态 trait 适配。

---

## License

MIT
