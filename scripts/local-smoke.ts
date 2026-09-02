#!/usr/bin/env node
/**
 * scripts/local-smoke.ts — 启动 mock dsh scope，加载真实 dsh-token-saver，
 * 模拟完整 tools/post-execute + agent/pre-step 事件流，输出节省数字。
 *
 * 这是把 fixture 场景在一个完全 mock 的 dsh-compatible Cordis 环境里跑一遍，
 * 验证插件真的节省了 token 数量，同时证明它和 dsh 真实事件契约兼容。
 *
 * 用法：
 *   pnpm run smoke
 *   pnpm exec tsx scripts/local-smoke.ts                    # 默认 conservative
 *   pnpm exec tsx scripts/local-smoke.ts --mode=balanced
 *   pnpm exec tsx scripts/local-smoke.ts --mode=aggressive
 *   pnpm exec tsx scripts/local-smoke.ts --all              # 跑全部四档
 */

import { apply } from '../src/index'
import { resolveConfig } from '../src/config'
import { SCENARIOS } from '../benchmark/fixtures'
import type { PostToolDecision, PreStepDecisionLike } from '../src/types'

interface MockScope {
  listeners: Map<string, Array<(...args: readonly unknown[]) => unknown>>
  effects: Array<() => void>
  compactionEngine: { callsToCompactIfNeeded: number; lastAgentId?: string; lastTrigger?: string }
  sessionEvents: Map<string, Array<{ type: string; content?: string }>>
  systemPromptRegistrations: Array<(input: unknown) => unknown>
  replacedKeys: Array<string>
  foldedCount: number
  compactTelemetry: Array<unknown>
  foldTelemetry: Array<unknown>
  tokenMeter: Map<string, { current: number; capacity: number; pressure: number }>
  on(event: string, listener: (...args: readonly unknown[]) => unknown): void
  effect(fn: () => void): void
  get(key: string): unknown
}

function createScope(): MockScope {
  const listeners = new Map<string, Array<(...args: readonly unknown[]) => unknown>>()
  const effects: Array<() => void> = []
  const tokenMeter = new Map<string, { current: number; capacity: number; pressure: number }>()
  const sessionEvents = new Map<string, Array<{ type: string; content?: string }>>()
  const systemPromptRegistrations: Array<(input: unknown) => unknown> = []
  const compactionEngine = {
    callsToCompactIfNeeded: 0,
    lastAgentId: undefined as string | undefined,
    lastTrigger: undefined as string | undefined,
  }
  const replacedKeys: Array<string> = []
  const scope: MockScope = {
    listeners,
    effects,
    tokenMeter,
    compactionEngine,
    sessionEvents,
    systemPromptRegistrations,
    replacedKeys,
    foldedCount: 0,
    compactTelemetry: [],
    foldTelemetry: [],
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event)!.push(listener)
    },
    effect(fn) {
      effects.push(fn)
    },
    get(key) {
      if (key === 'tokenMeter') {
        return {
          for: (id: string) => tokenMeter.get(id),
        }
      }
      if (key === 'compaction') {
        return {
          compactIfNeeded: async (agent: { session: { id: string } }, trigger: string) => {
            compactionEngine.callsToCompactIfNeeded++
            compactionEngine.lastAgentId = agent.session.id
            compactionEngine.lastTrigger = trigger
            return { shadowedTokenCount: 1200, compactorEngine: 'mock-basic' }
          },
          compactNow: async () => null,
          compactRegion: async () => ({}),
        }
      }
      if (key === 'agents') {
        return { for: (id: string) => ({ session: { id, provider: 'mock', model: 'mock-mock' } }) }
      }
      if (key === 'sessions') {
        return {
          get: (id: string) => {
            if (!sessionEvents.has(id)) sessionEvents.set(id, [])
            return { events: () => sessionEvents.get(id)! }
          },
        }
      }
      if (key === 'systemPrompt') {
        return {
          register: (fn: (input: unknown) => unknown) => {
            systemPromptRegistrations.push(fn)
          },
        }
      }
      return undefined
    },
  }
  ;(scope as unknown as { registry?: { replace: (k: string, v: unknown) => void; register: (k: string, v: unknown) => void } }).registry = {
    replace(k, v) {
      replacedKeys.push(k)
      if (k === 'compaction') {
        scope.get = ((orig) => (key: string) => key === 'compaction' ? v : orig(key))(scope.get.bind(scope))
      }
    },
    register(k) {
      replacedKeys.push(k)
    },
  }
  return scope
}

function estimateTokens(s: string): number {
  let chars = 0
  for (const ch of s) chars += ch.codePointAt(0)! > 0xFFFF ? 2 : 1
  return Math.max(1, Math.ceil(chars / 4))
}

