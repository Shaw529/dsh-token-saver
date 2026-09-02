#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..', 'benchmark', 'fixtures-dryrun')
fs.mkdirSync(path.join(ROOT, 'baseline'), { recursive: true })
fs.mkdirSync(path.join(ROOT, 'plugin'), { recursive: true })
fs.mkdirSync(path.join(ROOT, 'text'), { recursive: true })

const tasks = [
  { id: 'task1', baseIn: 2341, plugIn: 2341 },
  { id: 'task2', baseIn: 8192, plugIn: 2034 },
  { id: 'task3', baseIn: 153440, plugIn: 8732 },
  { id: 'task4', baseIn: 167001, plugIn: 11902 },
  { id: 'task5', baseIn: 24500, plugIn: 9830 },
  { id: 'task6', baseIn: 6022, plugIn: 2041 },
  { id: 'task7', baseIn: 12400, plugIn: 4210 },
  { id: 'task8', baseIn: 18910, plugIn: 6811 },
]

for (const t of tasks) {
  const bSession = { id: t.id, tokens: { input: t.baseIn, output: 1000 + Math.floor(Math.random() * 500) }, durationMs: 30_000 + Math.floor(Math.random() * 5_000) }
  const pSession = { id: t.id, tokens: { input: t.plugIn, output: 800 + Math.floor(Math.random() * 400) }, durationMs: 29_000 + Math.floor(Math.random() * 5_000) }
  fs.writeFileSync(path.join(ROOT, 'baseline', `${t.id}.json`), JSON.stringify(bSession, null, 2), 'utf8')
  fs.writeFileSync(path.join(ROOT, 'plugin', `${t.id}.json`), JSON.stringify(pSession, null, 2), 'utf8')
  const suffix = Math.random() > 0.1 ? '' : ' (plugin)\n'
  fs.writeFileSync(path.join(ROOT, 'text', `${t.id}.baseline.txt`), `output for ${t.id}\nwith content\n`, 'utf8')
  fs.writeFileSync(path.join(ROOT, 'text', `${t.id}.plugin.txt`), `output for ${t.id}\nwith content${suffix}`, 'utf8')
}

console.log(`fixtures written at ${ROOT}`)
