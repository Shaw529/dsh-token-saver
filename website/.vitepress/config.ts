import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'dsh-token-saver',
  description: 'DeepSeek Harness plugin: aggressive token savings, no task-quality loss',
  lang: 'zh-CN',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['meta', { name: 'theme-color', content: '#0b3d91' }],
    ['meta', { property: 'og:title', content: 'dsh-token-saver' }],
    ['meta', { property: 'og:description', content: 'DeepSeek Harness plugin: aggressive token savings, no task-quality loss' }],
  ],
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '文档', link: '/guide/' },
      { text: '评测', link: '/benchmark/' },
      { text: 'GitHub', link: 'https://github.com/Shaw529/dsh-token-saver' },
    ],
    sidebar: {
      '/guide/': [
        { text: '为什么需要它', items: [{ text: '价值主张', link: '/guide/why' }] },
        { text: '四种模式', link: '/guide/modes' },
        { text: '安装', link: '/guide/install' },
        { text: '配置参考', items: [{ text: '完整字段表', link: '/guide/config' }] },
        { text: '保证不影响任务效果', link: '/guide/safety' },
        { text: '开发', link: '/guide/development' },
        { text: '架构', link: '/guide/architecture' },
      ],
      '/benchmark/': [
        { text: '合成基准', link: '/benchmark/synthetic' },
        { text: '真实环境评测', link: '/benchmark/real' },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/Shaw529/dsh-token-saver' },
    ],
  },
})
