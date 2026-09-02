# BENCHMARK.md — `dsh-token-saver` 真实环境评测模板

> 在真实 DeepSeek Harness (dsh) 环境下，对比 **装上 dsh-token-saver** 与 **不装** 的 token 消耗与任务效果。

本文档给出一套**可复现**的步骤、**预先打表**的 8 个评测任务、以及一个**对比表模板**。你只需要：

1. 准备好两个 dsh profile 目录（baseline / with-plugin）
2. 依次跑 8 个任务、收集每个 profile 的 metrics
3. 把数字填进对比表、对比节省率与任务输出

输出格式与前面的合成基准（`pnpm run bench:compare`，97.6% 节省）一致，但数据是**真实模型调用**下的口径。

---

## 1. 前言：为什么还需要这个

合成基准用的是**离线估算**（4 chars/token 静态），只验证插件"省字符数"。真实环境还要验证：

- 真实模型分词器下的 token 节省率
- 真实的多步推理链是否会因为折叠而 **丢掉关键信息** 导致任务失败
- 真实 API 计费侧能否真的少花钱

`conservative` 档声明"无损"是基于 dsh 的 `model-visible = logged` 不变式，但实际效果要在带 API key 的环境下复验。

---

## 2. 环境要求

| 项目 | 要求 |
|---|---|
| Node | ≥ 22.19 |
| pnpm | ≥ 10 |
| dsh | `npx @deepseek-ai/dsh@latest --version` 能跑（已验证公开） |
| 真实环境 | dsh 单跑成功过至少 1 个任务 |
| API | `DEEPSEEK_API_KEY=sk-...` 已设置 |

可选：

- `DEEPSEEK_BASE_URL` 自定义代理/私有部署
- `DSH_HOME` 自定义 harness home 目录

---

## 3. 两个 profile 的准备

我们要准备**两个互相隔离**的 dsh home 目录：

```bash
DSH_HOME_BASELINE=$HOME/.dsh-bench-baseline
DSH_HOME_PLUGIN=$HOME/.dsh-bench-with-plugin

mkdir -p "$DSH_HOME_BASELINE" "$DSH_HOME_PLUGIN"
```

### 3.1 baseline（不装插件）

baseline 用 dsh 默认的 `headless` profile 即可，**不挂任何插件**。

```bash
DSH_HOME="$DSH_HOME_BASELINE" npx @deepseek-ai/dsh --profile headless "echo OK"
```

### 3.2 with-plugin（装 dsh-token-saver）

publish 后用 `dsh plugin` 安装；如果还没 publish，可以用本地 `.tgz`：

```bash
# 选项 A：从 npm registry（发布后）
DSH_HOME="$DSH_HOME_PLUGIN" npx @deepseek-ai/dsh plugin --profile headless install dsh-token-saver

# 选项 B：本地 tarball
cd path/to/dsh-token-saver
pnpm run build
pnpm pack  # -> dsh-token-saver-0.1.0.tgz
DSH_HOME="$DSH_HOME_PLUGIN" npx @deepseek-ai/dsh plugin --profile headless install \
  "$(pwd)/dsh-token-saver-0.1.0.tgz"
```

验证插件已安装：

```bash
DSH_HOME="$DSH_HOME_PLUGIN" npx @deepseek-ai/dsh --profile headless --dump-config \
  | grep -A2 dsh-token-saver
```

应当看到一行 `- name: 'dsh-token-saver'` 和 `config: { ... }`。

默认配置即可；要测 `balanced` / `aggressive` 时在对应 profile 的 `cordis.patch.yml` 改 `mode` 字段。

---

## 4. 任务集

8 个任务覆盖我们合成基准的同类场景，外加**带状态评估**的语义任务。每个任务都应该在两个 profile 下产生**同样的最终输出**（conservative 档声称无损失）。

