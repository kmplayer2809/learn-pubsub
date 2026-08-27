/**
 * Bản port của `org.apache.kafka.common.utils.Utils.murmur2` — chính hàm mà
 * `DefaultPartitioner` của Kafka dùng để ánh xạ key sang partition. Cài đúng bản
 * này chứ không phải một hash bất kỳ là điều kiện để lesson 03 và 08 dạy được:
 * người học phải chạy lại được kết quả trên cluster thật.
 */
const SEED = 0x9747b28c
const M = 0x5bd1e995
const R = 24

/** Nhân hai số 32-bit mà không rơi khỏi khoảng chính xác của double. */
function multiply(a: number, b: number): number {
  return Math.imul(a, b) | 0
}

export function murmur2(data: string): number {
  // Kafka hash **byte** của key. Chuỗi ở đây là UTF-8 khi ra ngoài dây, nên phải
  // encode trước — hash theo mã UTF-16 sẽ lệch với broker thật ở mọi key có dấu
  // tiếng Việt, đúng loại key lesson này dùng.
  const bytes = new TextEncoder().encode(data)
  const length = bytes.length
  let h = (SEED ^ length) | 0
  const remainder = length & 3
  const aligned = length - remainder

  for (let i = 0; i < aligned; i += 4) {
    let k =
      (bytes[i]! & 0xff) |
      ((bytes[i + 1]! & 0xff) << 8) |
      ((bytes[i + 2]! & 0xff) << 16) |
      ((bytes[i + 3]! & 0xff) << 24)
    k = multiply(k, M)
    k ^= k >>> R
    k = multiply(k, M)
    h = multiply(h, M)
    h = (h ^ k) | 0
  }

  if (remainder === 3) h = (h ^ ((bytes[aligned + 2]! & 0xff) << 16)) | 0
  if (remainder >= 2) h = (h ^ ((bytes[aligned + 1]! & 0xff) << 8)) | 0
  if (remainder >= 1) {
    h = (h ^ (bytes[aligned]! & 0xff)) | 0
    h = multiply(h, M)
  }

  h ^= h >>> 13
  h = multiply(h, M)
  h ^= h >>> 15
  return h | 0
}

/**
 * Kafka dùng `& 0x7fffffff` chứ không phải `Math.abs`: với số 32-bit,
 * `Math.abs(-2147483648)` tràn về chính nó và cho ra partition âm.
 */
export function toPositive(value: number): number {
  return value & 0x7fffffff
}
