import type { ValidationIssue } from '../../engine'

/**
 * Vietnamese rendering for every `ValidationIssue` shape the engine can
 * produce. The engine's own `message` stays English (see the comment on
 * `ValidationIssueBase` in `src/engine/validate.ts`) because `src/engine/**`
 * is not a presentation layer — this is the presentation layer, and it's
 * the only place a learner actually reads these sentences.
 *
 * RabbitMQ/programming nouns stay English and uninflected-by-suffix (queue,
 * exchange, binding, routing key, publisher, consumer, dead-letter, TTL);
 * everything else is Vietnamese. Node ids and labels are never translated.
 *
 * This is a `switch` over `ValidationIssue['code']` with no `default` case,
 * so adding a new issue code to `validate.ts` without adding a case here is
 * a TypeScript error, not a silent English fallback in the UI.
 */
export function vietnameseIssueMessage(issue: ValidationIssue): string {
  switch (issue.code) {
    case 'binding-missing-exchange':
      return `binding ${issue.bindingId} bắt đầu từ exchange ${issue.exchangeId}, nhưng exchange đó không tồn tại`
    case 'binding-missing-destination':
      return `binding ${issue.bindingId} trỏ tới ${issue.destinationId}, nhưng node đó không tồn tại`
    case 'dead-letter-exchange-missing':
      return `queue ${issue.queueLabel} dead-letter sang ${issue.deadLetterExchange}, nhưng exchange đó không tồn tại`
    case 'zero-ttl-dead-letter-cycle':
      return `queue ${issue.queueLabel} tạo thành một vòng lặp dead-letter với TTL bằng 0, khiến mô phỏng không bao giờ tiến được`
    case 'queue-unreachable':
      return `queue ${issue.queueLabel} chưa có binding nào, nên không message nào tới được`
    case 'consumer-missing-queue':
      return `consumer ${issue.consumerLabel} tiêu thụ từ ${issue.queueId}, nhưng queue đó không tồn tại`
  }
}

const SEVERITY_LABEL: Record<ValidationIssue['severity'], string> = {
  error: 'lỗi',
  warning: 'cảnh báo',
}

export function vietnameseSeverityLabel(severity: ValidationIssue['severity']): string {
  return SEVERITY_LABEL[severity]
}
