/**
 * Markdown 与纯文本正文：分段解析、行内样式、表格（含飞书 merge 应用）及 fallback 的 `renderBlock`。
 */
import { Fragment, type ReactNode } from "react";
import type {
  ArticleBlock,
  ContentSegment,
  MergedCell,
  RenderCtx,
} from "../article-types";
import { buildHeadingId } from "../article-heading";
import {
  classNameForHeadingDisplayLevel,
  displayHeadingLevel,
} from "../article-heading-level-map";
import { ArticleLazyImage } from "./article-lazy-image";
import styles from "./article-prose.module.css";

/** 标题自动序号与正文之间：抑制在边界处断行（Unicode Word Joiner） */
export const HEADING_NUMBER_TITLE_GLUE = "\u2060";
const TABLE_CELL_GRID_COLUMN_SPLITTER = "@@__TABLE_CELL_GRID_COLUMN_SPLITTER__@@";
const TABLE_CELL_GRID_BLOCK_START = "@@__TABLE_CELL_GRID_BLOCK_START__@@";
const TABLE_CELL_GRID_BLOCK_END = "@@__TABLE_CELL_GRID_BLOCK_END__@@";

export function isFeishuMediaProxyUrl(value: string): boolean {
  const v = value.trim();
  return /^\/api\/feishu-image\?token=.+/i.test(v);
}

/**
 * 将表格行规范为矩形网格（每格独立 td），不做启发式 rowSpan/colSpan。
 * 合并单元格应由上游提供 merge 信息；旧启发式会把「首列空但本行其它列有字」误判为纵向合并，导致整行错位。
 */
export function padTableRowsToMergedCells(rows: string[][]): MergedCell[][] {
  if (!rows.length) return [];
  const colCount = Math.max(...rows.map((r) => r.length));
  return rows.map((r) =>
    Array.from({ length: colCount }, (_, i) => ({
      text: (r[i] ?? "").trim(),
    }))
  );
}

/**
 * 将飞书下发的行优先 merge_info 应用到已按行列切好的单元格网格（生成 rowSpan/colSpan / 被合并占位）。
 */
export function applyTableCellMergeToGrid(
  rows: string[][],
  mergeFlat: Array<{ row_span: number; col_span: number }> | undefined
): MergedCell[][] {
  const grid = padTableRowsToMergedCells(rows);
  if (!mergeFlat?.length) return grid;
  const rowCount = grid.length;
  const colCount = grid[0]?.length ?? 0;
  if (!rowCount || !colCount) return grid;
  if (mergeFlat.length !== rowCount * colCount) return grid;

  for (let i = 0; i < mergeFlat.length; i++) {
    const r = Math.floor(i / colCount);
    const c = i % colCount;
    const rs = mergeFlat[i].row_span;
    const cs = mergeFlat[i].col_span;
    if (rs === 0 || cs === 0) {
      grid[r][c] = { text: grid[r][c].text, rowSpan: 0, colSpan: 0 };
    }
  }

  for (let i = 0; i < mergeFlat.length; i++) {
    const r = Math.floor(i / colCount);
    const c = i % colCount;
    const m = mergeFlat[i];
    if (m.row_span === 0 || m.col_span === 0) continue;
    const rs = Math.max(1, m.row_span);
    const cs = Math.max(1, m.col_span);
    if (rs === 1 && cs === 1) continue;

    grid[r][c].rowSpan = rs;
    grid[r][c].colSpan = cs;
    for (let dr = 0; dr < rs; dr++) {
      for (let dc = 0; dc < cs; dc++) {
        if (dr === 0 && dc === 0) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr < rowCount && cc < colCount) {
          grid[rr][cc] = { text: "", rowSpan: 0, colSpan: 0 };
        }
      }
    }
  }

  return grid;
}

