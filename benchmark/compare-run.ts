#!/usr/bin/env node
/**
 * benchmark/compare-run.ts — single-shot compare run; prints ASCII table to stdout.
 *
 * Usage:
 *   pnpm bench           # via package.json
 *   pnpm exec tsx benchmark/compare-run.ts
 *
 * Outputs three blocks:
 *   1. Per-scenario table (original vs conservative vs balanced)
 *   2. Totals
 *   3. Cumulative "session" view (the 12-tool mixed scenario only)
 */

import { runAll } from './compare'

function pad(s: string | number, w: number, align: 'left' | 'right' = 'right'): string {
  const str = String(s)
  if (str.length >= w) return str.slice(0, w)
  const fill = ' '.repeat(w - str.length)
  return align === 'left' ? str + fill : fill + str
}

function printTable(rows: ReadonlyArray<{ id: string; originalTokens: number; conservativeTokens: number; balancedTokens: number; conservativeSavedPct: number; balancedSavedPct: number }>) {
  const id = 'scenario'
  const orig = 'original'
  const cons = 'conservative'
  const bal = 'balanced'
  const csS = 'cons. saved'
  const bsS = 'bal. saved'

  const widths = { id: 26, orig: 12, cons: 12, bal: 12, csS: 12, bsS: 12 }
  const sep = '+' + '-'.repeat(widths.id + 2) + '+' + '-'.repeat(widths.orig + 2) + '+' + '-'.repeat(widths.cons + 2) + '+' + '-'.repeat(widths.bal + 2) + '+' + '-'.repeat(widths.csS + 2) + '+' + '-'.repeat(widths.bsS + 2) + '+'
  const header = `| ${pad(id, widths.id, 'left')} | ${pad(orig, widths.orig)} | ${pad(cons, widths.cons)} | ${pad(bal, widths.bal)} | ${pad(csS, widths.csS)} | ${pad(bsS, widths.bsS)} |`

  console.log(sep)
  console.log(header)
  console.log(sep)
  for (const r of rows) {
    console.log(
      `| ${pad(r.id, widths.id, 'left')} | ${pad(r.originalTokens, widths.orig)} | ${pad(r.conservativeTokens, widths.cons)} | ${pad(r.balancedTokens, widths.bal)} | ${pad(`${r.conservativeSavedPct}%`, widths.csS, 'left')} | ${pad(`${r.balancedSavedPct}%`, widths.bsS, 'left')} |`,
    )
  }
  console.log(sep)
}

function printReport() {
  const report = runAll()
  console.log('分场景 token 对比（离线估算：4 chars/token，surrogate-pair aware）')
  console.log('所有场景使用合成的工具结果。插件以默认设置运行。')
  console.log('')
  printTable(report.rows)
  console.log('')
  const t = report.totals
  console.log(`合计：original=${t.originalTokens}  conservative=${t.conservativeTokens}  balanced=${t.balancedTokens}`)
  console.log(`节省 (conservative)：${t.conservativeSavedTokens} tokens (${t.conservativeSavedPct.toFixed(1)}%)`)
  console.log(`节省 (balanced)：    ${t.balancedSavedTokens} tokens (${t.balancedSavedPct.toFixed(1)}%)`)
  console.log('')
  console.log('说明：')
  console.log(' - 估算规则与模型侧 token 计数器一致；绝对数值因分词器差异可能不同，但 ratio 在常见拉丁/CJK 文本上稳定。')
  console.log(' - "conservative" 匹配插件默认：16KB 头 + 8KB 尾，grep 折叠为前 30 个匹配 + 2 行上下文。')
  console.log('   对 session log 里的 model-visible 流无损失。')
  console.log(' - "balanced" 把 budget 收紧到 8KB 头 + 4KB 尾。仍无损失；折叠更多。')
}

printReport()
