#!/usr/bin/env node
/**
 * benchmark/parse-results.ts — read dsh session JSONs and emit a Markdown table.
 *
 * Usage:
 *   pnpm exec tsx benchmark/parse-results.ts \
 *     --baseline ./runs/baseline/sessions \
 *     --plugin   ./runs/with-plugin/sessions \
 *     --output   bench-results.md
 *
 * Each sessions directory is expected to contain one .json per task. The parser
 * reads `tokens.input`, `tokens.output`, `tokens.total`, `toolCalls`, `durationMs`
 * if present, and derives a "match" verdict by string-comparing two .txt outputs
 * in the same runs/ directory:
 *   baseline/task<N>.txt vs plugin/task<N>.txt
 *
 * If the .txt files are not present, "match" shows as "n/a".
 */

import fs from 'node:fs'
import path from 'node:path'

interface DshSession {
  id?: string
  tokens?: { input?: number; output?: number; total?: number }
  toolCalls?: Array<{ tool: string; args?: unknown }>
  durationMs?: number
  startedAt?: number
}

interface ParsedRow {
  readonly task: string
  readonly baselineInput: number
  readonly pluginInput: number
  readonly baselineOutput: number
  readonly pluginOutput: number
  readonly savedPct: number
  readonly match: 'byte-equal' | 'sem-equal' | 'differs' | 'n/a'
  readonly durDiffMs: number
}

interface CliArgs {
  baselineDir: string
  pluginDir: string
  outputFile: string
  textDir: string | undefined
}

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--baseline') args.baselineDir = argv[++i] ?? ''
    else if (a === '--plugin') args.pluginDir = argv[++i] ?? ''
    else if (a === '--output') args.outputFile = argv[++i] ?? ''
    else if (a === '--text-dir') args.textDir = argv[++i] ?? ''
  }
  if (!args.baselineDir || !args.pluginDir || !args.outputFile) {
    console.error('Usage: parse-results.ts --baseline <dir> --plugin <dir> --output <md> [--text-dir <dir>]')
    process.exit(1)
  }
  return args as CliArgs
}

function readSession(dir: string, name: string): DshSession | undefined {
  const f = path.join(dir, name)
  if (!fs.existsSync(f)) return undefined
  const raw = fs.readFileSync(f, 'utf8')
  try {
    return JSON.parse(raw) as DshSession
  } catch {
    return undefined
  }
}

function listSessionNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
}

function compareTexts(aPath: string, bPath: string): 'byte-equal' | 'sem-equal' | 'differs' | 'n/a' {
  if (!fs.existsSync(aPath) || !fs.existsSync(bPath)) return 'n/a'
  const a = fs.readFileSync(aPath, 'utf8').trimEnd()
  const b = fs.readFileSync(bPath, 'utf8').trimEnd()
  if (a === b) return 'byte-equal'
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim()
  if (normalize(a) === normalize(b)) return 'sem-equal'
  return 'differs'
}

