import { describe, expect, it } from 'vitest'
import { estimateTokens, runAll, runViaDecidePostTool } from '../../benchmark/compare/index'
import { SCENARIOS } from '../../benchmark/fixtures/index'
import { resolveConfig } from '../../src/config'
import { decidePostTool } from '../../src/strategies/tool-result-trim'
import type { ToolResultLike } from '../../src/types'

interface Row {
  id: string
  conservativeSavedPct: number
}

describe('compare benchmark — offline token estimator', () => {
  it('estimator counts ~4 chars per token for ASCII', () => {
    expect(estimateTokens('hello world')).toBe(3)
    expect(estimateTokens('a'.repeat(100))).toBe(25)
  })

  it('estimator counts surrogate pairs as 2 chars', () => {
    expect(estimateTokens('😀😀😀😀'.repeat(10))).toBe(20)
  })

  it('runAll produces a row per scenario', () => {
    const report = runAll()
    expect(report.rows.length).toBe(SCENARIOS.length)
  })

  it('conservative mode saves tokens on every large scenario', () => {
    const report = runAll()
    for (const r of report.rows) {
      expect(r.conservativeTokens).toBeLessThan(r.originalTokens)
    }
  })

  it('balanced mode saves at least as many tokens as conservative', () => {
    const report = runAll()
    for (const r of report.rows) {
      expect(r.balancedTokens).toBeLessThanOrEqual(r.conservativeTokens)
    }
  })

  it('totals: conservative saves >= 80% on the suite (lossless fold keeps head/tail coverage)', () => {
    const report = runAll()
    expect(report.totals.conservativeSavedPct).toBeGreaterThanOrEqual(80)
  })

  it('mixed session saves >= 90% in conservative mode', () => {
    const mixed = SCENARIOS.find((s) => s.id === 'mixed-session-12-tools')!
    const row = runViaDecidePostTool(mixed)
    expect(row.conservativeSavedPct).toBeGreaterThanOrEqual(90)
  })

  it('decidePostTool is lossless when input is small', () => {
    const cfg = resolveConfig({ mode: 'conservative' })
    const out = decidePostTool(
      {
        exec: { id: 'x', tool: { name: 'read' } },
        result: { content: [{ type: 'text', text: 'tiny' }] } as unknown as ToolResultLike,
      },
      { config: cfg },
    )
    expect(out.folded).toBe(false)
  })

  it('stack-trace-1500 yields big savings (truncates aggressively)', () => {
    const stack = SCENARIOS.find((s) => s.id === 'stack-trace-1500')!
    const row = runViaDecidePostTool(stack)
    expect(row.conservativeSavedTokens).toBeGreaterThan(5000)
  })

  it('big-read yields >85% saving in conservative mode (lines preserved structure)', () => {
    const big = SCENARIOS.find((s) => s.id === 'big-read-2k-lines')!
    const row = runViaDecidePostTool(big)
    expect(row.conservativeSavedPct).toBeGreaterThan(85)
  })
})

describe('per-scenario regression snapshots', () => {
  it('matches recorded token budgets within tolerance', () => {
    const report = runAll()
    const map: Record<string, Row> = Object.fromEntries(report.rows.map((r) => [r.id, r]))
    const expectations: ReadonlyArray<{ id: string; minConservSavedPct: number }> = [
      { id: 'big-read-2k-lines', minConservSavedPct: 85 },
      { id: 'huge-read-migration', minConservSavedPct: 95 },
      { id: 'grep-match-heavy', minConservSavedPct: 90 },
      { id: 'grep-sparse', minConservSavedPct: 85 },
      { id: 'stack-trace-1500', minConservSavedPct: 55 },
      { id: 'json-dump-800', minConservSavedPct: 75 },
      { id: 'code-search-TODO', minConservSavedPct: 90 },
      { id: 'mixed-session-12-tools', minConservSavedPct: 90 },
    ]
    for (const e of expectations) {
      const r = map[e.id]
      expect(r).toBeDefined()
      expect(r!.conservativeSavedPct).toBeGreaterThanOrEqual(e.minConservSavedPct)
    }
  })
})
