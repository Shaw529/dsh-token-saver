# 合成基准（Synthetic Benchmark）

无需 API key 的离线估算，覆盖 8 个常见 agent 任务场景。

## 跑

```bash
pnpm run bench:compare
```

## 场景 + 原始 tokens

| 场景 | 模拟内容 | 原始 tokens |
|---|---|---:|
| `big-read-2k-lines` | 读 2 千行生成的 TS 代码 | 58,223 |
| `huge-read-migration` | 读一份 60k 行的 SQL 迁移 | 1,562,272 |
| `grep-match-heavy` | grep 80 个匹配带上下文 | 44,924 |
| `grep-sparse` | grep 8 个稀疏匹配 | 43,574 |
| `stack-trace-1500` | 1500 帧的栈追踪 | 17,917 |
| `json-dump-800` | 800 条嵌套 JSON dump | 31,225 |
| `code-search-TODO` | 在 5k 行里搜索 TODO/FIXME/XXX | 53,064 |
| `mixed-session-12-tools` | 一个 12 步混合工具会话 | 2,016,552 |
| **合计** | | **3,827,751** |

## 结果

| 场景 | 原 | conservative | balanced | cons. 节省 | bal. 节省 |
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

## 关键观察

1. **`stack-trace-1500` 节省率最低 65.6%** —— 因为栈帧本身已经是紧凑的"一行一帧"结构，没有冗余信息可以扔掉。
2. **`mixed-session-12-tools` 节省率最高 97.2%** —— 多步工具结果叠加压缩。
3. **balanced 与 conservative 差距 0.9 个百分点** —— 差距来自 16k/8k → 8k/4k 的 budget 收紧。
4. **无损性** —— conservative / balanced 都改的是 `tool/result.content`，走 `tools/post-execute` waterfall，session log 里通过 `surfaceOp` 替换标记完整保留原 content。

## 重要说明

Token 估算遵循业内常用的 4 chars/token 规则（surrogate-pair aware）；绝对值因模型分词器而异，但 ratio 在普通拉丁/CJK 文本上稳定。真实环境评测见 [real](./real)。
