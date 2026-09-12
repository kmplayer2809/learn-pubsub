/**
 * Thanh tua. `<input type="range">` trơn của trình duyệt không có hai thứ mà một
 * thanh tua mô phỏng cần: track tô phần đã chạy, và mốc cho biết ở đâu có sự kiện.
 * Cả hai vẽ bằng lớp phủ phía sau input thật — input vẫn là thứ nhận chuột, bàn
 * phím và screen reader, nên không mất khả năng truy cập nào.
 */
export function ScrubTrack({
  value,
  max,
  marks,
  onSeek,
  className = '',
}: {
  value: number
  max: number
  /** Mốc thời gian ảo có sự kiện, đơn vị ms. Trùng nhau và ngoài khoảng đều bị lọc. */
  marks: number[]
  onSeek(virtualMs: number): void
  className?: string
}) {
  // `max <= 0` xảy ra ở lesson chưa có `durationMs` hợp lệ; chia cho 0 sẽ đẻ ra
  // `Infinity%` và React Flow… không, đơn giản là vạch bay ra ngoài màn hình.
  const percents =
    max > 0
      ? [...new Set(marks.filter((at) => at >= 0 && at <= max).map((at) => (at / max) * 100))]
      : []
  const progress = max > 0 ? (Math.min(value, max) / max) * 100 : 0

  return (
    <div className={`relative flex min-w-0 items-center ${className}`}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2">
        <div className="h-full rounded-full bg-surface-raised" />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent"
          style={{ width: `${progress}%` }}
        />
        {percents.map((percent) => (
          <span
            key={percent}
            data-testid="scrub-mark"
            className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-content-faint"
            style={{ left: `${percent}%` }}
          />
        ))}
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={50}
        value={Math.min(value, max)}
        onChange={(e) => onSeek(Number(e.target.value))}
        // Nền trong suốt: track thật đã vẽ ở lớp phủ bên trên.
        className="relative w-full bg-transparent"
        aria-label="scrub"
      />
    </div>
  )
}
