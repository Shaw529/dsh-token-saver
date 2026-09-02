# 入门指南

`dsh-token-saver` 通过挂载 dsh 的三个扩展点（`tools/post-execute`、`agent/pre-step`、`ctx.compaction` Service Definition）节省 token。默认 conservative 档**无损**，balanced / aggressive 档按需开启。

## 5 分钟上手

```bash
# 装在 dsh profile 里
dsh plugin --profile web install dsh-token-saver

# 验证
DSH_HOME=~/.dsh-web npx @deepseek-ai/dsh --profile web --dump-config \
  | grep dsh-token-saver
```

应当看到一行 `- name: 'dsh-token-saver'` 和 `config: { ... }`。

更多细节见：

- [为什么需要它](./why) — 真实场景里 80%+ prompt tokens 来自哪里
- [四种模式](./modes) — off / conservative / balanced / aggressive 对比表
- [安装](./install) — npm / 本地 tarball / 开发模式
- [配置字段](./config) — 18 个字段的类型、默认、含义
- [安全保证](./safety) — 如何避免影响任务效果
- [开发](./development) — 环境要求 + 命令清单
- [架构](./architecture) — 文件树 + 设计原则

## 评测

- [合成基准](./../benchmark/synthetic) — 不需要 API key 的 8 场景离线估算
- [真实环境评测](./../benchmark/real) — 跑 dsh 子进程对比的两个 DSH home + 8 任务 + 自动 parse
