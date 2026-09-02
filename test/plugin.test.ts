import { describe, expect, it, vi } from 'vitest'
import { apply, name, Config, inject } from '../src/index'

function createScope() {
  const listeners = new Map<string, Array<(...args: readonly unknown[]) => unknown>>()
  const effects: Array<() => void> = []
  return {
    listeners,
    effects,
    on: vi.fn((event: string, listener: (...args: readonly unknown[]) => unknown) => {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event)!.push(listener)
    }),
    effect: vi.fn((d: () => void) => effects.push(d)),
    get: vi.fn((key: string) => {
      if (key === 'compaction') return { stub: true }
      if (key === 'tokenMeter') return undefined
      if (key === 'systemPrompt') return undefined
      if (key === 'agents') return undefined
      if (key === 'sessions') return undefined
      return undefined
    }),
    registry: { register: vi.fn(), replace: vi.fn() },
  }
}

describe('plugin entry', () => {
  it('exports name, Config, inject', () => {
    expect(name).toBe('dsh-token-saver')
    expect(typeof Config).toBe('object')
    expect(Array.isArray(inject)).toBe(true)
  })

  it('registers tools/post-execute and agent/pre-step listeners', async () => {
    const scope = createScope()
    await apply(scope, { mode: 'conservative' })
    expect(scope.listeners.has('tools/post-execute')).toBe(true)
    expect(scope.listeners.has('agent/pre-step')).toBe(true)
  })

  it('throws on invalid scope', async () => {
    await expect(apply({} as never, {} as never)).rejects.toThrow(/invalid Cordis scope/)
  })

  it('records an effect disposer', async () => {
    const scope = createScope()
    await apply(scope, { mode: 'off' })
    expect(scope.effects.length).toBeGreaterThanOrEqual(1)
  })

  it('does not replace compaction in conservative mode', async () => {
    const scope = createScope()
    await apply(scope, { mode: 'conservative' })
    expect(scope.registry.replace).not.toHaveBeenCalled()
  })

  it('replaces compaction in aggressive mode when llmSummaryEnabled true', async () => {
    const scope = createScope()
    await apply(scope, { mode: 'aggressive', llmSummaryEnabled: true, replaceBasicCompaction: true })
    expect(scope.registry.replace).toHaveBeenCalledWith('compaction', expect.anything())
  })
})
