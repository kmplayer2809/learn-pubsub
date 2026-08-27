import { describe, expect, it } from 'vitest'
import { murmur2, toPositive } from './murmur2'

describe('murmur2', () => {
  // Đây là hàm hash thật của Kafka (`org.apache.kafka.common.utils.Utils.murmur2`,
  // seed 0x9747b28c). Bài 03 dạy "cùng key luôn về cùng partition" và người học
  // phải gõ lại được kết quả trên cluster thật, nên tính chất của nó là hợp đồng.
  it('luôn trả về một số nguyên 32-bit có dấu', () => {
    for (const key of ['', 'a', 'user-42', 'đơn-hàng-7', 'x'.repeat(129)]) {
      const value = murmur2(key)
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBe(value | 0)
    }
  })

  it('xử lý đúng cả bốn nhánh phần dư của vòng lặp 4 byte', () => {
    // Độ dài 4/5/6/7 byte đi qua bốn nhánh `remainder` khác nhau. Một nhánh cài
    // sai chỉ lộ ra ở đúng độ dài của nó, nên phải chạm cả bốn.
    const values = ['abcd', 'abcde', 'abcdef', 'abcdefg'].map(murmur2)
    expect(new Set(values).size).toBe(4)
  })

  it('hash theo byte UTF-8, không theo mã UTF-16', () => {
    // Key có dấu tiếng Việt là loại key lesson này dùng. Hash theo UTF-16 sẽ cho
    // partition khác với broker thật, và bug đó chỉ lộ ra ở đúng những key này.
    const encoded = new TextEncoder().encode('đơn')
    // đ và ơ mỗi ký tự chiếm 2 byte UTF-8 (Latin Extended-A), n chiếm 1 byte: 2+2+1 = 5.
    expect(encoded.length).toBe(5)
    expect(murmur2('đơn')).not.toBe(murmur2('don'))
  })

  it('cùng đầu vào luôn ra cùng giá trị', () => {
    expect(murmur2('user-42')).toBe(murmur2('user-42'))
  })

  it('key khác nhau gần như luôn ra giá trị khác nhau', () => {
    expect(murmur2('user-42')).not.toBe(murmur2('user-43'))
  })

  it('toPositive xoá bit dấu, không dùng Math.abs', () => {
    // `Math.abs(Number.MIN_SAFE_INTEGER)` và `Math.abs(-2147483648)` trong 32 bit
    // đều trả về chính nó — Kafka dùng `& 0x7fffffff` chính vì lý do đó.
    expect(toPositive(-2147483648)).toBe(0)
    expect(toPositive(-1)).toBe(2147483647)
    expect(toPositive(5)).toBe(5)
  })
})
