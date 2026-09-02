import { resolveConfig, TokenSaverSchema } from './config'
import type { ResolvedConfig, TokenSaverConfig } from './internal'
import { decidePostTool } from './strategies/tool-result-trim'
import { decidePreStep } from './strategies/context-pressure'
import { stabilizeForCache } from './strategies/prompt-cache'
import { LlmSummaryCompactionEngine, DEFAULT_COMPACTION_PROMPT } from './strategies/llm-summary'
import type {
  PostToolDecision,
  PreStepDecisionLike,
  ToolExecutionLike,
  ToolResultLike,
  AgentLike,
  TokenMeterLike,
} from './types'

export interface TokenSaverPluginOptions {
  readonly config?: TokenSaverConfig
  readonly name?: string
  readonly logger?: Logger
}

export const name = 'dsh-token-saver'

export const Config = TokenSaverSchema

export const inject = [
  'agentLoop',
  'compaction',
  'tokenMeter',
  'systemPrompt',
  'tools',
] as const

export interface Logger {
  debug: (msg: string, ...rest: readonly unknown[]) => void
  info: (msg: string, ...rest: readonly unknown[]) => void
  warn: (msg: string, ...rest: readonly unknown[]) => void
  error: (msg: string, ...rest: readonly unknown[]) => void
}

export interface CordisScope {
  on(event: string, listener: (...args: readonly unknown[]) => unknown): void
  effect(disposer: () => void): void
  get(key: string): unknown
  effectDispose(): void
}

export async function apply(rawScope: unknown, rawConfig: unknown): Promise<void> {
  const scope = asScope(rawScope)
  if (!scope) {
    throw new Error('token-saver: invalid Cordis scope')
  }
  const resolved = resolveConfig(asTokenSaverConfig(rawConfig))
  const ownLogger = createDefaultLogger()
  ownLogger.info(`token-saver: mode=${resolved.mode} preserveStructure=${resolved.preserveStructure} headBytes=${resolved.headBytes} tailBytes=${resolved.tailBytes}`)

  const tokenMeter = makeTokenMeterAccessor(scope)
  const compactionEngine = makeCompactionAccessor(scope)
  const agentForSession = makeAgentAccessor(scope)
  const callLlm = makeLlmCaller(resolved, ownLogger)
  const sessionEventsProvider = makeSessionEventsAccessor(scope)

  const trimmedListener = (rawPayload: unknown, rawNext: unknown) => {
    const next = rawNext as () => Promise<PostToolDecision>
    return handlePostTool(rawPayload, next, resolved)
  }

  const preStepListener = (rawPayload: unknown, rawNext: unknown) => {
    const next = rawNext as () => Promise<PreStepDecisionLike>
    return handlePreStep(rawPayload, next, resolved, {
      logger: ownLogger,
      telemetry: resolved.telemetry,
      getTokenMeter: tokenMeter,
      getCompactionEngine: compactionEngine,
      agentForSession,
    })
  }

  scope.on('tools/post-execute', trimmedListener)
  scope.on('agent/pre-step', preStepListener)

  const systemPromptRegistry = makeSystemPromptRegistry(scope)
  if (systemPromptRegistry) {
    systemPromptRegistry.register((sections: unknown) => {
      const arr = Array.isArray(sections) ? sections : []
      const result = stabilizeForCache({ sections: arr as Parameters<typeof stabilizeForCache>[0]['sections'], config: resolved })
      if (result.reordered) {
        ownLogger.debug(`token-saver: prompt-cache stable reorder applied (cacheable=${result.cacheableRatio.toFixed(2)})`)
      }
      return result.sections
    })
  }

  if (resolved.replaceBasicCompaction) {
    const engineImpl = new LlmSummaryCompactionEngine({
      config: resolved,
      logger: ownLogger,
      telemetry: resolved.telemetry,
      callLlm,
      sessionEventsProvider,
    })
    replaceCompactionProvider(scope, engineImpl, ownLogger)
  }

  if (typeof scope.effect === 'function') {
    scope.effect(() => {
      ownLogger.info('token-saver: unloading plugin')
    })
  }
}

async function handlePostTool(
  rawPayload: unknown,
  next: () => Promise<PostToolDecision>,
  resolved: ResolvedConfig,
): Promise<PostToolDecision> {
  const exec = (rawPayload as { exec?: ToolExecutionLike } | undefined)?.exec
  const result = (rawPayload as { result?: ToolResultLike } | undefined)?.result
  const payload = { exec, result }
  const folded = decidePostTool(payload, { config: resolved, telemetry: resolved.telemetry })
  const upstream = await next()
  if (!folded.folded) return upstream
  if (upstream.kind === 'block') return upstream
  if (upstream.kind === 'accept' && upstream.value !== undefined) return upstream
  return { ...upstream, ...folded.decision }
}

async function handlePreStep(
  rawPayload: unknown,
  next: () => Promise<PreStepDecisionLike>,
  resolved: ResolvedConfig,
  ctx: {
    readonly logger: Logger
    readonly telemetry: ResolvedConfig['telemetry']
    readonly getTokenMeter: (id: string) => TokenMeterLike | undefined
    readonly getCompactionEngine: () => import('./types.ts').CompactionEngineLike | undefined
    readonly agentForSession: (id: string) => unknown
  },
): Promise<PreStepDecisionLike> {
  const payload = rawPayload as Parameters<typeof decidePreStep>[0]
  return decidePreStep(payload, {
    config: resolved,
    logger: ctx.logger,
    telemetry: ctx.telemetry,
    getTokenMeter: ctx.getTokenMeter,
    getCompactionEngine: ctx.getCompactionEngine,
    agentForSession: ctx.agentForSession,
  }, next)
}