function renderNoBreakShortCjk(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenRegex = /([\u4e00-\u9fff]{2,4})/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;
  let idx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    const token = match[1];
    const start = match.index;
    const end = start + token.length;
    const prev = start > 0 ? text[start - 1] : "";
    const next = end < text.length ? text[end] : "";
    const prevIsCjk = /[\u4e00-\u9fff]/.test(prev);
    const nextIsCjk = /[\u4e00-\u9fff]/.test(next);

    if (start > lastIndex) {
      nodes.push(
        <Fragment key={`${keyPrefix}-text-${idx++}`}>
          {text.slice(lastIndex, start)}
        </Fragment>
      );
    }

    if (!prevIsCjk && !nextIsCjk) {
      nodes.push(
        <span key={`${keyPrefix}-nb-${idx++}`} className={styles.noBreakPhrase}>
          {token}
        </span>
      );
    } else {
      nodes.push(
        <Fragment key={`${keyPrefix}-raw-${idx++}`}>{token}</Fragment>
      );
    }

    lastIndex = end;
  }

  if (lastIndex < text.length) {
    nodes.push(
      <Fragment key={`${keyPrefix}-tail-${idx++}`}>
        {text.slice(lastIndex)}
      </Fragment>
    );
  }

  return nodes.length ? nodes : [<Fragment key={`${keyPrefix}-full`}>{text}</Fragment>];
}

