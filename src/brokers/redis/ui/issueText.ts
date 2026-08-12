import type { RedisValidationIssue } from '../engine'

/**
 * Vietnamese rendering for every `RedisValidationIssue` the engine can produce. The
 * engine's own `message` stays English — `src/brokers/redis/engine/**` is not a
 * presentation layer — so this is the only place a learner actually reads these
 * sentences, mirroring RabbitMQ's `vietnameseIssueMessage`
 * (`src/brokers/rabbitmq/ui/issueText.ts`).
 *
 * Redis terms of art stay English (client, command, maxmemory, noeviction);
 * everything else is Vietnamese. Node ids are never translated.
 *
 * `RedisValidationIssue` carries no per-code payload beyond `nodeId` (unlike
 * RabbitMQ's tagged-union issue shapes), so a node id is the only variable this
 * function has to work with — the rest of each sentence is fixed prose describing
 * what that code always means.
 *
 * This is a `switch` over `RedisValidationIssue['code']` with no `default` case, so
 * adding a new code to `validate.ts` without adding a case here is a TypeScript
 * error, not a silent English fallback in the UI.
 */
export function issueText(issue: RedisValidationIssue): string {
  switch (issue.code) {
    case 'client-missing':
      return `một command nhắm tới client ${issue.nodeId}, nhưng client đó không tồn tại trong topology`
    case 'unknown-command':
      return `client ${issue.nodeId} gửi một command mà engine này không hiểu`
    case 'no-clients':
      return 'topology chưa có client nào, nên không command nào có thể chạy'
    case 'maxmemory-noeviction':
      return `${issue.nodeId} đặt maxmemory với policy noeviction, nên lệnh ghi sẽ bắt đầu thất bại khi bộ nhớ đầy`
  }
}
