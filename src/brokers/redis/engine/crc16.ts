/**
 * CRC16/CCITT-FALSE (poly 0x1021, init 0) — the exact variant Redis Cluster
 * uses to compute a key's hash slot. `keySlot` also reproduces Cluster's hash
 * tag rule: if `key` contains a `{...}` with at least one character inside,
 * only the substring inside the braces is hashed, so app code can force
 * related keys onto the same slot (`{user1000}.following`, `{user1000}.followers`).
 */
const POLY = 0x1021

function buildTable(): number[] {
  const table: number[] = []
  for (let byte = 0; byte < 256; byte++) {
    let crc = byte << 8
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ POLY) & 0xffff : (crc << 1) & 0xffff
    }
    table.push(crc)
  }
  return table
}

const TABLE = buildTable()

export function crc16(data: string): number {
  let crc = 0
  for (let i = 0; i < data.length; i++) {
    const byte = data.charCodeAt(i) & 0xff
    crc = ((crc << 8) ^ TABLE[(crc >> 8) ^ byte]!) & 0xffff
  }
  return crc
}

const SLOT_COUNT = 16384

export function keySlot(key: string): number {
  const open = key.indexOf('{')
  const close = open === -1 ? -1 : key.indexOf('}', open + 1)
  const tagged = open !== -1 && close !== -1 && close > open + 1 ? key.slice(open + 1, close) : key
  return crc16(tagged) % SLOT_COUNT
}
