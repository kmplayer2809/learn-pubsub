import { Handle, Position, type NodeProps } from '@xyflow/react'

const SHELL = 'rounded-lg border px-3 py-2 text-xs shadow-lg'

// Cùng quy ước với RabbitMQ (`rabbitmq/ui/nodes.tsx`) và Redis (`redis/ui/nodes.tsx`):
// viền nét đứt, cách viền một khoảng, màu fuchsia cho highlight từ narrative, tách biệt
// khỏi `ring-2` liền nét cùng tông dùng cho `selected`. `App.test.tsx` tìm node được
// highlight bằng đúng class này nên không được đổi.
const HIGHLIGHT = 'outline-dashed outline-2 outline-offset-4 outline-fuchsia-400'

function highlightClass(data: NodeProps['data']): string {
  return data.highlighted ? HIGHLIGHT : ''
}

// blue/teal/orange/pink/lime: năm tông này không trùng bất kỳ tông nào RabbitMQ (sky,
// violet, emerald, amber) hay Redis (cyan, rose, amber, violet) đã dùng, nên năm loại
// node Kafka luôn phân biệt được bằng mắt kể cả khi đứng cạnh node của broker khác trên
// cùng một canvas. fuchsia bị loại vì nó đã là màu highlight dùng chung.
export function BrokerNode({ data, selected }: NodeProps) {
  const offline = Boolean(data.offline)
  const isController = Boolean(data.isController)
  return (
    <div
      className={`${SHELL} border-blue-500 bg-blue-950 ${selected ? 'ring-2 ring-blue-300' : ''} ${
        offline ? 'opacity-40' : ''
      } ${highlightClass(data)}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="max-w-[200px] truncate font-semibold text-blue-200">{String(data.label)}</div>
      <div className="text-[10px] text-blue-400">
        {offline ? 'offline' : 'online'}
        {isController ? ' · controller' : ''}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function PartitionNode({ data, selected }: NodeProps) {
  const isrCount = Number(data.isrCount)
  const replicaCount = Number(data.replicaCount)
  return (
    <div
      className={`${SHELL} border-teal-500 bg-teal-950 ${
        selected ? 'ring-2 ring-teal-300' : ''
      } ${highlightClass(data)}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2">
        <span className="max-w-[200px] truncate font-semibold text-teal-200">{String(data.label)}</span>
        <span className="rounded bg-teal-800 px-1 text-[10px] text-teal-100">
          ISR {isrCount}/{replicaCount}
        </span>
      </div>
      <div className="text-[10px] text-teal-400">
        LEO {String(data.leo)} · HW {String(data.highWatermark)}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

// Không có `Handle`: consumer group không phải điểm cuối của cạnh nào — cạnh nối thẳng
// partition <-> consumer (xem `toFlow.ts`), node này chỉ là khung chứa trực quan cho các
// consumer con của nó (`parentId`).
export function ConsumerGroupNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`${SHELL} border-orange-500 bg-orange-950 ${
        selected ? 'ring-2 ring-orange-300' : ''
      } ${highlightClass(data)}`}
      style={{ borderStyle: 'dashed' }}
    >
      <div className="max-w-[200px] truncate font-semibold text-orange-200">{String(data.label)}</div>
      <div className="text-[10px] text-orange-400">consumer group</div>
    </div>
  )
}

export function ConsumerNode({ data, selected }: NodeProps) {
  // `joined` phản ánh `state.consumers[id] !== undefined` — trước sự kiện
  // `consumer-join` đầu tiên, consumer chưa có `ConsumerRuntime` nên chưa có gì để tính
  // lag từ đó; hiện "chưa tham gia" trung thực hơn là hiện `lag 0` giả (trông như đã bắt
  // kịp trong khi thực ra chưa từng đọc).
  const joined = Boolean(data.joined)
  return (
    <div
      className={`${SHELL} border-pink-500 bg-pink-950 ${selected ? 'ring-2 ring-pink-300' : ''} ${
        joined ? '' : 'opacity-40'
      } ${highlightClass(data)}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="max-w-[200px] truncate font-semibold text-pink-200">{String(data.label)}</div>
      <div className="text-[10px] text-pink-400">{joined ? `lag ${String(data.lag)}` : 'chưa tham gia'}</div>
    </div>
  )
}

export function ProducerNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`${SHELL} border-lime-500 bg-lime-950 ${
        selected ? 'ring-2 ring-lime-300' : ''
      } ${highlightClass(data)}`}
    >
      <div className="max-w-[200px] truncate font-semibold text-lime-200">{String(data.label)}</div>
      <div className="text-[10px] text-lime-400">producer</div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
