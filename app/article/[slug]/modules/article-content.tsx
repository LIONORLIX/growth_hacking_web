/**
 * 文章正文区域：按多维表 block 类型渲染（标题、表格、画板、分栏等），并列出原图链接。
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ArticleApiData, ArticleBlock } from "../article-types";
import { PRESET_DOCUMENT_ID } from "../article-constants";
import { buildHeadingId } from "../article-heading";
import {
  buildHeadingDisplayLevelMap,
  buildHeadingNumberPrefixesForArticleBlocks,
  buildHeadingNumberPrefixesForPayloads,
  classNameForHeadingDisplayLevel,
  collectRawHeadingLevelsFromArticleBlocks,
  collectRawHeadingLevelsFromPayloads,
  displayHeadingLevel,
  rawHeadingLevelFromApiBlock,
} from "../article-heading-level-map";
import {
  applyTableCellMergeToGrid,
  isFeishuMediaProxyUrl,
  parseContentSegments,
  parseListText,
  renderBlock,
  renderInline,
  renderRichCellContent,
} from "./article-markdown";
import { ArticleLazyImage } from "./article-lazy-image";
import { ArticleSkeletonCallout, ArticleSkeletonGrid } from "./article-skeleton";
import styles from "./article-prose.module.css";

function TableOverflowHint({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hint, setHint] = useState({ left: false, right: false });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateHint = () => {
      const maxScrollLeft = el.scrollWidth - el.clientWidth;
      const hasOverflow = maxScrollLeft > 2;
      if (!hasOverflow) {
        setHint({ left: false, right: false });
        return;
      }
      setHint({
        left: el.scrollLeft > 2,
        right: el.scrollLeft < maxScrollLeft - 2,
      });
    };

    updateHint();
    el.addEventListener("scroll", updateHint, { passive: true });
    window.addEventListener("resize", updateHint);
    return () => {
      el.removeEventListener("scroll", updateHint);
      window.removeEventListener("resize", updateHint);
    };
  }, []);

  return (
    <div className={styles.tableWrapHintHost}>
      <div ref={containerRef} className={styles.tableWrap}>
        {children}
      </div>
      {hint.left ? (
        <span className={`${styles.tableOverflowHint} ${styles.tableOverflowHintLeft}`}>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={styles.tableOverflowHintIcon}
          >
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
        </span>
      ) : null}
      {hint.right ? (
        <span className={`${styles.tableOverflowHint} ${styles.tableOverflowHintRight}`}>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={styles.tableOverflowHintIcon}
          >
            <path d="M5 12h14" />
            <path d="M12 5l7 7-7 7" />
          </svg>
        </span>
      ) : null}
    </div>
  );
}

/** 按飞书 width_ratio 生成 CSS Grid 列定义；缺失或无效时等分。 */
function gridTemplateColumnsFromRatios(
  columnCount: number,
  ratios: number[] | undefined
): string {
  const n = Math.max(columnCount, 1);
  if (!ratios || ratios.length !== n) {
    return `repeat(${n}, minmax(0, 1fr))`;
  }
  if (!ratios.every((r) => Number.isFinite(r) && r > 0)) {
    return `repeat(${n}, minmax(0, 1fr))`;
  }
  return ratios.map((r) => `minmax(0, ${r}fr)`).join(" ");
}

function normalizeColumnRatios(
  columnCount: number,
  ratios: number[] | undefined
): number[] {
  const n = Math.max(columnCount, 1);
  if (!ratios || ratios.length !== n) {
    return Array.from({ length: n }, () => 1);
  }
  if (!ratios.every((r) => Number.isFinite(r) && r > 0)) {
    return Array.from({ length: n }, () => 1);
  }
  return ratios;
}

function cellFontSizeRemByShare(share: number): number {
  // 进一步强化压缩：窄列显著变小；同表统一取最小列对应字号
  const rem = 0.58 + share * 1.05;
  return Math.min(1.02, Math.max(0.68, rem));
}

type DocPayloadBlock = NonNullable<ArticleApiData["blocks"]>[number];

type DocPayloadRun =
  | { kind: "ordered_group"; blocks: DocPayloadBlock[]; startIndex: number }
  | { kind: "bullet_group"; blocks: DocPayloadBlock[]; startIndex: number }
  | { kind: "single"; block: DocPayloadBlock; index: number };

