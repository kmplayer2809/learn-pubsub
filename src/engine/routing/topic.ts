/**
 * RabbitMQ topic semantics: words are dot-separated, `*` matches exactly one
 * word, `#` matches zero or more words.
 */
export function matchTopic(pattern: string, routingKey: string): boolean {
  const p = pattern.split('.')
  const k = routingKey === '' ? [] : routingKey.split('.')

  // table[i][j] is true when the first i pattern words match the first j key words
  const table: boolean[][] = Array.from({ length: p.length + 1 }, () =>
    new Array<boolean>(k.length + 1).fill(false),
  )
  table[0]![0] = true

  for (let i = 1; i <= p.length; i++) {
    if (p[i - 1] === '#') table[i]![0] = table[i - 1]![0]!
  }

  for (let i = 1; i <= p.length; i++) {
    for (let j = 1; j <= k.length; j++) {
      const word = p[i - 1]!
      if (word === '#') {
        table[i]![j] = table[i - 1]![j]! || table[i]![j - 1]!
      } else if (word === '*' || word === k[j - 1]) {
        table[i]![j] = table[i - 1]![j - 1]!
      }
    }
  }

  return table[p.length]![k.length]!
}
