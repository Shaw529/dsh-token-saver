export interface ToolCallFixture {
  readonly tool: string
  readonly args: Record<string, unknown>
  readonly content: string
}

export interface SessionFixture {
  readonly id: string
  readonly turns: ReadonlyArray<{
    readonly tools: ReadonlyArray<ToolCallFixture>
  }>
}

export interface Scenario {
  readonly id: string
  readonly description: string
  readonly tools: ReadonlyArray<ToolCallFixture>
}

const READ_FILE = (path: string, lines: number): string =>
  Array.from({ length: lines }, (_, i) => {
    const n = (i + 1).toString().padStart(5, '0')
    return `${path}:${n}\tconst x_${n} = (a: number, b: number) => a + b + ${i}; export { x_${n} }; // line ${n}`
  }).join('\n')

const GREP_OUTPUT = (matches: number): string => {
  const out: string[] = []
  const total = 4000
  let placed = 0
  for (let i = 0; i < total && placed < matches; i++) {
    out.push(`src/file_${i}.ts:${i}\texport function handler_${i}() { return \`matched-keyword-${placed}\` }`)
    placed++
    for (let c = 0; c < 6; c++) {
      out.push(`src/file_${i}.ts:${i + c}\t// surrounding context line ${c}`)
    }
  }
  while (out.length < total) {
    out.push(`src/noise.ts:${out.length}\tconst noise_${out.length} = ${Math.random().toString(16).slice(2, 8)}`)
  }
  return out.join('\n')
}

const STACK_TRACE = (frames: number): string => {
  const lines: string[] = ['TypeError: cannot read property foo of undefined', '    at Object.handler (/app/src/handlers/handler.js:42:11)']
  for (let i = 0; i < frames; i++) {
    lines.push(`    at ${randomModuleName(i)} (/app/src/${randomModuleName(i + 1)}.js:${(i + 100).toString()}:${(i % 80) + 1})`)
  }
  return lines.join('\n')
}

const JSON_DUMP = (entries: number): string => {
  const items: string[] = []
  for (let i = 0; i < entries; i++) {
    items.push(JSON.stringify({
      id: i,
      name: `entry_${i}`,
      tags: Array.from({ length: 5 }, (_, t) => `tag-${t}`),
      payload: { value: i * 1.5, nested: { a: i, b: `text-${i}`, c: [i, i + 1, i + 2] } },
    }))
  }
  return `[\n${items.join(',\n')}\n]`
}

function randomModuleName(i: number): string {
  const words = ['auth', 'session', 'logger', 'router', 'middleware', 'validator', 'store', 'cache', 'events', 'queue']
  return `${words[i % words.length]}_${i % 17}`
}

function buildBigRead(): ToolCallFixture {
  return {
    tool: 'read',
    args: { path: '/repo/src/generated/big.ts' },
    content: READ_FILE('src/generated/big.ts', 2000),
  }
}

function buildHugeRead(): ToolCallFixture {
  return {
    tool: 'read',
    args: { path: '/repo/migrations/0001_init.sql' },
    content: Array.from({ length: 300 }, (_, i) => `-- block ${i}\n${READ_FILE(`block_${i}`, 200)}`).join('\n\n'),
  }
}

function buildGrepMatchHeavy(): ToolCallFixture {
  return {
    tool: 'grep',
    args: { path: '/repo/src', pattern: '/matched-keyword-\\d+/' },
    content: GREP_OUTPUT(80),
  }
}

function buildGrepSparse(): ToolCallFixture {
  return {
    tool: 'grep',
    args: { path: '/repo', pattern: 'rare-target-string-9b3f' },
    content: GREP_OUTPUT(8).replace(/matched-keyword/g, 'noise'),
  }
}

function buildStackTrace(): ToolCallFixture {
  return {
    tool: 'bash',
    args: { command: 'node ./scripts/start.js' },
    content: STACK_TRACE(1500),
  }
}

function buildJsonDump(): ToolCallFixture {
  return {
    tool: 'bash',
    args: { command: 'curl -s https://api.example.com/things | jq .' },
    content: JSON_DUMP(800),
  }
}

function buildCodeSearch(): ToolCallFixture {
  return {
    tool: 'grep_search',
    args: { query: 'TODO|FIXME|XXX' },
    content: Array.from({ length: 5000 }, (_, i) =>
      i % 73 === 0 ? `src/file_${i}.ts:${i.toString().padStart(5, '0')}\t// TODO: clean up this hack` : `src/file_${i}.ts:${i.toString().padStart(5, '0')}\tconst x_${i} = ${i}`,
    ).join('\n'),
  }
}

export const SCENARIOS: ReadonlyArray<Scenario> = [
  {
    id: 'big-read-2k-lines',
    description: 'Read 2k lines of generated TS code',
    tools: [buildBigRead()],
  },
  {
    id: 'huge-read-migration',
    description: 'Read a 60k-line migration SQL',
    tools: [buildHugeRead()],
  },
  {
    id: 'grep-match-heavy',
    description: 'Grep with 80 matches and surrounding context',
    tools: [buildGrepMatchHeavy()],
  },
  {
    id: 'grep-sparse',
    description: 'Grep with 8 sparse matches in 4k lines',
    tools: [buildGrepSparse()],
  },
  {
    id: 'stack-trace-1500',
    description: 'Stack trace with 1.5k frames',
    tools: [buildStackTrace()],
  },
  {
    id: 'json-dump-800',
    description: 'JSON dump with 800 nested entries',
    tools: [buildJsonDump()],
  },
  {
    id: 'code-search-TODO',
    description: 'Code search for TODO|FIXME|XXX in 5k lines',
    tools: [buildCodeSearch()],
  },
  {
    id: 'mixed-session-12-tools',
    description: 'Mixed tool session (12 calls, variety)',
    tools: [
      buildBigRead(),
      buildGrepMatchHeavy(),
      buildStackTrace(),
      buildJsonDump(),
      buildCodeSearch(),
      buildHugeRead(),
      buildGrepSparse(),
      buildBigRead(),
      buildStackTrace(),
      buildGrepMatchHeavy(),
      buildJsonDump(),
      buildCodeSearch(),
    ],
  },
]

export function makeSession(): SessionFixture {
  return {
    id: 'sess-bench',
    turns: [{
      tools: [
        buildBigRead(),
        buildGrepMatchHeavy(),
        buildStackTrace(),
        buildJsonDump(),
        buildCodeSearch(),
        buildHugeRead(),
        buildGrepSparse(),
        buildBigRead(),
        buildStackTrace(),
        buildGrepMatchHeavy(),
        buildJsonDump(),
        buildCodeSearch(),
      ],
    }],
  }
}