export function renderRichCellContent(
  text: string,
  keyPrefix: string,
  options?: { allowColumnSplit?: boolean }
): ReactNode[] {
  const allowColumnSplit = options?.allowColumnSplit ?? true;
  const splitColumns = allowColumnSplit
    ? text
        .split(TABLE_CELL_GRID_COLUMN_SPLITTER)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  const hasWrappedGridBlock =
    allowColumnSplit &&
    text.includes(TABLE_CELL_GRID_BLOCK_START) &&
    text.includes(TABLE_CELL_GRID_BLOCK_END);
  if (hasWrappedGridBlock) {
    const nodes: ReactNode[] = [];
    const blockRegex = new RegExp(
      `${TABLE_CELL_GRID_BLOCK_START}([\\s\\S]*?)${TABLE_CELL_GRID_BLOCK_END}`,
      "g"
    );
    let lastIndex = 0;
    let match: RegExpExecArray | null = null;
    while ((match = blockRegex.exec(text)) !== null) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) {
        nodes.push(
          ...renderRichCellContent(before, `${keyPrefix}-before-${nodes.length}`, {
            allowColumnSplit: false,
          })
        );
      }
      const innerColumns = match[1]
        .split(TABLE_CELL_GRID_COLUMN_SPLITTER)
        .map((item) => item.trim())
        .filter(Boolean);
      if (innerColumns.length > 1) {
        nodes.push(
          <div
            key={`${keyPrefix}-table-grid-${nodes.length}`}
            className={styles.tableCellGridColumns}
            style={{
              gridTemplateColumns: `repeat(${innerColumns.length}, minmax(0, 1fr))`,
            }}
          >
            {innerColumns.map((column, columnIndex) => (
              <div
                key={`${keyPrefix}-table-grid-col-${nodes.length}-${columnIndex}`}
                className={styles.tableCellGridColumn}
              >
                {renderRichCellContent(column, `${keyPrefix}-table-grid-col-${columnIndex}`, {
                  allowColumnSplit: false,
                })}
              </div>
            ))}
          </div>
        );
      } else if (innerColumns.length === 1) {
        nodes.push(
          ...renderRichCellContent(innerColumns[0]!, `${keyPrefix}-grid-single-${nodes.length}`, {
            allowColumnSplit: false,
          })
        );
      }
      lastIndex = blockRegex.lastIndex;
    }
    const tail = text.slice(lastIndex).trim();
    if (tail) {
      nodes.push(
        ...renderRichCellContent(tail, `${keyPrefix}-tail-${nodes.length}`, {
          allowColumnSplit: false,
        })
      );
    }
    if (nodes.length) return nodes;
  }

  if (splitColumns.length > 1) {
    return [
      <div
        key={`${keyPrefix}-table-grid`}
        className={styles.tableCellGridColumns}
        style={{
          gridTemplateColumns: `repeat(${splitColumns.length}, minmax(0, 1fr))`,
        }}
      >
        {splitColumns.map((column, columnIndex) => (
          <div key={`${keyPrefix}-table-grid-col-${columnIndex}`} className={styles.tableCellGridColumn}>
            {renderRichCellContent(column, `${keyPrefix}-table-grid-col-${columnIndex}`, {
              allowColumnSplit: false,
            })}
          </div>
        ))}
      </div>,
    ];
  }
  const segments = parseContentSegments(text);
  const nodes: ReactNode[] = [];
  let idx = 0;
  const bulletRegex = /^[-*+•]\s+/;
  const orderedRegex = /^\d+[.)、]\s+/;

  for (const seg of segments) {
    if (seg.type === "image") {
      nodes.push(
        <ArticleLazyImage
          key={`${keyPrefix}-img-${idx++}`}
          src={seg.value}
          alt={seg.alt || `${keyPrefix}-image`}
          className={styles.gridColumnImage}
        />
      );
      if (seg.alt?.trim()) {
        nodes.push(
          <p key={`${keyPrefix}-cap-${idx++}`} className={styles.imageCaption}>
            {seg.alt.trim()}
          </p>
        );
      }
      continue;
    }
    if (seg.type === "video") {
      nodes.push(
        <video
          key={`${keyPrefix}-video-${idx++}`}
          src={seg.value}
          controls
          playsInline
          preload="metadata"
          className={styles.gridColumnImage}
        >
          <p>您的浏览器不支持视频播放。</p>
        </video>
      );
      continue;
    }
    const lines = seg.value.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (!lines.length) continue;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex]!;
      if (isFeishuMediaProxyUrl(line)) {
        nodes.push(
          <ArticleLazyImage
            key={`${keyPrefix}-img-line-${idx++}`}
            src={line.trim()}
            alt={`${keyPrefix}-image-line`}
            className={styles.gridColumnImage}
          />
        );
        continue;
      }
      const trimmed = line.trim();
      if (bulletRegex.test(trimmed)) {
        const items: string[] = [];
        while (lineIndex < lines.length) {
          const current = lines[lineIndex]!.trim();
          if (!bulletRegex.test(current)) break;
          items.push(current.replace(bulletRegex, "").trim());
          lineIndex += 1;
        }
        lineIndex -= 1;
        nodes.push(
          <ul key={`${keyPrefix}-txt-ul-${idx++}`} className={styles.bulletBlock}>
            {items.map((item, itemIndex) => (
              <li key={`${keyPrefix}-txt-ul-item-${idx++}-${itemIndex}`} className={styles.li}>
                {renderInline(item, `${keyPrefix}-txt-ul-inline-${idx}-${itemIndex}`)}
              </li>
            ))}
          </ul>
        );
        continue;
      }
      if (orderedRegex.test(trimmed)) {
        const items: string[] = [];
        while (lineIndex < lines.length) {
          const current = lines[lineIndex]!.trim();
          if (!orderedRegex.test(current)) break;
          items.push(current.replace(orderedRegex, "").trim());
          lineIndex += 1;
        }
        lineIndex -= 1;
        nodes.push(
          <ol key={`${keyPrefix}-txt-ol-${idx++}`} className={styles.orderedBlock}>
            {items.map((item, itemIndex) => (
              <li key={`${keyPrefix}-txt-ol-item-${idx++}-${itemIndex}`} className={styles.li}>
                {renderInline(item, `${keyPrefix}-txt-ol-inline-${idx}-${itemIndex}`)}
              </li>
            ))}
          </ol>
        );
        continue;
      }
      nodes.push(
        <p key={`${keyPrefix}-txt-${idx++}`} className={styles.gridColumnText}>
          {renderInline(trimmed, `${keyPrefix}-inline-${idx}`)}
        </p>
      );
    }
  }

  if (!nodes.length) {
    nodes.push(
      <Fragment key={`${keyPrefix}-empty`}>
        {renderInline(text, `${keyPrefix}-plain`)}
      </Fragment>
    );
  }
  return nodes;
}

export function parseContentSegments(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const mediaRegex =
    /!\[([^\]]*)]\(((?:https?:\/\/|\/)[^)\s]+)\)|<img[^>]*src=["']((?:https?:\/\/|\/)[^"']+)["'][^>]*>|<video[^>]*src=["']((?:https?:\/\/|\/)[^"']+)["'][^>]*>(?:<\/video>)?/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = mediaRegex.exec(content)) !== null) {
    const textPart = content.slice(lastIndex, match.index);
    if (textPart) {
      segments.push({ type: "text", value: textPart });
    }
    const markdownAlt = match[1] ?? "";
    const imageUrl = match[2] ?? match[3];
    const videoUrl = match[4];
    if (videoUrl) {
      segments.push({ type: "video", value: videoUrl });
    } else if (imageUrl) {
      segments.push({ type: "image", value: imageUrl, alt: markdownAlt });
    }
    lastIndex = mediaRegex.lastIndex;
  }

  const tail = content.slice(lastIndex);
  if (tail) {
    segments.push({ type: "text", value: tail });
  }

  return segments;
}

