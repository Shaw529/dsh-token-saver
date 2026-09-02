import type { SessionMode, TokenSaverConfig } from './types'

export type { SessionMode, TokenSaverConfig }

export interface ResolvedConfig {
  readonly mode: SessionMode
  readonly preserveStructure: boolean
  readonly headBytes: number
  readonly tailBytes: number
  readonly grepMaxMatches: number
  readonly grepContextLines: number
  readonly grepHeadBytes: number
  readonly grepTailBytes: number
  readonly pressureThreshold: number
  readonly compactPressureThreshold: number
  readonly llmSummaryEnabled: boolean
  readonly llmSummaryPrompt: string
  readonly llmSummaryMaxInputTokens: number
  readonly replaceBasicCompaction: boolean
  readonly includeToolNames: readonly string[]
  readonly excludeToolNames: readonly string[]
  readonly cacheStableSections: readonly string[]
  readonly telemetry: TokenSaverConfig['telemetry']
}

export const DEFAULTS: ResolvedConfig = Object.freeze({
  mode: 'conservative',
  preserveStructure: true,
  headBytes: 16 * 1024,
  tailBytes: 8 * 1024,
  grepMaxMatches: 30,
  grepContextLines: 2,
  grepHeadBytes: 8 * 1024,
  grepTailBytes: 4 * 1024,
  pressureThreshold: 0.5,
  compactPressureThreshold: 0.5,
  llmSummaryEnabled: false,
  llmSummaryPrompt: '',
  llmSummaryMaxInputTokens: 16_000,
  replaceBasicCompaction: false,
  includeToolNames: [] as readonly string[],
  excludeToolNames: [] as readonly string[],
  cacheStableSections: [] as readonly string[],
  telemetry: undefined,
})

export function resolveConfig(input: TokenSaverConfig | undefined): ResolvedConfig {
  const cfg = input ?? {}
  const mode = cfg.mode ?? DEFAULTS.mode
  const llmSummaryEnabled = cfg.llmSummaryEnabled === true && (mode === 'balanced' || mode === 'aggressive')
  return {
    mode,
    preserveStructure: cfg.preserveStructure ?? DEFAULTS.preserveStructure,
    headBytes: cfg.headBytes ?? DEFAULTS.headBytes,
    tailBytes: cfg.tailBytes ?? DEFAULTS.tailBytes,
    grepMaxMatches: cfg.grepMaxMatches ?? DEFAULTS.grepMaxMatches,
    grepContextLines: cfg.grepContextLines ?? DEFAULTS.grepContextLines,
    grepHeadBytes: cfg.grepHeadBytes ?? DEFAULTS.grepHeadBytes,
    grepTailBytes: cfg.grepTailBytes ?? DEFAULTS.grepTailBytes,
    pressureThreshold: cfg.pressureThreshold ?? DEFAULTS.pressureThreshold,
    compactPressureThreshold: cfg.compactPressureThreshold ?? DEFAULTS.compactPressureThreshold,
    llmSummaryEnabled,
    llmSummaryPrompt: cfg.llmSummaryPrompt ?? DEFAULTS.llmSummaryPrompt,
    llmSummaryMaxInputTokens: cfg.llmSummaryMaxInputTokens ?? DEFAULTS.llmSummaryMaxInputTokens,
    replaceBasicCompaction: cfg.replaceBasicCompaction ?? (mode === 'aggressive'),
    includeToolNames: cfg.includeToolNames ?? DEFAULTS.includeToolNames,
    excludeToolNames: cfg.excludeToolNames ?? DEFAULTS.excludeToolNames,
    cacheStableSections: cfg.cacheStableSections ?? DEFAULTS.cacheStableSections,
    telemetry: cfg.telemetry,
  }
}

export interface ConfigDescriptor {
  readonly name: string
  readonly fields: Readonly<Record<keyof ResolvedConfig | 'mode', 'string' | 'number' | 'boolean' | 'enum'>>
  readonly validate: (input: unknown) => TokenSaverConfig
  readonly resolve: (input: TokenSaverConfig) => ResolvedConfig
}

export const TokenSaverSchema: ConfigDescriptor = {
  name: 'TokenSaverConfig',
  fields: {
    mode: 'enum',
    preserveStructure: 'boolean',
    headBytes: 'number',
    tailBytes: 'number',
    grepMaxMatches: 'number',
    grepContextLines: 'number',
    grepHeadBytes: 'number',
    grepTailBytes: 'number',
    pressureThreshold: 'number',
    compactPressureThreshold: 'number',
    llmSummaryEnabled: 'boolean',
    llmSummaryPrompt: 'string',
    llmSummaryMaxInputTokens: 'number',
    replaceBasicCompaction: 'boolean',
    includeToolNames: 'string',
    excludeToolNames: 'string',
    cacheStableSections: 'string',
    telemetry: 'string',
  },
  validate(input) {
    if (!input || typeof input !== 'object') return {}
    return input as TokenSaverConfig
  },
  resolve: resolveConfig,
}
