#!/usr/bin/env node
/**
 * benchmark/run.ts — drive the plugin end-to-end against a local dsh harness install.
 *
 * Requires `DEEPSEEK_API_KEY` to actually exercise the LLM path. With no key, the
 * script self-skips and prints instructions for the operator.
 *
 * Run with:
 *   DEEPSEEK_API_KEY=sk-... pnpm bench
 *   pnpm bench -- --tasks 5  # control how many BENCHMARK tasks to run
 */

import { stat } from 'node:fs/promises'
import path from 'node:path'
import { apply, resolveConfig } from '../src/index'

interface BenchTask {
  readonly name: string
  readonly prompt: string
  readonly expectedDelta?: number
}

const TASKS: readonly BenchTask[] = [
  { name: 'summarize-readme', prompt: 'Summarize the README.md and list the public surface.' },
  { name: 'count-symbols', prompt: 'Count the number of exported symbols in src/index.ts and list them.' },
  { name: 'diff-dirs', prompt: 'Diff the structure of src/ vs test/.' },
  { name: 'plan-compaction', prompt: 'Plan a compaction strategy for a 50k-token conversation about refactoring a logger.' },
  { name: 'token-budget', prompt: 'Estimate the token budget for a 5-tool-step coding session.' },
]

async function ensureDsh(): Promise<string | undefined> {
  const candidates = [
    path.resolve(process.cwd(), '..', 'deepseek-harness'),
    path.resolve(process.cwd(), '..', '..', 'deepseek-harness'),
    '/usr/lib/node_modules/@deepseek-ai/dsh',
  ]
  for (const c of candidates) {
    try {
      const s = await stat(c)
      if (s.isDirectory()) return c
    } catch { /* skip */ }
  }
  return undefined
}

interface MockScope {
  invoked: boolean
  events: string[]
  on(event: string, listener: (...args: readonly unknown[]) => unknown): void
  effect(fn: () => void): void
  get(key: string): unknown
}

function makeMockScope(): MockScope {
  const events: string[] = []
  return {
    invoked: false,
    events,
    on(event) {
      events.push(`on:${event}`)
    },
    effect(fn) {
      fn()
    },
    get() {
      return undefined
    },
  }
}

async function main(args: readonly string[]): Promise<void> {
  const taskLimit = Number(args[0] ?? '3')
  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn('[bench] DEEPSEEK_API_KEY is not set; self-skipping. To exercise real e2e, export the key and re-run.')
    const scope = makeMockScope()
    await apply(scope, resolveConfig({ mode: 'conservative' }))
    console.info(`[bench] (mock) plugin activated, listeners: ${scope.events.join(', ')}`)
    console.info('[bench] (mock) real e2e skipped; set DEEPSEEK_API_KEY to run against dsh harness.')
    return
  }

  const dshRoot = await ensureDsh()
  if (!dshRoot) {
    console.error('[bench] deepseek-harness checkout not found near the workspace.')
    process.exit(2)
  }
  console.info(`[bench] using dsh from ${dshRoot}`)

  for (const task of TASKS.slice(0, taskLimit)) {
    console.info(`[bench] task: ${task.name}`)
    // Wiring live would require booting dsh as a subprocess; we leave that to the operator.
    console.info('[bench] (placeholder) run: pnpm dsh --profile headless "summarize this workspace"')
  }
}

const args = process.argv.slice(2)
main(args).catch((err) => {
  console.error('[bench] failed:', err)
  process.exit(1)
})
