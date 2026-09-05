import { SPEEDS, useAppStore, type Speed } from '../../store'
import { PauseIcon, PlayIcon, ReplayIcon, StepForwardIcon } from '../icons'

export function Transport({
  durationMs,
  onStep,
  compact = false,
}: {
  durationMs: number
  onStep(): void
  /** Bật ở mobile: nút thu về icon, tap target nâng lên 44px. Prop chứ không phải
   *  `useIsMobile()` bên trong — giữ component thuần và test được cả hai chế độ
   *  mà không phải giả lập viewport. */
  compact?: boolean
}) {
  const playing = useAppStore((s) => s.playing)
  const speed = useAppStore((s) => s.speed)
  const virtualTime = useAppStore((s) => s.virtualTime)
  const play = useAppStore((s) => s.play)
  const pause = useAppStore((s) => s.pause)
  const seek = useAppStore((s) => s.seek)
  const setSpeed = useAppStore((s) => s.setSpeed)

  const max = durationMs + 5000
  const tap = compact ? 'min-h-11 min-w-11' : ''

  return (
    <div
      className={`flex shrink-0 items-center border-t border-ink-800/80 bg-ink-950/95 px-3 py-2 ${compact ? 'gap-2' : 'gap-3'}`}
      data-testid="transport"
    >
      <button
        onClick={() => seek(0)}
        aria-label="Chạy lại"
        className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-ink-300 hover:bg-ink-800 active:bg-ink-700 ${tap}`}
      >
        {compact ? <ReplayIcon /> : <><ReplayIcon className="h-4 w-4" /> Chạy lại</>}
      </button>
      <button
        onClick={() => (playing ? pause() : play())}
        className={`flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm shadow-accent-950/50 hover:bg-accent-500 active:bg-accent-600 ${tap}`}
        data-testid="play-pause"
      >
        {playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
        {!compact && (playing ? 'Tạm dừng' : 'Chạy')}
      </button>
      <button
        onClick={() => {
          pause()
          onStep()
        }}
        aria-label="Bước"
        className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-ink-300 hover:bg-ink-800 active:bg-ink-700 ${tap}`}
      >
        {compact ? <StepForwardIcon /> : <><StepForwardIcon className="h-4 w-4" /> Bước</>}
      </button>

      <input
        type="range"
        min={0}
        max={max}
        step={50}
        value={Math.min(virtualTime, max)}
        onChange={(e) => seek(Number(e.target.value))}
        className={`${compact ? 'min-w-0 ' : ''}flex-1`}
        aria-label="scrub"
      />
      <span
        className={`${compact ? 'w-11' : 'w-16'} text-right font-mono text-[11px] text-ink-400${compact ? ' shrink-0' : ''}`}
      >
        {(virtualTime / 1000).toFixed(1)}s
      </span>

      <select
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value) as Speed)}
        className={`rounded-lg bg-ink-800 px-2 py-1.5 text-xs text-ink-200 hover:bg-ink-700${compact ? ' shrink-0 min-h-11' : ''}`}
        aria-label="speed"
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}x
          </option>
        ))}
      </select>
    </div>
  )
}
