import type { LessonGroupSpec } from '../../../shell/lesson/types'
import type { KafkaLesson } from './types'
import { topicPartition } from './01-topic-partition'
import { brokerCluster } from './02-broker-cluster'
import { keyPartitioning } from './03-key-partitioning'
import { produceConsume } from './04-produce-consume'
import { offsets } from './05-offsets'

export const KAFKA_LESSON_GROUPS: LessonGroupSpec[] = [
  { id: 'basics', label: 'Cơ bản' },
  { id: 'producer', label: 'Producer' },
  { id: 'consumer', label: 'Consumer & Group' },
  { id: 'durability', label: 'Độ bền' },
  { id: 'advanced', label: 'Nâng cao' },
]

/** Thứ tự sidebar cũng là thứ tự dạy: mỗi bài giả định các bài phía trên nó. */
export const LESSONS: KafkaLesson[] = [topicPartition, brokerCluster, keyPartitioning, produceConsume, offsets]
