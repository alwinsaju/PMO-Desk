"use client";

import { Fragment, useMemo, type ReactNode } from "react";
import { CheckSquareIcon, SquareIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import {
  MAX_PREVIEW_CHARS,
  parseNote,
  type Block,
  type InlineNode,
  type ListItem,
} from "./noteMarkdown";

/** Inline pieces as React elements. Text is a plain string child, so React escapes it; a link is
 *  only ever an address noteMarkdown.safeLinkUrl accepted. It opens through the same path as every
 *  other external link in the app: a new window the desktop shell hands to the OS browser (only
 *  http(s) and mailto: pass desktop/url-guard.cjs), never a navigation of the app window. */
function Inline({ nodes }: { nodes: InlineNode[] }): ReactNode {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case "text":
        return <Fragment key={index}>{node.text}</Fragment>;
      case "bold":
        return (
          <strong key={index} className="text-ink font-bold">
            <Inline nodes={node.children} />
          </strong>
        );
      case "code":
        return (
          <code
            key={index}
            className="bg-chip rounded-chip px-1 py-0.5 font-mono text-[0.88em] [overflow-wrap:anywhere]"
          >
            {node.text}
          </code>
        );
      case "link":
        return (
          <a
            key={index}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            title={node.href}
            className="text-info [overflow-wrap:anywhere] underline underline-offset-2"
          >
            <Inline nodes={node.children} />
          </a>
        );
    }
  });
}

const HEADING_CLASS: Record<number, string> = {
  1: "text-[22px] font-bold",
  2: "text-[19px] font-bold",
  3: "text-[17px] font-semibold",
  4: "text-[16px] font-semibold",
  5: "text-[16px] font-semibold",
  6: "text-[16px] font-semibold",
};

function ListRow({ item }: { item: ListItem }) {
  const done = item.marker === "done";
  return (
    <li
      className="flex items-start gap-2"
      style={{ paddingLeft: `${item.depth * 20}px` }}
    >
      <span
        aria-hidden
        className="text-ink-muted flex h-[1.7em] w-5 shrink-0 items-center justify-center"
      >
        {item.marker === "bullet" && "•"}
        {item.marker === "number" && <span className="text-[0.9em]">{item.number}.</span>}
        {item.marker === "todo" && <SquareIcon size={16} />}
        {item.marker === "done" && <CheckSquareIcon size={16} weight="fill" />}
      </span>
      {(item.marker === "todo" || item.marker === "done") && (
        <span className="sr-only">{done ? "Done:" : "To do:"}</span>
      )}
      <span className={cn("min-w-0", done && "text-ink-muted line-through")}>
        <Inline nodes={item.children} />
      </span>
    </li>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "heading": {
      const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return (
        <Tag
          className={cn("text-ink mt-3 mb-1 leading-[1.35]", HEADING_CLASS[block.level])}
        >
          <Inline nodes={block.children} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p className="my-2">
          {block.lines.map((line, index) => (
            <Fragment key={index}>
              {index > 0 && <br />}
              <Inline nodes={line} />
            </Fragment>
          ))}
        </p>
      );
    case "code":
      return (
        <figure className="my-2">
          {block.language && (
            <figcaption className="text-ink-muted px-1 pb-0.5 font-mono text-[11.5px]">
              {block.language}
            </figcaption>
          )}
          <pre
            tabIndex={0}
            className="bg-chip border-line rounded-control overflow-x-auto border p-3 font-mono text-[13px] leading-[1.55]"
          >
            <code>{block.text}</code>
          </pre>
        </figure>
      );
    case "list":
      return (
        <ul role="list" className="my-2 space-y-1">
          {block.items.map((item, index) => (
            <ListRow key={index} item={item} />
          ))}
        </ul>
      );
    case "table":
      return (
        <div className="border-line rounded-control my-2 max-w-full overflow-x-auto border">
          <table className="w-full border-collapse text-[14.5px] leading-[1.5]">
            <thead className="bg-chip">
              <tr>
                {block.header.map((cell, column) => (
                  <th
                    key={column}
                    scope="col"
                    style={{ textAlign: block.align[column] ?? "left" }}
                    className="border-line border-b px-3 py-1.5 font-semibold"
                  >
                    <Inline nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, index) => (
                <tr key={index} className="border-line border-t first:border-t-0">
                  {row.map((cell, column) => (
                    <td
                      key={column}
                      style={{ textAlign: block.align[column] ?? "left" }}
                      className="px-3 py-1.5 align-top"
                    >
                      <Inline nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "rule":
      return <hr className="border-line my-3 border-t" />;
  }
}

/** The note drawn from its markdown text; read-only (edit in the Edit view). */
export function NotePreview({ content }: { content: string }) {
  const parsed = useMemo(() => parseNote(content), [content]);
  return (
    <div
      role="region"
      aria-label="Note preview"
      data-testid="note-preview"
      tabIndex={0}
      className="text-ink px-gutter focus-visible:shadow-field-focus min-h-0 flex-1 overflow-y-auto pt-1.5 pb-3 text-[16px] leading-[1.7] break-words outline-none"
    >
      {parsed.blocks.length === 0 ? (
        <p className="text-ink-faint">Nothing to preview yet.</p>
      ) : (
        parsed.blocks.map((block, index) => <BlockView key={index} block={block} />)
      )}
      {parsed.truncated && (
        <p className="text-ink-muted border-line mt-3 border-t pt-2 text-[12.5px]">
          This note is long, so the preview shows only the first{" "}
          {MAX_PREVIEW_CHARS.toLocaleString("en-GB")} characters. The rest is still in the
          note; switch to Edit to see it.
        </p>
      )}
    </div>
  );
}
