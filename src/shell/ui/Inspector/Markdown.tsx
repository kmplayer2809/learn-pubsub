import { Fragment } from "react";

/**
 * Supports only the constructs lesson bodies use: **bold**, *italic*, `code`,
 * and paragraphs. The bold alternative must stay ahead of the italic one in the
 * pattern, or `**bold**` matches as an italic run wrapping a stray asterisk.
 */
export function Markdown({ text }: { text: string }) {
  return (
    <>
      {text.split("\n\n").map((paragraph, pIndex) => (
        <p key={pIndex} className="mb-2 text-sm leading-relaxed text-ink-300">
          {renderInline(paragraph)}
        </p>
      ))}
    </>
  );
}

/**
 * Same inline constructs without the paragraph wrapper, for headings and other
 * places that cannot legally contain a <p>. Narrative step titles use it: they
 * routinely name a routing pattern like `#`, which would otherwise show its
 * backticks to the reader.
 */
export function MarkdownInline({ text }: { text: string }) {
  return <>{renderInline(text)}</>;
}

function renderInline(paragraph: string) {
  return paragraph
    .split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
    .map((chunk, cIndex) => {
      if (chunk.startsWith("**") && chunk.endsWith("**")) {
        return (
          <strong key={cIndex} className="font-semibold text-ink-100">
            {chunk.slice(2, -2)}
          </strong>
        );
      }
      if (chunk.startsWith("*") && chunk.endsWith("*") && chunk.length > 2) {
        return (
          <em key={cIndex} className="italic text-ink-200">
            {chunk.slice(1, -1)}
          </em>
        );
      }
      if (chunk.startsWith("`") && chunk.endsWith("`")) {
        return (
          <code
            key={cIndex}
            className="rounded bg-ink-800 px-1 font-mono text-[12px] text-accent-300"
          >
            {chunk.slice(1, -1)}
          </code>
        );
      }
      return <Fragment key={cIndex}>{chunk}</Fragment>;
    });
}