| # | 场景 | 任务 | 评估 |
|---|---|---|---|
| 1 | 工具结果主导 | "请阅读当前仓库的 `package.json`，告诉我它声明的 `scripts` 字段" | 与 ground truth 行数匹配 |
| 2 | grep-heavy | "在当前目录里 grep `TODO\|FIXME`，把每个匹配列出来" | 命中条数与基线对比 |
| 3 | 长 read | "读 `/repo/some-huge.txt` 并告诉我行数" | 数字与基线对比 |
| 4 | 多种混合 | "把上面 1/2/3 三个任务合并起来顺序跑" | 最终输出覆盖前三个 |
| 5 | 栈跟踪 | "运行 `node ./scripts/start.js` 失败时把 stack trace 总结给我" | 错误类型/堆栈深度匹配 |
| 6 | JSON dump | "在仓库里找一份 JSON 文件，告诉我 keys" | keys 列表匹配 |
| 7 | 多步对话 | "先读 README，再问我一个问题（'该项目用 dsh 吗？'），根据 README 回答" | 最终答案匹配 |
| 8 | 持久会话 | "在上面 7 之后追问 'plugin 名字是什么？'，再追问 '它的默认模式是什么？'" | 第二、三轮答案匹配 |

> 任务的"评估"列描述**如何判断输出是否仍正确**——这是校验插件没破坏任务的关键。

---

## 5. 操作步骤

### 5.1 baseline 跑全任务（先跑这一轮）

```bash
for T in 1 2 3 4 5 6 7 8; do
  TASK="$(printf 'Task%d:' "$T")"
  PROMPT="$(jq -r ".[$T-1].prompt" benchmark/tasks.json)"
  EXPECTED="$(jq -r ".[$T-1].evaluate" benchmark/tasks.json)"

  DSH_HOME="$DSH_HOME_BASELINE" \
  DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" \
  npx @deepseek-ai/dsh --profile headless "$PROMPT" \
    > "baseline-task${T}.txt" 2> "baseline-task${T}.log"

  echo "[$T baseline] wrote baseline-task${T}.{txt,log}"
done
```

> **注意**：要把任务 prompt 放到 `benchmark/tasks.json` 里（见下文 §6）。

### 5.2 with-plugin 跑同一组任务

```bash
for T in 1 2 3 4 5 6 7 8; do
  PROMPT="$(jq -r ".[$T-1].prompt" benchmark/tasks.json)"

  DSH_HOME="$DSH_HOME_PLUGIN" \
  DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" \
  npx @deepseek-ai/dsh --profile headless "$PROMPT" \
    > "plugin-task${T}.txt" 2> "plugin-task${T}.log"

  echo "[$T plugin] wrote plugin-task${T}.{txt,log}"
done
```

### 5.3 收集 metric 数字

dsh 把 session metrics 写到 `${DSH_HOME}/profiles/<profile>/sessions/<id>.json`，包含：

- `tokens.input`（累计输入 tokens）
- `tokens.output`（累计输出 tokens）
- `tokens.total`
- `toolCalls` 列表
- `durationMs`

辅助脚本 `benchmark/parse-results.ts` 会：

```bash
pnpm exec tsx benchmark/parse-results.ts \
  --baseline "$DSH_HOME_BASELINE/profiles/headless/sessions" \
  --plugin "$DSH_HOME_PLUGIN/profiles/headless/sessions" \
  --output bench-results.md
```

输出 `bench-results.md`，对应 §7 的对比表模板填好数字。

---

## 6. 任务清单文件 `benchmark/tasks.json`

把下面这 8 条 prompt 写进 `benchmark/tasks.json`：

```json
[
  {
    "id": "task1-read-package-json",
    "prompt": "Please read the current repository's package.json and list every entry under the `scripts` field, one per line.",
    "evaluate": "ground truth = the literal `scripts` keys in package.json"
  },
  {
    "id": "task2-grep-todos",
    "prompt": "Run grep across the repository for `TODO|FIXME|XXX` and list each match with its file and line number.",
    "evaluate": "match count should be the same; lines should overlap with baseline"
  },
  {
    "id": "task3-huge-read-linecount",
    "prompt": "Read the file mentioned in the conversation context and tell me its exact line count.",
    "evaluate": "answer matches `wc -l` output"
  },
  {
    "id": "task4-mixed",
    "prompt": "Do tasks 1, 2, and 3 in sequence and report each answer.",
    "evaluate": "composite answer covers all three"
  },
  {
    "id": "task5-stack-trace",
    "prompt": "Run `node ./scripts/start.js`, capture the failure, and produce a concise error summary that includes the error type and the depth of the trace.",
    "evaluate": "error type and depth match baseline"
  },
  {
    "id": "task6-json-keys",
    "prompt": "Find any JSON file in the repo and list its top-level keys.",
    "evaluate": "keys match baseline keys"
  },
  {
    "id": "task7-readme-then-qa",
    "prompt": "Read README.md, then answer: does this project target DeepSeek Harness? Just yes/no plus one sentence.",
    "evaluate": "yes/no and the supporting sentence overlap baseline"
  },
  {
    "id": "task8-multi-turn",
    "prompt": "Continue from the previous session. Q1: what is the plugin's name? Q2: what is its default mode?",
    "evaluate": "Q1=`dsh-token-saver`, Q2=`conservative`"
  }
]
```

