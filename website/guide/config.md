# 配置参考

`cordis.yml` 里插件行的示例：

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

## 完整字段表

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