function asScope(input: unknown): CordisScope | undefined {
  if (!input || typeof input !== 'object') return undefined
  const obj = input as Record<string, unknown>
  if (typeof obj.on !== 'function') return undefined
  if (typeof obj.effect !== 'function') return undefined
  return obj as unknown as CordisScope
}

function asTokenSaverConfig(input: unknown): TokenSaverConfig {
  if (!input || typeof input !== 'object') return {}
  return input as TokenSaverConfig
}

function makeTokenMeterAccessor(scope: CordisScope): (sessionId: string) => TokenMeterLike | undefined {
  return (sessionId) => {
    const tm = scope.get('tokenMeter')
    if (!tm || typeof tm !== 'object') return undefined
    const obj = tm as Record<string, unknown>
    if (typeof obj.for === 'function') {
      const meter = (obj.for as (id: string) => unknown)(sessionId)
      return meter && typeof meter === 'object' ? (meter as TokenMeterLike) : undefined
    }
    if ('current' in obj && 'capacity' in obj) return obj as unknown as TokenMeterLike
    return undefined
  }
}

function makeCompactionAccessor(scope: CordisScope): () => import('./types.ts').CompactionEngineLike | undefined {
  return () => {
    const engine = scope.get('compaction')
    if (!engine || typeof engine !== 'object') return undefined
    return engine as import('./types.ts').CompactionEngineLike
  }
}

function makeAgentAccessor(scope: CordisScope): (sessionId: string) => AgentLike | undefined {
  return (sessionId) => {
    const agents = scope.get('agents')
    if (!agents || typeof agents !== 'object') return undefined
    const obj = agents as Record<string, unknown>
    if (typeof obj.for === 'function') {
      const a = (obj.for as (id: string) => unknown)(sessionId)
      return a && typeof a === 'object' ? (a as AgentLike) : undefined
    }
    return undefined
  }
}

function makeSessionEventsAccessor(scope: CordisScope): (session: AgentLike['session']) => readonly unknown[] {
  const sessions = scope.get('sessions')
  const obj = sessions as Record<string, unknown> | undefined
  if (!obj || typeof obj.get !== 'function') {
    return () => []
  }
  return (session) => {
    const get = obj.get as (id: string) => unknown
    const s = get(session.id)
    if (!s || typeof s !== 'object') return []
    const events = (s as { events?: () => readonly unknown[] }).events
    return typeof events === 'function' ? events.call(s) : []
  }
}

function makeSystemPromptRegistry(scope: CordisScope): { register: (fn: (sections: unknown) => unknown) => void } | undefined {
  const sp = scope.get('systemPrompt')
  if (!sp || typeof sp !== 'object') return undefined
  if (typeof (sp as { register?: unknown }).register !== 'function') return undefined
  return {
    register: (fn) => {
      ((sp as { register: (f: typeof fn) => void }).register)(fn)
    },
  }
}

function replaceCompactionProvider(scope: CordisScope, engineImpl: LlmSummaryCompactionEngine, logger: Logger): void {
  const obj = scope as unknown as { registry?: { register?: (key: string, value: unknown) => void; replace?: (key: string, value: unknown) => void } }
  const registry = obj.registry
  if (!registry) {
    logger.warn('token-saver: replaceBasicCompaction requested but no scope.registry; skipping replacement')
    return
  }
  if (typeof registry.replace === 'function') {
    registry.replace('compaction', engineImpl)
  } else if (typeof registry.register === 'function') {
    registry.register('compaction', engineImpl)
  }
  logger.warn('token-saver: replaceBasicCompaction=true is in effect; dsh-compaction-basic has been replaced.')
}

function makeLlmCaller(_resolved: ResolvedConfig, logger: Logger): import('./strategies/llm-summary.ts').LlmSummaryEngineDeps['callLlm'] {
  return async (_input) => {
    logger.warn('token-saver: LLM-summary called without an explicit callLlm provider; returning empty summary. Provide one via plugin apply options in dsh harness home.')
    return { summary: [], shadowedTokenCount: 0 }
  }
}

function createDefaultLogger(): Logger {
  const prefix = '[token-saver]'
  return {
    debug: (msg, ...rest) => console.debug(prefix, msg, ...rest),
    info: (msg, ...rest) => console.info(prefix, msg, ...rest),
    warn: (msg, ...rest) => console.warn(prefix, msg, ...rest),
    error: (msg, ...rest) => console.error(prefix, msg, ...rest),
  }
}

export const plugin = {
  name,
  Config,
  inject,
  apply,
}

export default plugin

export { DEFAULT_COMPACTION_PROMPT, LlmSummaryCompactionEngine }
export { decidePostTool } from './strategies/tool-result-trim'
export { decidePreStep } from './strategies/context-pressure'
export { stabilizeForCache } from './strategies/prompt-cache'
export { resolveConfig, TokenSaverSchema } from './config'
export type { ResolvedConfig, TokenSaverConfig } from './internal'
export type { ToolContentBlock, ToolResultLike, ToolExecutionLike } from './types'
