# 真实环境评测

详见仓库根目录 [BENCHMARK.md（中文）](https://github.com/Shaw529/dsh-token-saver/blob/master/BENCHMARK.md)。

## 流程

1. 准备两个互不相干的 dsh home：`~/.dsh-bench-baseline`、`~/.dsh-bench-with-plugin`
2. 在 `with-plugin` 的 home 里 `dsh plugin install dsh-token-saver`
3. 用 `benchmark/tasks.json` 里的 8 个 prompt，依次跑两个 profile 各一次
4. 从 `${DSH_HOME}/profiles/headless/sessions/` 抓 session JSON metrics
5. 跑 `parse-results.ts` 生成 `bench-results.md`

## 一键命令

```bash
export DEEPSEEK_API_KEY=sk-...

# 1) 跑两轮（需要 dsh 子进程能启动）
pnpm exec tsx benchmark/run-real-bench.ts \
  --dsh-home-baseline ~/.dsh-bench-baseline \
  --dsh-home-plugin   ~/.dsh-bench-with-plugin \
  --tasks benchmark/tasks.json \
  --out ./runs

# 2) 出对比报告
pnpm exec tsx benchmark/parse-results.ts \
  --baseline ./runs/sessions-baseline \
  --plugin   ./runs/sessions-with-plugin \
  --text-dir ./runs \
  --output   bench-results.md
```

## 8 个任务

| # | 任务 | 评估方法 |
|---|---|---|
| 1 | "读 package.json 的 scripts 字段" | 与 ground truth key 列表匹配 |
| 2 | "grep `TODO|FIXME|XXX` 并列出来" | 命中条数与 baseline 重叠 |
| 3 | "读某文件并报告行数" | 数字与 `wc -l` 对照 |
| 4 | "依次完成 1/2/3" | 综合答案 |
| 5 | "运行 node ./scripts/start.js 并总结 stack" | error 类型 / 深度与 baseline 匹配 |
| 6 | "找 JSON 列出 top-level keys" | keys 与 baseline 匹配 |
| 7 | "读 README 回答：是否针对 dsh" | yes/no + 解释重叠 baseline |
| 8 | "续问：插件名？默认模式？" | answer == `dsh-token-saver`、`conservative` |

## 验收 checklist

- [ ] 安装正确（`dsh --dump-config | grep dsh-token-saver` 看到）
- [ ] 8 个任务至少 7 个产出语义等价
- [ ] t2/t3/t4 至少 50% 输入 tokens 节省
- [ ] 任意 `output.differs` 必须有可解释原因（否则插件悄悄改了 prompt 顺序）
