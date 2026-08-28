import type { LessonGroupSpec } from '../../../shell/lesson/types'
import type { KafkaLesson } from './types'
import { topicPartition } from './01-topic-partition'

export const KAFKA_LESSON_GROUPS: LessonGroupSpec[] = [
  { id: 'basics', label: 'Cơ bản' },
  { id: 'producer', label: 'Producer' },
  { id: 'consumer', label: 'Consumer & Group' },
  { id: 'durability', label: 'Độ bền' },
  { id: 'advanced', label: 'Nâng cao' },
]

/** Thứ tự sidebar cũng là thứ tự dạy: mỗi bài giả định các bài phía trên nó. */
export const LESSONS: KafkaLesson[] = [topicPartition]
