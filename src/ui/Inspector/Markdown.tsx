import { Fragment } from 'react'

/** Supports only the constructs lesson bodies use: **bold**, `code`, and paragraphs. */
export function Markdown({ text }: { text: string }) {
  return (
    <>
      {text.split('\n\n').map((paragraph, pIndex) => (
        <p key={pIndex} className="mb-2 text-sm leading-relaxed text-slate-300">
          {paragraph.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((chunk, cIndex) => {
            if (chunk.startsWith('**') && chunk.endsWith('**')) {
              return (
                <strong key={cIndex} className="font-semibold text-slate-100">
                  {chunk.slice(2, -2)}
                </strong>
              )
            }
            if (chunk.startsWith('`') && chunk.endsWith('`')) {
              return (
                <code key={cIndex} className="rounded bg-slate-800 px-1 font-mono text-[12px] text-sky-300">
                  {chunk.slice(1, -1)}
                </code>
              )
            }
            return <Fragment key={cIndex}>{chunk}</Fragment>
          })}
        </p>
      ))}
    </>
  )
}