function num(n: number | undefined): number {
  return typeof n === 'number' ? n : 0
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const baselineFiles = listSessionNames(args.baselineDir)
  const pluginFiles = listSessionNames(args.pluginDir)
  const allFiles = Array.from(new Set([...baselineFiles, ...pluginFiles])).sort()
  if (allFiles.length === 0) {
    console.error(`no session JSONs found in either ${args.baselineDir} or ${args.pluginDir}`)
    process.exit(1)
  }

  const rows: ParsedRow[] = []
  let totalBaselineInput = 0
  let totalPluginInput = 0
  let totalBaselineOutput = 0
  let totalPluginOutput = 0
  let totalDurBaseline = 0
  let totalDurPlugin = 0
  let matchByte = 0
  let matchSem = 0
  let matchDiffers = 0
  let matchNa = 0

  for (const name of allFiles) {
    const base = readSession(args.baselineDir, name)
    const plug = readSession(args.pluginDir, name)
    const bIn = num(base?.tokens?.input)
    const pIn = num(plug?.tokens?.input)
    const bOut = num(base?.tokens?.output)
    const pOut = num(plug?.tokens?.output)
    const saved = bIn > 0 ? (bIn - pIn) / bIn : 0
    let match: 'byte-equal' | 'sem-equal' | 'differs' | 'n/a' = 'n/a'
    if (args.textDir) {
      const stem = name.replace(/\.json$/, '')
      match = compareTexts(path.join(args.textDir, `${stem}.baseline.txt`), path.join(args.textDir, `${stem}.plugin.txt`))
    }
    const durDiff = num(plug?.durationMs) - num(base?.durationMs)

    rows.push({
      task: name.replace(/\.json$/, ''),
      baselineInput: bIn,
      pluginInput: pIn,
      baselineOutput: bOut,
      pluginOutput: pOut,
      savedPct: Math.round(saved * 1000) / 10,
      match,
      durDiffMs: durDiff,
    })
    totalBaselineInput += bIn
    totalPluginInput += pIn
    totalBaselineOutput += bOut
    totalPluginOutput += pOut
    totalDurBaseline += num(base?.durationMs)
    totalDurPlugin += num(plug?.durationMs)
    if (match === 'byte-equal') matchByte++
    else if (match === 'sem-equal') matchSem++
    else if (match === 'differs') matchDiffers++
    else matchNa++
  }

  const totalSaved = totalBaselineInput > 0 ? (totalBaselineInput - totalPluginInput) / totalBaselineInput : 0
  const totalSavedPct = Math.round(totalSaved * 1000) / 10
  const durTotalDelta = totalDurPlugin - totalDurBaseline

  const lines: string[] = []
  lines.push('# `dsh-token-saver` Real-World Benchmark Results')
  lines.push('')
  lines.push(`Generated at: ${new Date().toISOString()}`)
  lines.push(`baseline sessions: ${args.baselineDir}`)
  lines.push(`plugin   sessions: ${args.pluginDir}`)
  lines.push('')
  lines.push('## Per-task')
  lines.push('')
  lines.push('| Task | baseline.input | plugin.input | baseline.output | plugin.output | saved % | output match | dur diff (ms) |')
  lines.push('|---|---|---|---|---|---|---|---|')
  for (const r of rows) {
    lines.push(`| ${r.task} | ${r.baselineInput.toLocaleString()} | ${r.pluginInput.toLocaleString()} | ${r.baselineOutput.toLocaleString()} | ${r.pluginOutput.toLocaleString()} | ${r.savedPct.toFixed(1)}% | ${r.match} | ${r.durDiffMs >= 0 ? '+' : ''}${r.durDiffMs} |`)
  }
  lines.push('')
  lines.push('## Totals')
  lines.push('')
  lines.push(`- **baseline.input total**: ${totalBaselineInput.toLocaleString()} tokens`)
  lines.push(`- **plugin.input total**:   ${totalPluginInput.toLocaleString()} tokens`)
  lines.push(`- **saved**: ${(totalBaselineInput - totalPluginInput).toLocaleString()} tokens (${totalSavedPct.toFixed(1)}%)`)
  lines.push(`- **baseline.output total**: ${totalBaselineOutput.toLocaleString()} tokens`)
  lines.push(`- **plugin.output total**:   ${totalPluginOutput.toLocaleString()} tokens`)
  lines.push('')
  lines.push('## Output match')
  lines.push('')
  lines.push(`- byte-equal: ${matchByte}`)
  lines.push(`- sem-equal (whitespace-normalized): ${matchSem}`)
  lines.push(`- differs: ${matchDiffers}`)
  lines.push(`- n/a: ${matchNa}`)
  lines.push('')
  lines.push('## Duration')
  lines.push('')
  lines.push(`- baseline total: ${totalDurBaseline.toLocaleString()} ms`)
  lines.push(`- plugin   total: ${totalDurPlugin.toLocaleString()} ms`)
  lines.push(`- delta: ${durTotalDelta >= 0 ? '+' : ''}${durTotalDelta.toLocaleString()} ms`)
  lines.push('')
  lines.push('## Acceptance')
  lines.push('')
  const acceptance = []
  acceptance.push(`- [${matchDiffers === 0 ? 'x' : ' '}] 0 differs (every task output semantically matches baseline)`)
  acceptance.push(`- [${totalSavedPct >= 50 ? 'x' : ' '}] saved ≥ 50% input tokens on this run (got ${totalSavedPct.toFixed(1)}%)`)
  acceptance.push(`- [ ] manual review of differs tasks (if any)`)
  for (const a of acceptance) lines.push(a)
  lines.push('')

  fs.writeFileSync(args.outputFile, lines.join('\n'), 'utf8')
  console.log(`Wrote ${args.outputFile}`)
  console.log(`Summary: ${totalSavedPct.toFixed(1)}% saved, ${matchByte} byte-equal / ${matchSem} sem-equal / ${matchDiffers} differs / ${matchNa} n/a`)
}

main()
