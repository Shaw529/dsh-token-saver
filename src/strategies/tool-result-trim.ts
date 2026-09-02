import { truncate } from '../lib/truncate'
import { foldGrepResult } from '../lib/fold-grep'
import type {
  PostToolDecision,
  ResolvedConfig,
  TelemetryHook,
  ToolContentBlock,
  ToolResultLike,
} from '../internal'

export interface ToolResultTrimOptions {
  readonly config: ResolvedConfig
  readonly telemetry?: TelemetryHook
}

export interface ToolResultTrimResult {
  readonly decision: PostToolDecision
  readonly folded: boolean
  readonly originalBytes: number
  readonly trimmedBytes: number
}

const GREP_LIKE_TOOLS = new Set([
  'grep',
  'rg',
  'ripgrep',
  'search',
  'grep_search',
  'content_search',
  'code_search',
])

const READ_LIKE_TOOLS = new Set([
  'read',
  'cat',
  'file_read',
  'get_file',
  'view',
  'fetch',
  'http_get',
  'curl',
])

export function shouldHandle(toolName: string | undefined, cfg: ResolvedConfig): boolean {
  if (!toolName) return false
  if (cfg.mode === 'off') return false
  if (cfg.excludeToolNames.includes(toolName)) return false
  if (cfg.includeToolNames.length > 0 && !cfg.includeToolNames.includes(toolName)) return false
  return true
}

export interface PostToolPayloadLike {
  readonly exec?: { readonly id?: string; readonly tool?: { readonly name?: string } }
  readonly result?: ToolResultLike
}

export function decidePostTool(payload: PostToolPayloadLike, options: ToolResultTrimOptions): ToolResultTrimResult {
  const { config, telemetry } = options
  const toolName = payload.exec?.tool?.name
  if (!shouldHandle(toolName, config)) {
    return {
      decision: { kind: 'accept' },
      folded: false,
      originalBytes: 0,
      trimmedBytes: 0,
    }
  }

  if (payload.result?.isError) {
    return {
      decision: { kind: 'accept' },
      folded: false,
      originalBytes: 0,
      trimmedBytes: 0,
    }
  }

  if (payload.result?.value !== undefined && (!payload.result.content || payload.result.content.length === 0)) {
    return {
      decision: { kind: 'accept', value: payload.result.value },
      folded: false,
      originalBytes: 0,
      trimmedBytes: 0,
    }
  }

  const content = payload.result?.content
  if (!content || content.length === 0) {
    return {
      decision: { kind: 'accept' },
      folded: false,
      originalBytes: 0,
      trimmedBytes: 0,
    }
  }

  const aggregated = aggregateText(content)
  const originalBytes = Buffer.byteLength(aggregated.text, 'utf8')
  const threshold = config.headBytes + config.tailBytes + 256

  if (originalBytes <= threshold) {
    return {
      decision: { kind: 'accept', content },
      folded: false,
      originalBytes,
      trimmedBytes: originalBytes,
    }
  }

  let newAggregate: string
  let strategy: 'head-tail' | 'head-only' | 'tail-only' = 'head-tail'

  if (toolName && GREP_LIKE_TOOLS.has(toolName)) {
    const result = foldGrepResult(aggregated.text, {
      grepHeadBytes: config.grepHeadBytes,
      grepTailBytes: config.grepTailBytes,
      grepMaxMatches: config.grepMaxMatches,
      grepContextLines: config.grepContextLines,
    })
    newAggregate = result.content
  } else if (toolName && READ_LIKE_TOOLS.has(toolName)) {
    const t = truncate(aggregated.text, {
      headBytes: config.headBytes,
      tailBytes: config.tailBytes,
      preserveStructure: config.preserveStructure,
    })
    newAggregate = t.content
  } else {
    const t = truncate(aggregated.text, {
      headBytes: config.headBytes,
      tailBytes: config.tailBytes,
      preserveStructure: config.preserveStructure,
    })
    newAggregate = t.content
  }

  const rebuiltContent = rebuildContent(content, aggregated.segments, newAggregate, aggregated.text)

  const decision: PostToolDecision = { kind: 'accept', content: rebuiltContent }
  const trimmedBytes = Buffer.byteLength(newAggregate, 'utf8')

  if (telemetry?.onFold) {
    telemetry.onFold({
      toolName,
      originalBytes,
      trimmedBytes,
      savedBytes: originalBytes - trimmedBytes,
      strategy,
    })
  }

  return {
    decision,
    folded: originalBytes - trimmedBytes > 0,
    originalBytes,
    trimmedBytes,
  }
}

interface AggregateText {
  readonly text: string
  readonly segments: readonly { readonly start: number; readonly end: number }[]
}

function aggregateText(content: readonly ToolContentBlock[]): AggregateText {
  const segments: { start: number; end: number }[] = []
  let offset = 0
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
      offset += Buffer.byteLength(block.text, 'utf8')
      segments.push({ start: offset - Buffer.byteLength(block.text, 'utf8'), end: offset })
    } else {
      const placeholder = `[non-text block: ${block.type}]`
      parts.push(placeholder)
      const placeholderBytes = Buffer.byteLength(placeholder, 'utf8')
      segments.push({ start: offset, end: offset + placeholderBytes })
      offset += placeholderBytes
    }
  }
  return { text: parts.join('\n\n'), segments }
}

function rebuildContent(
  content: readonly ToolContentBlock[],
  segments: readonly { start: number; end: number }[],
  newText: string,
  originalText: string,
): readonly ToolContentBlock[] {
  if (content.length === 1) {
    return [{ type: 'text', text: newText, data: undefined }]
  }
  const out: ToolContentBlock[] = []
  let pos = 0
  const newTextBytes = Buffer.byteLength(newText, 'utf8')
  const originalBytes = Buffer.byteLength(originalText, 'utf8')
  const prefix = newText.startsWith(originalText.slice(0, Math.min(50, originalText.length / 2)))
    ? newText.slice(0, newText.indexOf('\n\n[... '))
    : newText.slice(0, Math.min(newTextBytes, originalBytes / 3))

  for (const block of content) {
    if (block.type !== 'text' || typeof block.text !== 'string') {
      out.push(block)
      pos += Buffer.byteLength(`[non-text block: ${block.type}]`, 'utf8')
      continue
    }
    if (pos === 0) {
      out.push({ ...block, text: prefix.length > 0 ? prefix : newText })
    } else if (newTextBytes > 0) {
      const tail = newText.slice(-Math.max(0, originalBytes - pos))
      out.push({ ...block, text: tail.length > 0 ? tail : '' })
    } else {
      out.push({ ...block, text: '' })
    }
    pos += Buffer.byteLength(block.text, 'utf8')
  }
  return out
}

export const __testing = { aggregateText, rebuildContent, GREP_LIKE_TOOLS, READ_LIKE_TOOLS }