> 任务 1 的 ground truth 是当前 `dsh-token-saver/package.json` 的 scripts：
> - `bench`、`bench:compare`、`smoke`、`build`、`typecheck`、`test`、`test:watch`、`lint`、`hygiene`
> 拿这个 task 1 做端到端冒烟非常方便。

---

## 7. 对比表模板

`benchmark/parse-results.ts` 输出形如：

```
+-------+----------------+----------------+-----------+------------------+----------+
| Task  | baseline.input | plugin.input   | saved%    | output_match     | dur_diff |
+-------+----------------+----------------+-----------+------------------+----------+
| t1    | 2,341          | 2,341          | 0.0%      | byte-equal       | +12ms    |
| t2    | 8,192          | 2,034          | 75.2%     | byte-equal       | -8ms     |
| t3    | 153,440        | 8,732          | 94.3%     | byte-equal       | -2ms     |
| t4    | 167,001        | 11,902         | 92.9%     | sem-equal        | -15ms    |
| t5    | 24,500         | 9,830          | 59.9%     | byte-equal       | +5ms     |
| t6    | 6,022          | 2,041          | 66.1%     | byte-equal       | 0ms      |
| t7    | 12,400         | 4,210          | 66.0%     | byte-equal       | -3ms     |
| t8    | 18,910         | 6,811          | 64.0%     | byte-equal       | +10ms    |
+-------+----------------+----------------+-----------+------------------+----------+
| SUM   | 392,806        | 47,900         | 87.8%     | 8/8 sem-equal    | -3ms     |
+-------+----------------+----------------+-----------+------------------+----------+
```

> **预期 pattern**：在 80%+ 的大工具结果场景（t3、t4）才能看到 ≥90% 节省；纯 multi-turn 对话（t7、t8）节省率会降到 60-70%。这是因为这类任务的输入大头是**模型与用户对话本身**，没有可供折叠的稠密工具结果。如果你发现短任务里 baseline 与 with-plugin 几乎相同，那也是合理的。

---

## 8. 验收标准

| 检查项 | 通过条件 |
|---|---|
| 安装正确 | `dsh --profile headless --dump-config \| grep dsh-token-saver` 看到插件行 |
| 任务输出 | 8 个任务中至少 7 个产出**语义等价**（人工或 grep 比对） |
| Token 节省 | 至少在 t2/t3/t4 三个任务里 ≥ 50% 输入 tokens 节省 |
| 无错误增长 | 任意任务的 `output.match === false` 必须有可解释原因（否则插件改了 prompt 顺序） |

任何一个不通过，回滚插件：

```bash
DSH_HOME="$DSH_HOME_PLUGIN" npx @deepseek-ai/dsh plugin --profile headless uninstall dsh-token-saver
```

或对比更高 baseline：

```bash
for T in 1 2 3 4 5 6 7 8; do
  echo "task $T:"
  diff "baseline-task${T}.txt" "plugin-task${T}.txt" || echo "(diff above)"
done
```

---

## 9. 跑不同档位的对比

把 `with-plugin` 的 profile 的 `cordis.patch.yml` 改成：

```yaml
- name: 'dsh-token-saver'
  config:
    mode: balanced   # 试试 conservative / balanced / aggressive 三档
```

然后**整个 §5 流程再跑一遍**，得到三档 × 8 任务的 24 行对比表。`balanced` 与 `aggressive` 在 t3、t4 应该比 conservative 进一步节省 5-10 个百分点；如果反而升高，说明 aggressive 模式把我们替换的 `dsh-compaction-basic` 调用打成了 LLM 调用但实际没产生更紧凑的摘要 —— 这种情况下回到 `conservative`。

---

## 10. 报告产出

最终建议把对比表与验证结论写进 `docs/bench-results.md`（仓库另一个 markdown），长期存档。如果你想给 `dsh-token-saver` 提 PR 到官方 monorepo，可以在 PR description 里贴这份报告，节省效果会成为合并的核心证据。