async function firePluginOnEvent(
  scope: MockScope,
  event: string,
  payload: unknown,
  upstream: unknown,
): Promise<unknown> {
  const listeners = scope.listeners.get(event) ?? []
  if (listeners.length === 0) return upstream
  const listener = listeners[listeners.length - 1]!
  return Promise.resolve(listener(payload, () => Promise.resolve(upstream)))
}

function findListenerCount(scope: MockScope, event: string): number {
  return scope.listeners.get(event)?.length ?? 0
}

async function runSmoke(mode: 'off' | 'conservative' | 'balanced' | 'aggressive') {
  const cfg = resolveConfig({
    mode,
    telemetry: {
      onFold: (e) => (scope.foldTelemetry.push(e)),
      onCompact: (e) => (scope.compactTelemetry.push(e)),
    },
  })
  const scope = createScope()
  await apply(scope, cfg)
  console.log(`\n========== mode=${mode} ==========`)
  console.log(`listeners: tools/post-execute=${findListenerCount(scope, 'tools/post-execute')}, agent/pre-step=${findListenerCount(scope, 'agent/pre-step')}, systemPrompt registrations=${scope.systemPromptRegistrations.length}`)
  console.log(`replacedKeys before run: ${scope.replacedKeys.join(',') || '(none)'}`)

  let originalTokens = 0
  let postPluginTokens = 0
  let foldedCount = 0
  let errorResultsPreserved = 0

  for (const scenario of SCENARIOS) {
    for (const toolCall of scenario.tools) {
      const originalText = toolCall.content
      originalTokens += estimateTokens(originalText)
      const upstream: PostToolDecision = {
        kind: 'accept',
        content: [{ type: 'text', text: originalText }],
      }
      const payload = {
        exec: { id: `${toolCall.tool}-${Math.random()}`, tool: { name: toolCall.tool } },
        result: { content: [{ type: 'text', text: originalText }], isError: false },
      }
      const out = await firePluginOnEvent(scope, 'tools/post-execute', payload, upstream) as PostToolDecision
      const outText = (Array.isArray(out.content) ? out.content.map((b: { text?: string }) => b.text ?? '').join('\n\n') : '')
      postPluginTokens += estimateTokens(outText)
      if (outText.length < originalText.length) foldedCount++

      const errorPayload = {
        exec: { id: `${toolCall.tool}-e`, tool: { name: toolCall.tool } },
        result: { content: [{ type: 'text', text: originalText }], isError: true },
      }
      const errOut = await firePluginOnEvent(scope, 'tools/post-execute', errorPayload, upstream) as PostToolDecision
      const errText = (Array.isArray(errOut.content) ? errOut.content.map((b: { text?: string }) => b.text ?? '').join('\n\n') : '')
      if (errText.length === originalText.length) errorResultsPreserved++
    }
  }

  const sessionId = 'smoke-session'
  scope.tokenMeter.set(sessionId, { current: 80_000, capacity: 100_000, pressure: 0.8 })
  const upstreamStep: PreStepDecisionLike = { kind: 'enter', messages: [] }
  const stepPayload = {
    agent: { session: { id: sessionId } },
    messages: [],
    turn: 1,
    step: 1,
    signal: new AbortController().signal,
  }
  await firePluginOnEvent(scope, 'agent/pre-step', stepPayload, upstreamStep)

  const saved = originalTokens - postPluginTokens
  const savedPct = originalTokens > 0 ? Math.round((saved / originalTokens) * 1000) / 10 : 0
  console.log(`tool results: original=${originalTokens} postPlugin=${postPluginTokens} saved=${saved} (${savedPct}%)`)
  console.log(`folded tool results: ${foldedCount}/${SCENARIOS.reduce((n, s) => n + s.tools.length, 0)}`)
  console.log(`error results preserved: ${errorResultsPreserved}/${SCENARIOS.reduce((n, s) => n + s.tools.length, 0)}`)
  console.log(`telemetry: fold=${scope.foldTelemetry.length}, compact=${scope.compactTelemetry.length}`)
  console.log(`compactionEngine.compactIfNeeded calls: ${scope.compactionEngine.callsToCompactIfNeeded}`)
  console.log(`systemPrompt register runtime: ${scope.systemPromptRegistrations[0] ? 'present' : 'absent'}`)
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--all')) {
    for (const mode of ['off', 'conservative', 'balanced', 'aggressive'] as const) {
      await runSmoke(mode)
    }
    return
  }
  const modeArg = args.find((a) => a.startsWith('--mode='))?.split('=')[1] as 'off' | 'conservative' | 'balanced' | 'aggressive' | undefined
  const mode = modeArg ?? 'conservative'
  await runSmoke(mode)
}

main().catch((err) => {
  console.error('[smoke] failed:', err)
  process.exit(1)
})
