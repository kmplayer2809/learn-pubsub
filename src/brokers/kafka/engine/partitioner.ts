import { murmur2, toPositive } from './murmur2'
import { nextInt, type RngState } from '../../../shell/kernel/rng'

export interface PickPartitionArgs {
  key: string | null
  partitionCount: number
  partitioner: 'default' | 'round-robin' | 'sticky'
  roundRobinCounter: number
  stickyPartition?: number
  rng: RngState
}

export interface PickPartitionResult {
  partition: number
  nextRoundRobinCounter: number
  nextSticky: number
  rng: RngState
}

export function pickPartition(args: PickPartitionArgs): PickPartitionResult {
  const { key, partitionCount, partitioner, roundRobinCounter, stickyPartition, rng } = args

  // Key có giá trị thì mọi partitioner đều hash — đó là bảo đảm thứ tự của Kafka:
  // cùng key về cùng partition, và trong một partition thứ tự là tuyệt đối.
  // Partitioner chỉ quyết định số phận của record **không có key**.
  if (key !== null) {
    return {
      partition: toPositive(murmur2(key)) % partitionCount,
      nextRoundRobinCounter: roundRobinCounter,
      nextSticky: stickyPartition ?? 0,
      rng,
    }
  }

  if (partitioner === 'round-robin') {
    return {
      partition: roundRobinCounter % partitionCount,
      nextRoundRobinCounter: roundRobinCounter + 1,
      nextSticky: stickyPartition ?? 0,
      rng,
    }
  }

  if (partitioner === 'sticky' && stickyPartition !== undefined) {
    return { partition: stickyPartition, nextRoundRobinCounter: roundRobinCounter, nextSticky: stickyPartition, rng }
  }

  // Chưa có sticky partition nào (batch đầu, hoặc batch trước vừa đóng): chọn
  // một partition qua RNG thuần của kernel. `nextInt` trả `[value, nextState]`,
  // không giữ state ẩn — đó là điều kiện để cùng seed luôn cho cùng journal.
  const [picked, nextRng] = nextInt(rng, partitionCount)
  return { partition: picked, nextRoundRobinCounter: roundRobinCounter, nextSticky: picked, rng: nextRng }
}
