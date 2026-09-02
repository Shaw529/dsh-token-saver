import { truncate } from '../../src/lib/truncate'
import { foldGrepResult } from '../../src/lib/fold-grep'
import { decidePostTool } from '../../src/strategies/tool-result-trim'
import { resolveConfig } from '../../src/config'
import { SCENARIOS, type Scenario, type ToolCallFixture } from '../fixtures'

export interface CompareRow {
  readonly id: string
  readonly description: string
  readonly originalTokens: number
  readonly conservativeTokens: number
  readonly balancedTokens: number
  readonly conservativeSavedPct: number
  readonly balancedSavedPct: number
  readonly conservativeSavedTokens: number
  readonly balancedSavedTokens: number
}

export interface CompareReport {
  readonly rows: ReadonlyArray<CompareRow>
  readonly totals: {
    readonly originalTokens: number
    readonly conservativeTokens: number
    readonly balancedTokens: number
    readonly conservativeSavedPct: number
    readonly balancedSavedPct: number
    readonly conservativeSavedTokens: number
    readonly balancedSavedTokens: number
  }
}

export function estimateTokens(s: string): number {
  if (!s) return 0
  let chars = 0
  for (const ch of s) chars += ch.codePointAt(0)! > 0xFFFF ? 2 : 1
  return Math.max(1, Math.ceil(chars / 4))
}

function asPayload(tool: ToolCallFixture) {
  return {
    exec: { id: `${tool.tool}-id`, tool: { name: tool.tool } },
    result: {
      content: [{ type: 'text', text: tool.content }],
      isError: false,
    },
  }
}

function simulateNoop(tool: ToolCallFixture): string {
  return tool.content
}

function simulateConservative(tool: ToolCallFixture): string {
  if (tool.content.length < 24 * 1024) return tool.content
  if (tool.tool === 'grep' || tool.tool === 'grep_search' || tool.tool === 'rg' || tool.tool === 'search') {
    const pattern = (tool.args as { pattern?: string }).pattern
    return foldGrepResult(tool.content, {
      pattern,
      grepMaxMatches: 30,
      grepContextLines: 2,
      grepHeadBytes: 8 * 1024,
      grepTailBytes: 4 * 1024,
    }).content
  }
  return truncate(tool.content, {
    headBytes: 16 * 1024,
    tailBytes: 8 * 1024,
    preserveStructure: true,
  }).content
}

function simulateBalanced(tool: ToolCallFixture): string {
  if (tool.content.length < 16 * 1024) return tool.content
  if (tool.tool === 'grep' || tool.tool === 'grep_search' || tool.tool === 'rg' || tool.tool === 'search') {
    const pattern = (tool.args as { pattern?: string }).pattern
    return foldGrepResult(tool.content, {
      pattern,
      grepMaxMatches: 30,
      grepContextLines: 2,
      grepHeadBytes: 8 * 1024,
      grepTailBytes: 4 * 1024,
    }).content
  }
  return truncate(tool.content, {
    headBytes: 8 * 1024,
    tailBytes: 4 * 1024,
    preserveStructure: true,
  }).content
}

function runScenario(scenario: Scenario): CompareRow {
  let original = 0
  let conservative = 0
  let balanced = 0
  for (const tool of scenario.tools) {
    original += estimateTokens(simulateNoop(tool))
    conservative += estimateTokens(simulateConservative(tool))
    balanced += estimateTokens(simulateBalanced(tool))
  }
  const csSaved = original - conservative
  const blSaved = original - balanced
  return {
    id: scenario.id,
    description: scenario.description,
    originalTokens: original,
    conservativeTokens: conservative,
    balancedTokens: balanced,
    conservativeSavedTokens: csSaved,
    balancedSavedTokens: blSaved,
    conservativeSavedPct: pct(csSaved, original),
    balancedSavedPct: pct(blSaved, original),
  }
}

function pct(saved: number, orig: number): number {
  if (orig <= 0) return 0
  return Math.round((saved / orig) * 1000) / 10
}

export function runAll(): CompareReport {
  const rows = SCENARIOS.map(runScenario)
  const totals = rows.reduce(
    (acc, r) => ({
      originalTokens: acc.originalTokens + r.originalTokens,
      conservativeTokens: acc.conservativeTokens + r.conservativeTokens,
      balancedTokens: acc.balancedTokens + r.balancedTokens,
      conservativeSavedTokens: acc.conservativeSavedTokens + r.conservativeSavedTokens,
      balancedSavedTokens: acc.balancedSavedTokens + r.balancedSavedTokens,
    }),
    {
      originalTokens: 0,
      conservativeTokens: 0,
      balancedTokens: 0,
      conservativeSavedTokens: 0,
      balancedSavedTokens: 0,
    },
  )
  return {
    rows,
    totals: {
      ...totals,
      conservativeSavedPct: pct(totals.conservativeSavedTokens, totals.originalTokens),
      balancedSavedPct: pct(totals.balancedSavedTokens, totals.originalTokens),
    },
  }
}

export function runViaDecidePostTool(scenario: Scenario): CompareRow {
  const cfg = resolveConfig({ mode: 'conservative' })
  let original = 0
  let conservative = 0
  for (const tool of scenario.tools) {
    const payload = asPayload(tool)
    original += estimateTokens(tool.content)
    const out = decidePostTool(payload as never, { config: cfg })
    if (out.folded && out.decision.kind === 'accept' && Array.isArray(out.decision.content)) {
      conservative += estimateTokens(out.decision.content.map((b: { text?: string }) => b.text ?? '').join('\n\n'))
    } else {
      conservative += estimateTokens(tool.content)
    }
  }
  const bl = runScenario(scenario)
  return {
    ...bl,
    conservativeTokens: conservative,
    conservativeSavedTokens: original - conservative,
    conservativeSavedPct: pct(original - conservative, original),
  }
}
