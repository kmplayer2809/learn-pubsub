/** @type {import('tailwindcss').Config} */

// `line` và `ring` của mỗi role giữ đúng một giá trị ở cả hai theme, nên viết hex
// thẳng ở đây thay vì tạo thêm 22 CSS var không bao giờ đổi. Var chỉ tồn tại cho
// thứ thực sự đổi theo theme.
const ROLE_LINE_RING = {
  sky: ['#0ea5e9', '#38bdf8'],
  violet: ['#8b5cf6', '#a78bfa'],
  emerald: ['#10b981', '#34d399'],
  amber: ['#f59e0b', '#fbbf24'],
  cyan: ['#06b6d4', '#22d3ee'],
  rose: ['#f43f5e', '#fb7185'],
  blue: ['#3b82f6', '#60a5fa'],
  teal: ['#14b8a6', '#2dd4bf'],
  orange: ['#f97316', '#fb923c'],
  pink: ['#ec4899', '#f472b6'],
  lime: ['#84cc16', '#a3e635'],
}

const role = Object.fromEntries(
  Object.entries(ROLE_LINE_RING).map(([hue, [line, ring]]) => [
    hue,
    {
      DEFAULT: `rgb(var(--role-${hue}-bg) / <alpha-value>)`,
      fg: `rgb(var(--role-${hue}-fg) / <alpha-value>)`,
      line,
      ring,
    },
  ]),
)

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          raised: 'rgb(var(--surface-raised) / <alpha-value>)',
          hover: 'rgb(var(--surface-hover) / <alpha-value>)',
        },
        edge: {
          DEFAULT: 'rgb(var(--border-subtle) / <alpha-value>)',
          strong: 'rgb(var(--border-strong) / <alpha-value>)',
        },
        content: {
          DEFAULT: 'rgb(var(--text-body) / <alpha-value>)',
          strong: 'rgb(var(--text-strong) / <alpha-value>)',
          muted: 'rgb(var(--text-muted) / <alpha-value>)',
          faint: 'rgb(var(--text-faint) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover) / <alpha-value>)',
          fg: 'rgb(var(--accent-fg) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft) / <alpha-value>)',
        },
        highlight: 'rgb(var(--highlight) / <alpha-value>)',
        ok: {
          bg: 'rgb(var(--ok-bg) / <alpha-value>)',
          fg: 'rgb(var(--ok-fg) / <alpha-value>)',
          line: '#059669',
        },
        danger: {
          bg: 'rgb(var(--danger-bg) / <alpha-value>)',
          fg: 'rgb(var(--danger-fg) / <alpha-value>)',
          line: '#e11d48',
        },
        warn: {
          bg: 'rgb(var(--warn-bg) / <alpha-value>)',
          fg: 'rgb(var(--warn-fg) / <alpha-value>)',
          line: '#d97706',
        },
        role,
      },
      fontSize: {
        narrative: ['15px', { lineHeight: '1.65' }],
        ui: ['13px', { lineHeight: '1.5' }],
        meta: ['11px', { lineHeight: '1.45' }],
        code: ['12px', { lineHeight: '1.5' }],
        section: ['10px', { lineHeight: '1', letterSpacing: '0.08em' }],
      },
      fontFamily: {
        sans: ['IBM Plex Sans Variable', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono Variable', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        node: 'var(--shadow-node)',
      },
    },
  },
  plugins: [],
}
