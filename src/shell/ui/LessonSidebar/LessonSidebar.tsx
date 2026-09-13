import { useState } from 'react'
import { getBroker } from '../../../brokers/registry'
import { lessonKey } from '../../quiz/progress'
import { useAppStore } from '../../store'
import { BrokerSwitcher } from '../BrokerSwitcher/BrokerSwitcher'
import { LayoutGridIcon } from '../icons'
import { ExamDialog } from '../Quiz/ExamDialog'

export function LessonSidebar({
  hideBrokerSwitcher = false,
}: {
  /**
   * Mobile và tablet đã có `BrokerSwitcher` riêng ở `TopBar` — `LessonSidebar` của
   * chúng (pane `lessons` trên mobile, drawer trên tablet) phải tắt bản của mình đi,
   * nếu không màn hình có hai broker picker sống cùng lúc (mobile: cả hai luôn hiện
   * chung một lượt; tablet: cả hai cùng hiện khi mở drawer ở 820px). Desktop không
   * có `TopBar`, nên không truyền prop này — mặc định `false` giữ nguyên y hệt bản
   * cũ, không đổi một pixel nào.
   */
  hideBrokerSwitcher?: boolean
} = {}) {
  const brokerId = useAppStore((s) => s.brokerId)
  const broker = getBroker(brokerId)
  const lessonId = useAppStore((s) => s.lessonId)
  const sandbox = useAppStore((s) => s.sandbox)
  const setLesson = useAppStore((s) => s.setLesson)
  const openSandbox = useAppStore((s) => s.openSandbox)
  const progress = useAppStore((s) => s.progress)
  const recordExam = useAppStore((s) => s.recordExam)
  const [examOpen, setExamOpen] = useState(false)

  return (
    <nav className="flex h-full flex-col overflow-y-auto bg-surface" data-testid="lesson-sidebar">
      {!hideBrokerSwitcher && (
        <div className="border-b border-edge p-2">
          <BrokerSwitcher />
        </div>
      )}
      <div className="flex-1 py-2">
        {broker.lessonGroups.map((group) => (
          <div key={group.id} className="mb-2">
            {/* `sticky`: 17-25 lesson cuộn dài, group header trôi mất là mất ngữ cảnh
                đang ở nhóm nào. */}
            <div className="sticky top-0 z-10 bg-surface/95 px-3 pb-1 pt-2 text-section font-semibold uppercase text-content-faint backdrop-blur">
              {group.label}
            </div>
            {broker.lessons.filter((l) => l.group === group.id).map((lesson) => {
              const active = !sandbox && lesson.id === lessonId
              // Số đếm theo vị trí trong `broker.lessons` chứ không reset theo nhóm:
              // người học nói "bài 12", không nói "bài 3 của nhóm reliability".
              // Suy ra từ mảng, không phải field mới trong `Lesson` — không đụng contract.
              const ordinal = String(broker.lessons.indexOf(lesson) + 1).padStart(2, '0')
              const score = progress.lessons[lessonKey(brokerId, lesson.id)]
              return (
                <button
                  key={lesson.id}
                  onClick={() => setLesson(lesson.id)}
                  className={`mx-2 flex min-h-11 w-[calc(100%-1rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui md:min-h-0 ${
                    active
                      ? 'bg-accent-soft font-medium text-accent'
                      : 'text-content-muted hover:bg-surface-hover hover:text-content'
                  }`}
                >
                  <span className="w-6 shrink-0 font-mono text-meta text-content-faint">{ordinal}</span>
                  <span className="min-w-0 flex-1 leading-snug">{lesson.title}</span>
                  {score && (
                    <span
                      data-testid={`lesson-score-${lesson.id}`}
                      className={`shrink-0 font-mono text-meta ${
                        score.best === score.total ? 'text-ok-fg' : 'text-content-faint'
                      }`}
                    >
                      {score.best === score.total ? '✓' : `${score.best}/${score.total}`}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <button
        onClick={() => setExamOpen(true)}
        data-testid="open-exam"
        className="flex min-h-11 shrink-0 items-center gap-2 border-t border-edge px-3 py-2 text-left text-ui font-medium text-content-muted hover:bg-surface-hover hover:text-content md:min-h-0"
      >
        Thi tổng kết
      </button>

      {broker.sandbox && (
        <button
          onClick={openSandbox}
          className={`flex min-h-11 shrink-0 items-center gap-2 border-t border-edge px-3 py-2 text-left text-ui font-medium md:min-h-0 ${
            sandbox ? 'bg-accent-soft text-accent' : 'text-content-muted hover:bg-surface-hover hover:text-content'
          }`}
          data-testid="open-sandbox"
        >
          <LayoutGridIcon className="h-4 w-4" />
          Sandbox
        </button>
      )}

      {examOpen && (
        <ExamDialog
          // Keyed by broker: switching broker with the dialog open must redraw the exam
          // from the new broker's bank rather than keep the old one's questions.
          key={brokerId}
          brokerLabel={broker.label}
          lessons={broker.lessons}
          onSubmit={recordExam}
          onJumpToLesson={setLesson}
          onClose={() => setExamOpen(false)}
        />
      )}
    </nav>
  )
}
