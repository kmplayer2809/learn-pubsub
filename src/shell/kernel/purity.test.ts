import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const FORBIDDEN = [
  /from ['"]react['"]/,
  /from ['"]zustand['"]/,
  /from ['"]@xyflow\/react['"]/,
  /\bMath\.random\s*\(/,
  /\bDate\.now\s*\(/,
  /\bsetTimeout\s*\(/,
  /\bdocument\./,
  /\bwindow\./,
  /\bimport\s*\(/,
  /\brequire\s*\(/,
  /\bperformance\.now\s*\(/,
  /\bnew Date\s*\(/,
  /\bsetInterval\s*\(/,
  /\bprocess\./,
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return []
    return [full]
  })
}

const BROKERS_DIR = join(process.cwd(), 'src/brokers')
const KERNEL_DIR = join(process.cwd(), 'src/shell/kernel')

/** Every `src/brokers/<id>/` directory. `catalog.ts`, `registry.ts` and `types.ts` are files. */
function brokerDirs(): string[] {
  return readdirSync(BROKERS_DIR).filter((name) => statSync(join(BROKERS_DIR, name)).isDirectory())
}

/**
 * Where a broker keeps its engine, or undefined if it has none discoverable.
 *
 * Both shapes count. The README tells a broker author to create `engine/`, but a smaller
 * engine is naturally written as a single `engine.ts`, and an author who does that must not
 * silently get zero purity coverage — determinism is the product's core contract, so an
 * unchecked engine is the one failure mode this file exists to prevent.
 */
function engineTarget(broker: string): string | undefined {
  const base = join(BROKERS_DIR, broker, 'engine')
  if (existsSync(base) && statSync(base).isDirectory()) return base
  for (const ext of ['.ts', '.tsx']) {
    if (existsSync(base + ext)) return base + ext
  }
  return undefined
}

/** The kernel's files plus every broker engine's files, discovered rather than listed. */
function pureFiles(): string[] {
  const files = sourceFiles(KERNEL_DIR)
  for (const broker of brokerDirs()) {
    const target = engineTarget(broker)
    if (target === undefined) continue
    files.push(...(statSync(target).isDirectory() ? sourceFiles(target) : [target]))
  }
  return files
}

describe('engine purity', () => {
  it('covers the kernel and every broker engine', () => {
    // Discovery failing open is the hazard: an empty broker list, or a kernel path that no
    // longer resolves, would make the scan below pass vacuously. Assert on real files.
    expect(brokerDirs().length).toBeGreaterThan(0)
    const files = pureFiles()
    expect(files).toContain(join(KERNEL_DIR, 'run.ts'))
    expect(files.some((f) => f.includes(join('rabbitmq', 'engine')))).toBe(true)
  })

  it('finds an engine for every broker, so none is silently skipped', () => {
    // A broker whose engine is neither `engine/` nor `engine.ts` used to be dropped from the
    // scan without a word. Silence is the bug: fail loudly and name the broker instead.
    for (const broker of brokerDirs()) {
      expect(
        engineTarget(broker),
        `broker "${broker}" has neither an engine/ directory nor an engine.ts file, so nothing `
          + 'of it is purity-checked. Move its reducer under one of those two names.',
      ).toBeDefined()
    }
  })

  it('imports no UI library and uses no ambient time or randomness', () => {
    const offences: string[] = []
    for (const file of pureFiles()) {
      const text = readFileSync(file, 'utf8')
      for (const pattern of FORBIDDEN) {
        if (pattern.test(text)) offences.push(`${file} matched ${pattern}`)
      }
    }
    expect(offences).toEqual([])
  })
})