/**
 * 飞书每个列表项是独立 block；合并连续 ordered / bullet，避免各自包一层 ol/ul 导致编号恒为 1。
 */
function groupConsecutiveListPayloads(blocks: DocPayloadBlock[]): DocPayloadRun[] {
  const out: DocPayloadRun[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type === "ordered") {
      const startIndex = i;
      const group = [b];
      i += 1;
      while (i < blocks.length && blocks[i].type === "ordered") {
        group.push(blocks[i]);
        i += 1;
      }
      out.push({ kind: "ordered_group", blocks: group, startIndex });
      continue;
    }
    if (b.type === "bullet") {
      const startIndex = i;
      const group = [b];
      i += 1;
      while (i < blocks.length && blocks[i].type === "bullet") {
        group.push(blocks[i]);
        i += 1;
      }
      out.push({ kind: "bullet_group", blocks: group, startIndex });
      continue;
    }
    out.push({ kind: "single", block: b, index: i });
    i += 1;
  }
  return out;
}

export function ArticleContent({
  article,
  blocks,
}: {
  article: ArticleApiData;
  blocks: ArticleBlock[];
}) {
  const isPartial = article.partial === true;
  const isPresetDoc = article.documentId === PRESET_DOCUMENT_ID;
  const blockPayloads = article.blocks ?? [];
  let imageCount = 0;

  const headingLevelMap = useMemo(() => {
    const raw =
      blockPayloads.length > 0
        ? collectRawHeadingLevelsFromPayloads(blockPayloads)
        : collectRawHeadingLevelsFromArticleBlocks(blocks);
    return buildHeadingDisplayLevelMap(raw);
  }, [blockPayloads, blocks]);

  const headingNumberByBlockIndex = useMemo(() => {
    if (blockPayloads.length > 0) {
      return buildHeadingNumberPrefixesForPayloads(blockPayloads, headingLevelMap);
    }
    return buildHeadingNumberPrefixesForArticleBlocks(blocks, headingLevelMap);
  }, [blockPayloads, blocks, headingLevelMap]);

  return (
    <section className="space-y-4">
      <div className={`${styles.content} ${isPresetDoc ? styles.docPreset : ""}`}>
        {blockPayloads.length
          ? groupConsecutiveListPayloads(blockPayloads).map((run) => {
              if (run.kind === "ordered_group") {
                return (
                  <ol
                    key={`ordered-group-${run.blocks[0].id}`}
                    className={styles.orderedBlock}
                  >
                    {run.blocks.map((b, gi) => (
                      <li key={b.id} className={styles.li}>
                        {renderInline(
                          b.text ?? "",
                          `block-ordered-${run.startIndex + gi}`
                        )}
                      </li>
                    ))}
                  </ol>
                );
              }
              if (run.kind === "bullet_group") {
                return (
                  <ul
                    key={`bullet-group-${run.blocks[0].id}`}
                    className={styles.bulletBlock}
                  >
                    {run.blocks.map((b, gi) => (
                      <li key={b.id} className={styles.li}>
                        {renderInline(
                          b.text ?? "",
                          `block-bullet-${run.startIndex + gi}`
                        )}
                      </li>
                    ))}
                  </ul>
                );
              }

              const block = run.block;
              const index = run.index;

              if (block.type.startsWith("heading")) {
                const rawLv = rawHeadingLevelFromApiBlock(block);
                const displayLv = displayHeadingLevel(rawLv, headingLevelMap);
                const cls = classNameForHeadingDisplayLevel(displayLv, styles);
                return (
                  <Fragment key={block.id}>
                    {index > 0 ? <div className={styles.headingSpacer} aria-hidden="true" /> : null}
                    <h2
                      id={buildHeadingId(block.text ?? "", index)}
                      className={cls}
                    >
                      {renderInline(block.text ?? "", `block-heading-${index}`)}
                    </h2>
                  </Fragment>
                );
              }
              if (block.type === "text") {
                const text = block.text ?? "";
                const listLike = parseListText(text);
                if (listLike?.kind === "ul") {
                  return (
                    <ul key={block.id} className={styles.bulletBlock}>
                      {listLike.items.map((item, itemIndex) => (
                        <li key={`${block.id}-text-ul-${itemIndex}`} className={styles.li}>
                          {renderInline(item, `block-text-ul-${index}-${itemIndex}`)}
                        </li>
                      ))}
                    </ul>
                  );
                }
                if (listLike?.kind === "ol") {
                  return (
                    <ol key={block.id} className={styles.orderedBlock}>
                      {listLike.items.map((item, itemIndex) => (
                        <li key={`${block.id}-text-ol-${itemIndex}`} className={styles.li}>
                          {renderInline(item, `block-text-ol-${index}-${itemIndex}`)}
                        </li>
                      ))}
                    </ol>
                  );
                }
                return (
                  <p key={block.id} className={styles.textBlock}>
                    {renderInline(text, `block-text-${index}`)}
                  </p>
                );
              }
              if (block.type === "callout") {
                if (!block.text?.trim() && isPartial) {
                  return <ArticleSkeletonCallout key={block.id} />;
                }
                const calloutText = block.text ?? "";
                const calloutListLike = parseListText(calloutText);
                if (calloutListLike?.kind === "ul") {
                  return (
                    <div key={block.id} className={styles.calloutBlock}>
                      <ul className={styles.bulletBlock}>
                        {calloutListLike.items.map((item, itemIndex) => (
                          <li key={`${block.id}-callout-ul-${itemIndex}`} className={styles.li}>
                            {renderInline(item, `block-callout-ul-${index}-${itemIndex}`)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                }
                if (calloutListLike?.kind === "ol") {
                  return (
                    <div key={block.id} className={styles.calloutBlock}>
                      <ol className={styles.orderedBlock}>
                        {calloutListLike.items.map((item, itemIndex) => (
                          <li key={`${block.id}-callout-ol-${itemIndex}`} className={styles.li}>
                            {renderInline(item, `block-callout-ol-${index}-${itemIndex}`)}
                          </li>
                        ))}
                      </ol>
                    </div>
                  );
                }
                return (
                  <div key={block.id} className={styles.calloutBlock}>
                    {renderInline(calloutText, `block-callout-${index}`)}
                  </div>
                );
              }
              if (block.type === "quote_container") {
                if (!block.text?.trim() && isPartial) {
                  return <ArticleSkeletonCallout key={block.id} />;
                }
                const quoteText = block.text ?? "";
                const quoteListLike = parseListText(quoteText);
                if (quoteListLike?.kind === "ul") {
                  return (
                    <blockquote key={block.id} className={styles.quoteBlock}>
                      <ul className={styles.bulletBlock}>
                        {quoteListLike.items.map((item, itemIndex) => (
                          <li key={`${block.id}-quote-ul-${itemIndex}`} className={styles.li}>
                            {renderInline(item, `block-quote-ul-${index}-${itemIndex}`)}
                          </li>
                        ))}
                      </ul>
                    </blockquote>
                  );
                }
                if (quoteListLike?.kind === "ol") {
                  return (
                    <blockquote key={block.id} className={styles.quoteBlock}>
                      <ol className={styles.orderedBlock}>
                        {quoteListLike.items.map((item, itemIndex) => (
                          <li key={`${block.id}-quote-ol-${itemIndex}`} className={styles.li}>
                            {renderInline(item, `block-quote-ol-${index}-${itemIndex}`)}
                          </li>
                        ))}
                      </ol>
                    </blockquote>
                  );
                }
                return (
                  <blockquote key={block.id} className={styles.quoteBlock}>
                    {renderInline(quoteText, `block-quote-${index}`)}
                  </blockquote>
                );
              }
              if (block.type === "divider") {
                return <div key={block.id} className={styles.dividerBlock} aria-hidden="true" />;
              }
              if (block.type === "image") {
                const isBoardSnapshot = block.caption === "Board Snapshot";
                const boardLink = block.imageToken
                  ? `https://bytedance.larkoffice.com/board/${block.imageToken}`
                  : "";
                return (
                  <figure
                    key={block.id}
                    className={`${styles.imageBlockWrap} ${
                      isBoardSnapshot ? styles.boardBlockWrap : ""
                    }`}
                  >
                    <ArticleLazyImage
                      src={block.imageUrl}
                      alt={block.caption || `article-image-${index}`}
                      className={isBoardSnapshot ? styles.boardImage : styles.image}
                      priority={imageCount++ === 0}
                    />
                    {isBoardSnapshot && boardLink ? (
                      <p className={styles.boardLinkRow}>
                        <a
                          href={boardLink}
                          target="_blank"
                          rel="noreferrer"
                          className={styles.boardLink}
                        >
                          在飞书中打开完整画板
                        </a>
                      </p>
                    ) : null}
                    {block.caption ? (
                      <figcaption className={styles.imageCaption}>
                        {block.caption}
                      </figcaption>
                    ) : null}
                  </figure>
                );
              }
              if (block.type === "video") {
                return (
                  <figure key={block.id} className={styles.imageBlockWrap}>
                    <video
                      src={block.videoUrl}
                      controls
                      playsInline
                      preload="metadata"
                      className={styles.image}
                    >
                      <p>您的浏览器不支持视频播放。</p>
                    </video>
                    {block.caption ? (
                      <figcaption className={styles.imageCaption}>
                        {block.caption}
                      </figcaption>
                    ) : null}
                  </figure>
                );
              }
              if (block.type === "mindnote") {
                return (
                  <figure key={block.id} className={styles.imageBlockWrap}>
                    {block.mindnoteImageUrl ? (
                      <ArticleLazyImage
                        src={block.mindnoteImageUrl}
                        alt={block.caption || `mindnote-${index}`}
                        className={styles.mindnoteImage}
                      />
                    ) : (
                      <div className={styles.mindnoteBlock}>
                        <p className={styles.mindnoteTitle}>思维导图</p>
                        <p className={styles.mindnoteDesc}>
                          该区块来自飞书 MindNote，当前以链接形式展示。
                        </p>
                        <span className={styles.mindnoteToken}>
                          token: {block.mindnoteToken ?? "-"}
                        </span>
                      </div>
                    )}
                    {block.mindnoteUrl ? (
                      <p className={styles.boardLinkRow}>
                        <a
                          href={block.mindnoteUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={styles.boardLink}
                        >
                          在飞书中打开完整 MindNote
                        </a>
                      </p>
                    ) : null}
                  </figure>
                );
              }
              if (block.type === "table") {
                const rows = block.rows ?? [];
                const mergedRows = applyTableCellMergeToGrid(
                  rows,
                  block.tableCellMerge
                );
                const colCount = mergedRows[0]?.length ?? 0;
                const ratios = normalizeColumnRatios(
                  colCount,
                  block.tableColumnWidthRatios
                );
                const ratioSum = ratios.reduce((sum, value) => sum + value, 0) || 1;
                const minColumnShare =
                  ratios.length > 0 ? Math.min(...ratios) / ratioSum : 1;
                const unifiedTableFontSizeRem = cellFontSizeRemByShare(minColumnShare);
                const [header, ...body] = mergedRows;
                return (
                  <TableOverflowHint key={block.id}>
                    <table className={styles.table}>
                      {colCount > 0 ? (
                        <colgroup>
                          {ratios.map((ratio, colIdx) => (
                            <col
                              key={`${block.id}-col-${colIdx}`}
                              style={{ width: `${(ratio / ratioSum) * 100}%` }}
                            />
                          ))}
                        </colgroup>
                      ) : null}
                      {header?.length ? (
                        <thead>
                          <tr>
                            {header.map((cell, cellIdx) =>
                              cell.rowSpan === 0 || cell.colSpan === 0 ? null : (
                                <th
                                  key={`${block.id}-th-${cellIdx}`}
                                  className={styles.th}
                                  rowSpan={cell.rowSpan && cell.rowSpan > 1 ? cell.rowSpan : undefined}
                                  colSpan={cell.colSpan && cell.colSpan > 1 ? cell.colSpan : undefined}
                                  style={{ fontSize: `${unifiedTableFontSizeRem}rem` }}
                                >
                                  {renderRichCellContent(
                                    cell.text,
                                    `block-table-th-${index}-${cellIdx}`
                                  )}
                                </th>
                              )
                            )}
                          </tr>
                        </thead>
                      ) : null}
                      <tbody>
                        {body.map((row, rowIdx) => (
                          <tr key={`${block.id}-tr-${rowIdx}`}>
                            {row.map((cell, cellIdx) =>
                              cell.rowSpan === 0 || cell.colSpan === 0 ? null : (
                                <td
                                  key={`${block.id}-td-${rowIdx}-${cellIdx}`}
                                  className={styles.td}
                                  rowSpan={cell.rowSpan && cell.rowSpan > 1 ? cell.rowSpan : undefined}
                                  colSpan={cell.colSpan && cell.colSpan > 1 ? cell.colSpan : undefined}
                                  style={{ fontSize: `${unifiedTableFontSizeRem}rem` }}
                                >
                                  {renderRichCellContent(
                                    cell.text,
                                    `block-table-td-${index}-${rowIdx}-${cellIdx}`
                                  )}
                                </td>
                              )
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableOverflowHint>
                );
              }
              if (block.type === "grid") {
                const columns = block.columns ?? [];
                const hasColumnContent = columns.some((c) => c.trim().length > 0);
                if (!hasColumnContent && isPartial) {
                  const colCount =
                    (block.raw as { column_size?: number } | null)?.column_size ?? 2;
                  return <ArticleSkeletonGrid key={block.id} cols={colCount} />;
                }
                if (columns.length) {
                  const colCount = Math.max(columns.length, 1);
                  const gridTemplateColumns = gridTemplateColumnsFromRatios(
                    colCount,
                    block.columnWidthRatios
                  );
                  return (
                    <div
                      key={block.id}
                      className={styles.gridColumns}
                      style={{ gridTemplateColumns }}
                    >
                      {columns.map((column, colIdx) => (
                        <div key={`${block.id}-col-${colIdx}`} className={styles.gridColumn}>
                          {parseContentSegments(column).map((seg, segIdx) =>
                            seg.type === "image" ? (
                              <Fragment key={`${block.id}-col-${colIdx}-img-${segIdx}`}>
                                <ArticleLazyImage
                                  src={seg.value}
                                  alt={seg.alt || `grid-image-${colIdx}-${segIdx}`}
                                  className={styles.gridColumnImage}
                                  priority={imageCount++ === 0}
                                />
                                {seg.alt?.trim() ? (
                                  <p className={styles.imageCaption}>{seg.alt.trim()}</p>
                                ) : null}
                              </Fragment>
                            ) : seg.type === "video" ? (
                              <video
                                key={`${block.id}-col-${colIdx}-video-${segIdx}`}
                                src={seg.value}
                                controls
                                playsInline
                                preload="metadata"
                                className={styles.gridColumnImage}
                              >
                                <p>您的浏览器不支持视频播放。</p>
                              </video>
                            ) : seg.value.trim() ? (
                              isFeishuMediaProxyUrl(seg.value) ? (
                                <video
                                  key={`${block.id}-col-${colIdx}-video-url-${segIdx}`}
                                  src={seg.value.trim()}
                                  controls
                                  playsInline
                                  preload="metadata"
                                  className={styles.gridColumnImage}
                                >
                                  <p>您的浏览器不支持视频播放。</p>
                                </video>
                              ) : (
                                <p
                                  key={`${block.id}-col-${colIdx}-text-${segIdx}`}
                                  className={styles.gridColumnText}
                                >
                                  {renderInline(
                                    seg.value,
                                    `block-grid-${index}-${colIdx}-${segIdx}`
                                  )}
                                </p>
                              )
                            ) : null
                          )}
                        </div>
                      ))}
                    </div>
                  );
                }
                return (
                  <pre key={block.id} className={styles.gridBlock}>
                    {JSON.stringify(block.raw, null, 2)}
                  </pre>
                );
              }
              if (block.type === "children") {
                return (
                  <pre key={block.id} className={styles.childrenBlock}>
                    {JSON.stringify(block.raw, null, 2)}
                  </pre>
                );
              }
              return (
                <pre key={block.id} className={styles.unknownBlock}>
                  {JSON.stringify(block.raw ?? block, null, 2)}
                </pre>
              );
            })
          : blocks.map((block, blockIndex) =>
              renderBlock(block, { blockIndex }, { headingLevelMap })
            )}
      </div>
      {!!article.imageUrls?.length && (
        <div className="mt-8 border-t border-gray-100 pt-4">
          <p className="mb-2 text-sm font-medium text-gray-600">原图链接</p>
          <ul className="space-y-1 text-sm">
            {article.imageUrls.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-blue-600 hover:underline"
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
