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
  // `undefined` nghĩa là "chưa có sticky partition nào được chọn" — khác với `0`,
  // vốn là một partition thật. Gộp hai trạng thái đó lại (`?? 0`) khiến nhánh chưa
  // hề pick nào giả vờ đã pick partition 0, và nếu caller thread giá trị đó vào
  // lần gọi tiếp theo thì producer 'sticky' dính cứng vào partition 0 mà chưa từng
  // gọi `nextInt` — đúng cái hot-partition giả mà lesson 08 dạy phải tránh.
  nextSticky: number | undefined
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
      // Record có key không thiết lập stickiness — giữ nguyên trạng thái sticky
      // hiện có (kể cả khi đó là "chưa chọn", tức `undefined`) thay vì đoán ra 0.
      nextSticky: stickyPartition,
      rng,
    }
  }

  if (partitioner === 'round-robin') {
    return {
      partition: roundRobinCounter % partitionCount,
      nextRoundRobinCounter: roundRobinCounter + 1,
      // round-robin cũng không dùng khái niệm sticky — không được phép biến
      // "chưa chọn" thành partition 0 chỉ vì nhánh này không đọc `stickyPartition`.
      nextSticky: stickyPartition,
      rng,
    }
  }

  // 'default' và 'sticky' dùng chung nhánh này: Kafka thật, từ 2.4 (KIP-480),
  // đã thay UniformStickyPartitioner cho hành vi round-robin cũ của
  // DefaultPartitioner khi key null — tức "mặc định" NGÀY NAY vốn dĩ chính là
  // sticky, không phải một chế độ thứ ba khác biệt. Tách hai tên này ra hai
  // nhánh sẽ khiến 'default' rút một partition RNG mới ở MỌI record null-key
  // thay vì bám nguyên một partition cho tới khi batch đóng — sai lệch spec
  // §B5.1 mà không có lesson nào bắt được vì lesson 01 dùng `lingerMs: 0`.
  if ((partitioner === 'default' || partitioner === 'sticky') && stickyPartition !== undefined) {
    return { partition: stickyPartition, nextRoundRobinCounter: roundRobinCounter, nextSticky: stickyPartition, rng }
  }

  // Chưa có sticky partition nào (batch đầu, hoặc batch trước vừa đóng): chọn
  // một partition qua RNG thuần của kernel. `nextInt` trả `[value, nextState]`,
  // không giữ state ẩn — đó là điều kiện để cùng seed luôn cho cùng journal.
  const [picked, nextRng] = nextInt(rng, partitionCount)
  return { partition: picked, nextRoundRobinCounter: roundRobinCounter, nextSticky: picked, rng: nextRng }
}
