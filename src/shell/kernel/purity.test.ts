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

/** The kernel plus every broker's engine directory, discovered rather than listed. */
function pureDirs(): string[] {
  const brokersDir = join(process.cwd(), 'src/brokers')
  const engines = readdirSync(brokersDir)
    .map((broker) => join(brokersDir, broker, 'engine'))
    .filter((dir) => existsSync(dir) && statSync(dir).isDirectory())
  return [join(process.cwd(), 'src/shell/kernel'), ...engines]
}

describe('engine purity', () => {
  it('covers the kernel and every broker engine', () => {
    const dirs = pureDirs()
    expect(dirs.some((d) => d.endsWith('src/shell/kernel'))).toBe(true)
    expect(dirs.some((d) => d.endsWith('rabbitmq/engine'))).toBe(true)
  })

  it('imports no UI library and uses no ambient time or randomness', () => {
    const offences: string[] = []
    for (const dir of pureDirs()) {
      for (const file of sourceFiles(dir)) {
        const text = readFileSync(file, 'utf8')
        for (const pattern of FORBIDDEN) {
          if (pattern.test(text)) offences.push(`${file} matched ${pattern}`)
        }
      }
    }
    expect(offences).toEqual([])
  })
})
