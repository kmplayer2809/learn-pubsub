/**
 * Kiểm tương phản mọi cặp chữ/nền ở cả hai theme. Chạy tay:
 *   node scripts/contrast-audit.mjs
 *
 * Không phải test tự động vì nó đọc bảng giá trị chép tay dưới đây chứ không parse
 * CSS — một test đọc chính giá trị mình khẳng định thì không kiểm được gì. Đây là
 * công cụ dùng khi đổi token, và bằng chứng đính kèm khi review.
 */

const THEMES = {
  light: {
    canvas: [226, 232, 240],
    surface: [255, 255, 255],
    'surface-raised': [248, 250, 252],
    'surface-hover': [241, 245, 249],
    'text-strong': [15, 23, 42],
    'text-body': [51, 65, 85],
    'text-muted': [71, 85, 105],
    'text-faint': [71, 85, 105],
    accent: [3, 105, 161],
    'accent-soft': [224, 242, 254],
    'accent-fg': [255, 255, 255],
    'ok-bg': [236, 253, 245],
    'ok-fg': [6, 95, 70],
    'danger-bg': [255, 241, 242],
    'danger-fg': [159, 18, 57],
    'warn-bg': [255, 251, 235],
    'warn-fg': [146, 64, 14],
  },
  dark: {
    canvas: [2, 6, 23],
    surface: [11, 18, 32],
    'surface-raised': [19, 28, 46],
    'surface-hover': [30, 41, 59],
    'text-strong': [241, 245, 249],
    'text-body': [203, 213, 225],
    'text-muted': [148, 163, 184],
    'text-faint': [148, 163, 184],
    accent: [56, 189, 248],
    'accent-soft': [8, 47, 73],
    'accent-fg': [2, 6, 23],
    'ok-bg': [2, 44, 34],
    'ok-fg': [167, 243, 208],
    'danger-bg': [76, 5, 25],
    'danger-fg': [254, 205, 211],
    'warn-bg': [69, 26, 3],
    'warn-fg': [253, 230, 138],
  },
}

const SURFACES = ['canvas', 'surface', 'surface-raised', 'surface-hover']
const FOREGROUNDS = ['text-strong', 'text-body', 'text-muted', 'text-faint', 'accent']
const STATUS = [
  ['ok-fg', 'ok-bg'],
  ['danger-fg', 'danger-bg'],
  ['warn-fg', 'warn-bg'],
  ['accent', 'accent-soft'],
  ['accent-fg', 'accent'],
]

function luminance([r, g, b]) {
  const channel = (v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

let failures = 0
for (const [name, tokens] of Object.entries(THEMES)) {
  console.log(`\n=== ${name} ===`)
  const pairs = [
    ...FOREGROUNDS.flatMap((fg) => SURFACES.map((bg) => [fg, bg])),
    ...STATUS,
  ]
  for (const [fg, bg] of pairs) {
    const value = ratio(tokens[fg], tokens[bg])
    const pass = value >= 4.5
    if (!pass) failures++
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${value.toFixed(2).padStart(6)}  ${fg} trên ${bg}`)
  }
}

console.log(`\n${failures} cặp không đạt 4.5:1`)
process.exit(failures > 0 ? 1 : 0)