function parseTextSegmentToBlocks(text: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  const lines = text.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line) {
      i += 1;
      continue;
    }

    if (line.startsWith("```")) {
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: "code", text: codeLines.join("\n") });
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2],
      });
      i += 1;
      continue;
    }

    if (/^(-{3,}|_{3,}|\*{3,})$/.test(line)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    if (line.startsWith(">")) {
      blocks.push({ type: "blockquote", text: line.replace(/^>\s?/, "") });
      i += 1;
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    if (/^\|.+\|$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
        const row = lines[i]
          .trim()
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim());
        rows.push(row);
        i += 1;
      }
      const pureDivider = /^:?-{3,}:?$/;
      const filteredRows = rows.filter(
        (row) => !row.every((cell) => pureDivider.test(cell))
      );
      blocks.push({ type: "table", rows: filteredRows });
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i].trim();
      if (
        !cur ||
        cur.startsWith("```") ||
        /^(#{1,6})\s+/.test(cur) ||
        /^(-{3,}|_{3,}|\*{3,})$/.test(cur) ||
        cur.startsWith(">") ||
        /^[-*+]\s+/.test(cur) ||
        /^\d+\.\s+/.test(cur)
      ) {
        break;
      }
      paragraphLines.push(lines[i]);
      i += 1;
    }
    if (paragraphLines.length) {
      blocks.push({ type: "paragraph", text: paragraphLines.join("\n") });
    } else {
      i += 1;
    }
  }

  return blocks;
}

export function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const tokenRegex =
    /(\[[^\]]+]\((https?:\/\/[^)\s]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;
  let idx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        <Fragment key={`${keyPrefix}-text-${idx++}`}>
          {renderNoBreakShortCjk(
            text.slice(lastIndex, match.index),
            `${keyPrefix}-chunk-${idx}`
          )}
        </Fragment>
      );
    }

    if (match[1] && match[2]) {
      const label = match[1].match(/^\[([^\]]+)\]/)?.[1] ?? match[2];
      nodes.push(
        <a
          key={`${keyPrefix}-link-${idx++}`}
          href={match[2]}
          target="_blank"
          rel="noreferrer"
          className={styles.inlineLink}
        >
          {label}
        </a>
      );
    } else if (match[3] && match[4]) {
      nodes.push(
        <strong key={`${keyPrefix}-bold-${idx++}`} className={styles.inlineBold}>
          {match[4]}
        </strong>
      );
    } else if (match[5] && match[6]) {
      nodes.push(
        <em key={`${keyPrefix}-italic-${idx++}`} className={styles.inlineItalic}>
          {match[6]}
        </em>
      );
    } else if (match[7] && match[8]) {
      nodes.push(
        <code key={`${keyPrefix}-code-${idx++}`} className={styles.inlineCode}>
          {match[8]}
        </code>
      );
    }
    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(
      <Fragment key={`${keyPrefix}-tail-${idx++}`}>
        {renderNoBreakShortCjk(text.slice(lastIndex), `${keyPrefix}-tail-chunk-${idx}`)}
      </Fragment>
    );
  }

  if (!nodes.length) {
    nodes.push(
      <Fragment key={`${keyPrefix}-plain`}>
        {renderNoBreakShortCjk(text, `${keyPrefix}-plain-chunk`)}
      </Fragment>
    );
  }

  return nodes;
}

export function parseArticleBlocks(content: string): ArticleBlock[] {
  const segments = parseContentSegments(content);
  const blocks: ArticleBlock[] = [];

  for (const segment of segments) {
    if (segment.type === "image") {
      blocks.push({ type: "image", url: segment.value });
      continue;
    }
    if (segment.type === "video") {
      blocks.push({ type: "video", url: segment.value });
      continue;
    }
    blocks.push(...parseTextSegmentToBlocks(segment.value));
  }

  return blocks;
}

