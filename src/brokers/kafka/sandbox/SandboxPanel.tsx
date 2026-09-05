import { type FormEvent, useState } from 'react'
import type { KafkaState, KafkaValidationIssue } from '../engine'
import { EventLog, HaltedBanner, IssuesList, MetricsGrid } from '../../../shell/ui/Inspector/Inspector'
import { issueText } from '../ui/issueText'
import { useKafkaSandbox } from './kafkaStore'

const BUTTON = 'min-h-11 rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800 md:min-h-0'
const DANGER_BUTTON =
  'min-h-11 rounded border border-rose-800 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-950 md:min-h-0'
const fieldRow = 'flex items-center justify-between gap-2'
const inputClass = 'w-24 rounded bg-slate-800 px-1.5 py-0.5 text-slate-200'

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
      <h3 className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Topic</h3>
      <div className="space-y-1.5">
        {topology.topics.map((topic) => (
          <div key={topic.name} className="flex items-center gap-1.5 text-[11px]" data-testid={`topic-${topic.name}`}>
            <span className="w-16 shrink-0 truncate text-slate-300">{topic.name}</span>
            <label className="flex items-center gap-1 text-slate-500">
              partitions
              <input
                type="number"
                min={1}
                value={topic.partitions}
                onChange={(e) => setPartitionCount(topic.name, Number(e.target.value))}
                aria-label={`số partition của ${topic.name}`}
                className="w-14 rounded bg-slate-800 px-1 py-0.5 text-slate-200"
              />
            </label>
            <label className="flex items-center gap-1 text-slate-500">
              rf
              <input
                type="number"
                min={1}
                value={topic.replicationFactor}
                onChange={(e) => setReplicationFactor(topic.name, Number(e.target.value))}
                aria-label={`replicationFactor của ${topic.name}`}
                className="w-14 rounded bg-slate-800 px-1 py-0.5 text-slate-200"
              />
            </label>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="tên topic"
          aria-label="tên topic"
          className={inputClass}
        />
        <label className="flex items-center gap-1 text-slate-500">
          partitions
          <input
            type="number"
            min={1}
            value={partitions}
            onChange={(e) => setPartitions(Number(e.target.value))}
            aria-label="số partition"
            className="w-14 rounded bg-slate-800 px-1 py-0.5 text-slate-200"
          />
        </label>
        <label className="flex items-center gap-1 text-slate-500">
          rf
          <input
            type="number"
            min={1}
            value={replicationFactor}
            onChange={(e) => setReplicationFactorInput(Number(e.target.value))}
            aria-label="replicationFactor"
            className="w-14 rounded bg-slate-800 px-1 py-0.5 text-slate-200"
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
      <h3 className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Produce tay</h3>
      {topology.producers.length === 0 && (
        <p className="mb-1 text-[11px] text-slate-500">Thêm một producer trước khi publish.</p>
      )}
      <form onSubmit={handlePublish} className="space-y-1.5 text-[11px]">
        <label className={fieldRow}>
          <span>producer</span>
          <select
            value={activeProducerId}
            onChange={(e) => setProducerId(e.target.value)}
            className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200"
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
            className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200"
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
          className="min-h-11 w-full rounded bg-sky-600 px-2 py-1 font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 md:min-h-0"
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

  const nodeCount = topology.brokers.length + topology.producers.length + topology.consumers.length

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto" data-testid="sandbox-panel">
      <section>
        <h2 className="mb-1 text-sm font-semibold text-slate-100">Sandbox</h2>
        <p className="text-[11px] text-slate-500">
          Tự xây cluster Kafka của riêng bạn: thêm broker, topic, producer, consumer, rồi produce tay.
        </p>
      </section>

      <IssuesList issues={issues} issueText={issueText} />
      <HaltedBanner halted={state.halted} />

      <section>
        <h3 className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Thêm node</h3>
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
        <h3 className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Chỉ số</h3>
        <MetricsGrid metrics={{ ...state.metrics }} />
      </section>

      <ProduceSection />

      <section className="min-h-0 flex-1">
        <h3 className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Nhật ký sự kiện</h3>
        <EventLog journal={state.journal} />
      </section>

      <section className="mt-auto border-t border-slate-800 pt-3">
        <button onClick={reset} className={`${DANGER_BUTTON} w-full`}>
          Đặt lại
        </button>
      </section>
    </div>
  )
}
