# 安装

## 前提

- DeepSeek Harness 已装好（`npx @deepseek-ai/dsh --version` 能跑）
- Node ≥ 22.19、pnpm ≥ 10
- 已经创建过你的 profile（如 `web` 或 `headless`）

## 从 npm

```bash
dsh plugin --profile web install dsh-token-saver
```

锁版本：

```bash
dsh plugin --profile web install dsh-token-saver@0.1.0
```

## 从本地 tarball（开发中版本）

```bash
git clone https://github.com/Shaw529/dsh-token-saver
cd dsh-token-saver
pnpm install
pnpm run build
pnpm pack  # -> dsh-token-saver-0.1.0.tgz

dsh plugin --profile web install ./dsh-token-saver-0.1.0.tgz
```

## 验证

```bash
DSH_HOME=~/.dsh-web npx @deepseek-ai/dsh --profile web --dump-config \
  | grep dsh-token-saver
```

应当看到：

```yaml
- name: 'dsh-token-saver'
  config:
    mode: conservative
    ...
```

## 卸载

```bash
dsh plugin --profile web uninstall dsh-token-saver
```