export function parseListText(
  text: string
): { kind: "ul" | "ol"; items: string[] } | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return null;

  const bulletRegex = /^[-*+•]\s+/;
  const orderedRegex = /^\d+[.)、]\s+/;

  if (lines.every((line) => bulletRegex.test(line))) {
    return {
      kind: "ul",
      items: lines.map((line) => line.replace(bulletRegex, "")),
    };
  }

  if (lines.every((line) => orderedRegex.test(line))) {
    return {
      kind: "ol",
      items: lines.map((line) => line.replace(orderedRegex, "")),
    };
  }

  return null;
}

export type RenderBlockOptions = {
  headingLevelMap?: Map<number, number>;
};

function withImageParams(src: string, params: Record<string, string | number | undefined>) {
  try {
    const url = new URL(src, "http://local");
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
    const out = url.toString();
    return out.startsWith("http://local") ? out.replace("http://local", "") : src;
  } catch {
    return src;
  }
}

export function renderBlock(
  block: ArticleBlock,
  ctx: RenderCtx,
  opts?: RenderBlockOptions
): ReactNode {
  const { blockIndex } = ctx;
  const headingMap = opts?.headingLevelMap ?? new Map<number, number>();
  switch (block.type) {
    case "heading": {
      const headingId = buildHeadingId(block.text, blockIndex);
      const display = displayHeadingLevel(block.level, headingMap);
      return (
        <Fragment key={`heading-wrap-${blockIndex}`}>
          {blockIndex > 0 ? <div className={styles.headingSpacer} aria-hidden="true" /> : null}
          <h2
            id={headingId}
            className={classNameForHeadingDisplayLevel(display, styles)}
          >
            {renderInline(block.text, `heading-${blockIndex}`)}
          </h2>
        </Fragment>
      );
    }
    case "paragraph":
      return (
        <p key={`paragraph-${blockIndex}`} className={styles.paragraph}>
          {renderInline(block.text, `paragraph-${blockIndex}`)}
        </p>
      );
    case "blockquote":
      return (
        <blockquote key={`blockquote-${blockIndex}`} className={styles.blockquote}>
          {renderInline(block.text, `blockquote-${blockIndex}`)}
        </blockquote>
      );
    case "code":
      return (
        <pre key={`code-${blockIndex}`} className={styles.codeBlock}>
          <code>{block.text}</code>
        </pre>
      );
    case "hr":
      return <div key={`hr-${blockIndex}`} className={styles.hr} aria-hidden="true" />;
    case "ul":
      return (
        <ul key={`ul-${blockIndex}`} className={styles.ul}>
          {block.items.map((item, itemIndex) => (
            <li key={`ul-${blockIndex}-${itemIndex}`} className={styles.li}>
              {renderInline(item, `ul-${blockIndex}-${itemIndex}`)}
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={`ol-${blockIndex}`} className={styles.ol}>
          {block.items.map((item, itemIndex) => (
            <li key={`ol-${blockIndex}-${itemIndex}`} className={styles.li}>
              {renderInline(item, `ol-${blockIndex}-${itemIndex}`)}
            </li>
          ))}
        </ol>
      );
    case "table": {
      const [header, ...body] = block.rows;
      return (
        <div key={`table-${blockIndex}`} className={styles.tableWrap}>
          <table className={styles.table}>
            {header && (
              <thead>
                <tr>
                  {header.map((cell, cellIdx) => (
                    <th key={`th-${blockIndex}-${cellIdx}`} className={styles.th}>
                      {renderInline(cell, `th-${blockIndex}-${cellIdx}`)}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((row, rowIdx) => (
                <tr key={`tr-${blockIndex}-${rowIdx}`}>
                  {row.map((cell, cellIdx) => (
                    <td
                      key={`td-${blockIndex}-${rowIdx}-${cellIdx}`}
                      className={styles.td}
                    >
                      {renderInline(cell, `td-${blockIndex}-${rowIdx}-${cellIdx}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "image":
      return (
        <ArticleLazyImage
          key={`img-${blockIndex}`}
          src={withImageParams(block.url, { w: 1440, q: 72 })}
          lightboxSrc={block.url}
          alt={`article-image-${blockIndex}`}
          className={styles.image}
        />
      );
    default:
      return null;
  }
}
