import { apply } from '../src/index'
import { resolveConfig } from '../src/config'
import type { PostToolDecision } from '../src/types'

interface MockScope {
  listeners: Map<string, Array<(...args: readonly unknown[]) => unknown>>
  effects: Array<() => void>
  registry: {
    register: (key: string, value: unknown) => void
    replace: (key: string, value: unknown) => void
    getRegistered: () => Map<string, unknown>
  }
  tokenMeter: Map<string, { current: number; capacity: number; pressure: number }>
  compactionEngine: { callsToCompactIfNeeded: number }
  sessionEvents: Map<string, Array<{ type: string; content?: unknown }>>
  systemPromptRegistrations: Array<(input: unknown) => unknown>
  on(event: string, listener: (...args: readonly unknown[]) => unknown): void
  effect(fn: () => void): void
  get(key: string): unknown
}

function createMockScope(): MockScope {
  const listeners = new Map<string, Array<(...args: readonly unknown[]) => unknown>>()
  const effects: Array<() => void> = []
  const registered = new Map<string, unknown>()
  const tokenMeter = new Map<string, { current: number; capacity: number; pressure: number }>()
  const sessionEvents = new Map<string, Array<{ type: string; content?: unknown }>>()
  const systemPromptRegistrations: Array<(input: unknown) => unknown> = []
  const compactionEngine = { callsToCompactIfNeeded: 0 }

  return {
    listeners,
    effects,
    tokenMeter,
    compactionEngine,
    sessionEvents,
    systemPromptRegistrations,
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
          compactIfNeeded: async (_agent: unknown, _trigger: string, _signal: AbortSignal) => {
            compactionEngine.callsToCompactIfNeeded++
            return { shadowedTokenCount: 1000 }
          },
          compactNow: async () => null,
          compactRegion: async () => ({}),
        }
      }
      if (key === 'agents') {
        return { for: (id: string) => ({ session: { id } }) }
      }
      if (key === 'sessions') {
        return {
          get: (id: string) => {
            let evts = sessionEvents.get(id)
            if (!evts) {
              evts = []
              sessionEvents.set(id, evts)
            }
            return { events: () => evts! }
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
      return registered.get(key)
    },
    registry: {
      register(key, value) {
        registered.set(key, value)
      },
      replace(key, value) {
        registered.set(key, value)
      },
      getRegistered() {
        return registered
      },
    },
  }
}

export function listenerCount(scope: MockScope, event: string): number {
  return scope.listeners.get(event)?.length ?? 0
}

export function fireListener(
  scope: MockScope,
  event: string,
  payload: unknown,
  upstreamDecision: unknown,
): Promise<unknown> {
  const listeners = scope.listeners.get(event) ?? []
  if (listeners.length === 0) {
    return Promise.resolve(upstreamDecision)
  }
  const listener = listeners[listeners.length - 1]!
  return Promise.resolve(listener(payload, () => Promise.resolve(upstreamDecision)))
}

export function setSessionPressure(scope: MockScope, sessionId: string, current: number, capacity: number): void {
  scope.tokenMeter.set(sessionId, { current, capacity, pressure: current / capacity })
}

export function createScope(): MockScope {
  return createMockScope()
}

export function getSystemPromptRegistrations(scope: MockScope): Array<(input: unknown) => unknown> {
  return scope.systemPromptRegistrations
}

export function getCompactionCalls(scope: MockScope): number {
  return scope.compactionEngine.callsToCompactIfNeeded
}

export interface AppliedPlugin {
  readonly scope: MockScope
  readonly resolveToolDecision: (payload: unknown, upstream: PostToolDecision) => Promise<PostToolDecision>
  readonly resolvePreStepDecision: (payload: unknown, upstream: { kind: 'enter'; messages?: readonly unknown[]; startsRequestSeries?: boolean } | { kind: 'reject' }) => Promise<unknown>
}

export async function bootPlugin(configOverrides: Parameters<typeof resolveConfig>[0]): Promise<AppliedPlugin> {
  const scope = createScope()
  await apply(scope, configOverrides ?? { mode: 'conservative' })
  return {
    scope,
    async resolveToolDecision(payload, upstream) {
      const out = await fireListener(scope, 'tools/post-execute', payload, upstream)
      return out as PostToolDecision
    },
    async resolvePreStepDecision(payload, upstream) {
      const out = await fireListener(scope, 'agent/pre-step', payload, upstream)
      return out
    },
  }
}

function estimateTokens(s: string): number {
  let chars = 0
  for (const ch of s) chars += ch.codePointAt(0)! > 0xFFFF ? 2 : 1
  return Math.max(1, Math.ceil(chars / 4))
}

export { estimateTokens }
