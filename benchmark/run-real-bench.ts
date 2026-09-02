#!/usr/bin/env node
/**
 * benchmark/run-real-bench.ts — drive a real dsh subprocess for each task,
 * once with baseline home, once with plugin home. Capture output text +
 * session JSON metrics. Designed to be run by hand on a machine with
 * DEEPSEEK_API_KEY set; the script self-skips otherwise.
 *
 * Usage:
 *   export DEEPSEEK_API_KEY=sk-...
 *   pnpm exec tsx benchmark/run-real-bench.ts \
 *     --dsh-home-baseline ~/.dsh-bench-baseline \
 *     --dsh-home-plugin   ~/.dsh-bench-with-plugin \
 *     --tasks benchmark/tasks.json \
 *     --out ./runs
 *
 * `--out` directory will gain:
 *   baseline/task<N>.txt
 *   baseline/task<N>.log
 *   with-plugin/task<N>.txt
 *   with-plugin/task<N>.log
 *   sessions-baseline/<session-id>.json
 *   sessions-with-plugin/<session-id>.json
 *
 * After this completes, run:
 *   pnpm exec tsx benchmark/parse-results.ts \
 *     --baseline ./runs/sessions-baseline \
 *     --plugin   ./runs/sessions-with-plugin \
 *     --output   bench-results.md \
 *     --text-dir ./runs
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

interface Task { id: string; prompt: string; evaluate?: string }
interface CliArgs {
  baselineHome: string
  pluginHome: string
  tasksFile: string
  outDir: string
  apiKey: string
}

function parseArgs(argv: string[]): CliArgs | undefined {
  const args: Partial<CliArgs> = { apiKey: process.env.DEEPSEEK_API_KEY ?? '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--dsh-home-baseline') args.baselineHome = argv[++i] ?? ''
    else if (a === '--dsh-home-plugin') args.pluginHome = argv[++i] ?? ''
    else if (a === '--tasks') args.tasksFile = argv[++i] ?? ''
    else if (a === '--out') args.outDir = argv[++i] ?? ''
  }
  if (!args.baselineHome || !args.pluginHome || !args.tasksFile || !args.outDir) return undefined
  return args as CliArgs
}

function runDshForTask(args: CliArgs, profile: 'baseline' | 'plugin', task: Task, taskIndex: number): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const home = profile === 'baseline' ? args.baselineHome : args.pluginHome
  const outDir = path.join(args.outDir, profile)
  fs.mkdirSync(outDir, { recursive: true })
  const txtPath = path.join(outDir, `task${taskIndex + 1}.txt`)
  const logPath = path.join(outDir, `task${taskIndex + 1}.log`)
  return new Promise((resolve) => {
    const child = spawn('npx', ['@deepseek-ai/dsh', '--profile', 'headless', task.prompt], {
      env: {
        ...process.env,
        DSH_HOME: home,
        DEEPSEEK_API_KEY: args.apiKey,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString('utf8') })
    child.on('close', (code) => {
      fs.writeFileSync(txtPath, out, 'utf8')
      fs.writeFileSync(logPath, `exit=${code ?? 'null'}\n${err}`, 'utf8')
      resolve({ ok: code === 0, stdout: out, stderr: err })
    })
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args) {
    console.error('Usage: run-real-bench.ts --dsh-home-baseline <dir> --dsh-home-plugin <dir> --tasks <json> --out <dir>')
    process.exit(1)
  }
  if (!args.apiKey) {
    console.warn('[real-bench] DEEPSEEK_API_KEY is not set; would self-skip. To run, export the key first.')
    process.exit(2)
  }
  const tasks: Task[] = JSON.parse(fs.readFileSync(args.tasksFile, 'utf8'))
  console.log(`[real-bench] ${tasks.length} tasks; output dir = ${args.outDir}`)

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]!
    console.log(`[${i + 1}/${tasks.length}] task=${t.id} baseline...`)
    const b = await runDshForTask(args, 'baseline', t, i)
    console.log(`    baseline ok=${b.ok} bytes=${b.stdout.length}`)
    console.log(`[${i + 1}/${tasks.length}] task=${t.id} with-plugin...`)
    const p = await runDshForTask(args, 'plugin', t, i)
    console.log(`    plugin   ok=${p.ok} bytes=${p.stdout.length}`)
  }

  console.log('')
  console.log('[real-bench] done. Now run:')
  console.log(`  pnpm exec tsx benchmark/parse-results.ts \\`)
  console.log(`    --baseline ${path.join(args.outDir, 'baseline')} \\`)
  console.log(`    --plugin ${path.join(args.outDir, 'with-plugin')} \\`)
  console.log(`    --output bench-results.md`)
  console.log('...')
}

main().catch((err) => {
  console.error('[real-bench] failed:', err)
  process.exit(1)
})
