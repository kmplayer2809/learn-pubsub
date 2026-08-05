import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ENGINE_DIR = join(process.cwd(), 'src/engine')
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

describe('engine purity', () => {
  it('imports no UI library and uses no ambient time or randomness', () => {
    const offences: string[] = []
    for (const file of sourceFiles(ENGINE_DIR)) {
      const text = readFileSync(file, 'utf8')
      for (const pattern of FORBIDDEN) {
        if (pattern.test(text)) offences.push(`${file} matched ${pattern}`)
      }
    }
    expect(offences).toEqual([])
  })
})
