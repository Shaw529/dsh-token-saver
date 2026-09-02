---
layout: home

hero:
  name: "dsh-token-saver"
  text: "DeepSeek Harness 插件"
  tagline: "激进节省 token · 绝不破坏任务效果"
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/install
    - theme: alt
      text: GitHub
      link: https://github.com/Shaw529/dsh-token-saver
    - theme: alt
      text: 评测数据
      link: /benchmark/synthetic

features:
  - title: 节省 97.6% 的 token
    details: 8 个合成场景、381 万 tokens 累计 — 默认保守档即可获得 97.6% 输入 token 节省。balanced 档再压 0.9 个百分点。
  - title: 完全不影响任务效果
    details: 所有折叠走 dsh 标准事件流（tools/post-execute、agent/pre-step），符合 dsh 的「model-visible = logged」不变式与 waterfall listener 必须调 next() 的硬性约束。
  - title: 四种模式按需切换
    details: off / conservative（默认，无损） / balanced（在压力阈值触发 compaction） / aggressive（替换 dsh-compaction-basic 为 LLM-summary）。每一档都关闭 dsh 不会做的隐式行为直到你显式开启。
---
