import { type FormEvent, useState } from 'react'
import type { KafkaState, KafkaValidationIssue } from '../engine'
import { EventLog, HaltedBanner, IssuesList, MetricsGrid } from '../../../shell/ui/Inspector/Inspector'
import { issueText } from '../ui/issueText'
import { ExportDialog } from './ExportDialog'
import { useKafkaSandbox } from './kafkaStore'

const BUTTON =
  'min-h-11 rounded border border-edge-strong px-2 py-1 text-meta text-content hover:bg-surface-hover md:min-h-0'
const DANGER_BUTTON =
  'min-h-11 rounded border border-danger-line px-2 py-1 text-meta text-danger-fg hover:bg-danger-bg md:min-h-0'
const fieldRow = 'flex items-center justify-between gap-2'
const inputClass = 'w-24 rounded bg-surface-hover px-1.5 py-0.5 text-content'

/** Spreads new nodes out in a simple grid so they don't all land on top of each other. */
function nextPosition(count: number): { x: number; y: number } {
  return { x: 80 + (count % 4) * 180, y: 60 + Math.floor(count / 4) * 140 }
}

function TopicsSection() {
  const topology = useKafkaSandbox((s) => s.topology)
  const addTopic = useKafkaSandbox((s) => s.addTopic)
  const setPartitionCount = useKafkaSandbox((s) => s.setPartitionCount)
  const setReplicationFactor = useKafkaSandbox((s) => s.setReplicationFactor)

  const [name, setName] = useState('')
  const [partitions, setPartitions] = useState(1)
  const [replicationFactor, setReplicationFactorInput] = useState(1)

  const handleAdd = () => {
    if (!name.trim()) return
    addTopic(name.trim(), partitions, replicationFactor)
    setName('')
  }

  return (
    <section>
      <h3 className="mb-1 text-section text-content-faint">Topic</h3>
      <div className="space-y-1.5">
        {topology.topics.map((topic) => (
          <div key={topic.name} className="flex items-center gap-1.5 text-meta" data-testid={`topic-${topic.name}`}>
            <span className="w-16 shrink-0 truncate text-content">{topic.name}</span>
            <label className="flex items-center gap-1 text-content-faint">
              partitions
              <input
                type="number"
                min={1}
                value={topic.partitions}
                onChange={(e) => setPartitionCount(topic.name, Number(e.target.value))}
                aria-label={`số partition của ${topic.name}`}
                className="w-14 rounded bg-surface-hover px-1 py-0.5 text-content"
              />
            </label>
            <label className="flex items-center gap-1 text-content-faint">
              rf
              <input
                type="number"
                min={1}
                value={topic.replicationFactor}
                onChange={(e) => setReplicationFactor(topic.name, Number(e.target.value))}
                aria-label={`replicationFactor của ${topic.name}`}
                className="w-14 rounded bg-surface-hover px-1 py-0.5 text-content"
              />
            </label>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-meta">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="tên topic"
          aria-label="tên topic"
          className={inputClass}
        />
        <label className="flex items-center gap-1 text-content-faint">
          partitions
          <input
            type="number"
            min={1}
            value={partitions}
            onChange={(e) => setPartitions(Number(e.target.value))}
            aria-label="số partition"
            className="w-14 rounded bg-surface-hover px-1 py-0.5 text-content"
          />
        </label>
        <label className="flex items-center gap-1 text-content-faint">
          rf
          <input
            type="number"
            min={1}
            value={replicationFactor}
            onChange={(e) => setReplicationFactorInput(Number(e.target.value))}
            aria-label="replicationFactor"
            className="w-14 rounded bg-surface-hover px-1 py-0.5 text-content"
          />
        </label>
        <button onClick={handleAdd} className={BUTTON}>
          + Topic
        </button>
      </div>
    </section>
  )
}

function ProduceSection() {
  const topology = useKafkaSandbox((s) => s.topology)
  const produceManually = useKafkaSandbox((s) => s.produceManually)

  const [producerId, setProducerId] = useState('')
  const [topic, setTopic] = useState('')
  const [value, setValue] = useState('')

  const activeProducerId = topology.producers.some((p) => p.id === producerId) ? producerId : topology.producers[0]?.id ?? ''
  const activeTopic = topology.topics.some((t) => t.name === topic) ? topic : topology.topics[0]?.name ?? ''
  const canPublish = Boolean(activeProducerId && activeTopic)

  const handlePublish = (e: FormEvent) => {
    e.preventDefault()
    if (!canPublish) return
    produceManually({ producerId: activeProducerId, topic: activeTopic, value: value || 'hello' })
  }

  return (
    <section>
      <h3 className="mb-1 text-section text-content-faint">Produce tay</h3>
      {topology.producers.length === 0 && (
        <p className="mb-1 text-meta text-content-faint">Thêm một producer trước khi publish.</p>
      )}
      <form onSubmit={handlePublish} className="space-y-1.5 text-meta">
        <label className={fieldRow}>
          <span>producer</span>
          <select
            value={activeProducerId}
            onChange={(e) => setProducerId(e.target.value)}
            className="rounded bg-surface-hover px-1.5 py-0.5 text-content"
          >
            <option value="">— chọn producer —</option>
            {topology.producers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldRow}>
          <span>topic</span>
          <select
            value={activeTopic}
            onChange={(e) => setTopic(e.target.value)}
            className="rounded bg-surface-hover px-1.5 py-0.5 text-content"
          >
            <option value="">— chọn topic —</option>
            {topology.topics.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldRow}>
          <span>nội dung</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="hello"
            aria-label="nội dung"
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={!canPublish}
          className="min-h-11 w-full rounded bg-accent px-2 py-1 font-medium text-accent-fg hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-content-faint md:min-h-0"
        >
          Publish
        </button>
      </form>
    </section>
  )
}

export function SandboxPanel({ state, issues }: { state: KafkaState; issues: KafkaValidationIssue[] }) {
  const topology = useKafkaSandbox((s) => s.topology)
  const addBroker = useKafkaSandbox((s) => s.addBroker)
  const addProducer = useKafkaSandbox((s) => s.addProducer)
  const addConsumer = useKafkaSandbox((s) => s.addConsumer)
  const reset = useKafkaSandbox((s) => s.reset)
  const [exportOpen, setExportOpen] = useState(false)

  const nodeCount = topology.brokers.length + topology.producers.length + topology.consumers.length

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto" data-testid="sandbox-panel">
      <section>
        <div className="flex items-start justify-between gap-2">
          <h2 className="mb-1 text-ui font-semibold text-content-strong">Sandbox</h2>
          <button
            onClick={() => setExportOpen(true)}
            data-testid="export-button"
            className={BUTTON}
          >
            Xuất code
          </button>
        </div>
        <p className="text-meta text-content-faint">
          Tự xây cluster Kafka của riêng bạn: thêm broker, topic, producer, consumer, rồi produce tay.
        </p>
      </section>

      {exportOpen && <ExportDialog topology={topology} onClose={() => setExportOpen(false)} />}

      <IssuesList issues={issues} issueText={issueText} />
      <HaltedBanner halted={state.halted} />

      <section>
        <h3 className="mb-1 text-section text-content-faint">Thêm node</h3>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => addBroker(nextPosition(nodeCount))} className={BUTTON}>
            + Broker
          </button>
          <button onClick={() => addProducer(nextPosition(nodeCount))} className={BUTTON}>
            + Producer
          </button>
          <button onClick={() => addConsumer(nextPosition(nodeCount))} className={BUTTON}>
            + Consumer
          </button>
        </div>
      </section>

      <TopicsSection />

      <section>
        <h3 className="mb-1 text-section text-content-faint">Chỉ số</h3>
        <MetricsGrid metrics={{ ...state.metrics }} />
      </section>

      <ProduceSection />

      <section className="min-h-0 flex-1">
        <h3 className="mb-1 text-section text-content-faint">Nhật ký sự kiện</h3>
        <EventLog journal={state.journal} />
      </section>

      <section className="mt-auto border-t border-edge pt-3">
        <button onClick={reset} className={`${DANGER_BUTTON} w-full`}>
          Đặt lại
        </button>
      </section>
    </div>
  )
}
