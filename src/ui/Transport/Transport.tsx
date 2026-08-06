import { SPEEDS, useAppStore, type Speed } from '../../sim/store'

export function Transport({ durationMs, onStep }: { durationMs: number; onStep(): void }) {
  const playing = useAppStore((s) => s.playing)
  const speed = useAppStore((s) => s.speed)
  const virtualTime = useAppStore((s) => s.virtualTime)
  const play = useAppStore((s) => s.play)
  const pause = useAppStore((s) => s.pause)
  const seek = useAppStore((s) => s.seek)
  const setSpeed = useAppStore((s) => s.setSpeed)

  const max = durationMs + 5000

  return (
    <div className="flex items-center gap-3 px-3 py-2" data-testid="transport">
      <button onClick={() => seek(0)} className="rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">
        Restart
      </button>
      <button
        onClick={() => (playing ? pause() : play())}
        className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500"
        data-testid="play-pause"
      >
        {playing ? 'Pause' : 'Play'}
      </button>
      <button
        onClick={() => {
          pause()
          onStep()
        }}
        className="rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
      >
        Step
      </button>

      <input
        type="range"
        min={0}
        max={max}
        step={50}
        value={Math.min(virtualTime, max)}
        onChange={(e) => seek(Number(e.target.value))}
        className="flex-1 accent-sky-500"
        aria-label="scrub"
      />
      <span className="w-16 text-right font-mono text-[11px] text-slate-400">
        {(virtualTime / 1000).toFixed(1)}s
      </span>

      <select
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value) as Speed)}
        className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200"
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
