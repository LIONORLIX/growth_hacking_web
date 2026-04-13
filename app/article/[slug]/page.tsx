"use client";

import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import styles from "./article.module.css";
import { PlaybookSplashPaths } from "@/app/lark_growth_design_playbook/playbook-splash-paths";
import {
  heroGradientSeedForRecord,
  themeHexesFromFields,
} from "@/lib/hero-parametric-gradient";

const PRESET_DOCUMENT_ID = "JCKEw8gDBiupjkko8ZCcOtYOnLd";
const APP_TOKEN = "B4K3bAYKTau24es6Dxdcq3FEnig";
const TABLE_ID = "tblHalmUkZ8AZSgp";
const LINE_CAP_BEFORE_SEAL = 0.88;
const PlaybookHeroShaderBackground = dynamic(
  () => import("@/app/lark_growth_design_playbook/playbook-hero-shader-bg"),
  { ssr: false }
);

type ContentSegment =
  | { type: "text"; value: string }
  | { type: "image"; value: string; alt?: string }
  | { type: "video"; value: string };
type ArticleBlock =
  | { type: "heading"; text: string; level: number }
  | { type: "paragraph"; text: string }
  | { type: "blockquote"; text: string }
  | { type: "code"; text: string }
  | { type: "hr" }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "table"; rows: string[][] }
  | { type: "image"; url: string }
  | { type: "video"; url: string; caption?: string };

type ArticleApiData = {
  recordId: string;
  docsUrl: string;
  documentId: string;
  tags?: string[];
  docTitle?: string;
  debug?: boolean;
  content: string;
  imageUrls?: string[];
  partial?: boolean;
  blocks?: {
    id: string;
    type: string;
    text?: string;
    level?: number;
    rows?: string[][];
    imageUrl?: string;
    imageToken?: string;
    videoUrl?: string;
    videoToken?: string;
    caption?: string;
    columns?: string[];
    raw?: unknown;
  }[];
};

type RenderCtx = { blockIndex: number };
type MergedCell = { text: string; rowSpan?: number; colSpan?: number };
type TocItem = { id: string; text: string; level: number };

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

function normalizeHeadingText(text: string): string {
  return text
    .replace(/\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g, "$1")
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugifyHeading(text: string): string {
  const normalized = normalizeHeadingText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "section";
}

function buildHeadingId(text: string, index: number): string {
  return `section-${index}-${slugifyHeading(text)}`;
}

function isFeishuMediaProxyUrl(value: string): boolean {
  const v = value.trim();
  return /^\/api\/feishu-image\?token=.+/i.test(v);
}

function buildRowSpanTable(rows: string[][]): MergedCell[][] {
  if (!rows.length) return [];
  const colCount = Math.max(...rows.map((r) => r.length));
  const normalized = rows.map((r) =>
    Array.from({ length: colCount }, (_, i) => (r[i] ?? "").trim())
  );

  const result: MergedCell[][] = normalized.map((r) =>
    r.map((text) => ({ text }))
  );

  for (let c = 0; c < Math.min(colCount, 1); c++) {
    let anchorRow = -1;
    for (let r = 0; r < normalized.length; r++) {
      const text = normalized[r][c];
      if (text) {
        anchorRow = r;
        continue;
      }
      const rowHasOtherContent = normalized[r].some((v, idx) => idx !== c && Boolean(v));
      if (anchorRow >= 0 && rowHasOtherContent) {
        result[anchorRow][c].rowSpan = (result[anchorRow][c].rowSpan ?? 1) + 1;
        result[r][c] = { text: "", rowSpan: 0 };
      } else {
        anchorRow = -1;
      }
    }
  }

  for (let r = 0; r < normalized.length; r++) {
    const rowHasAnyContent = normalized[r].some(Boolean);
    if (!rowHasAnyContent) continue;

    let anchorCol = -1;
    for (let c = 0; c < colCount; c++) {
      const cell = result[r][c];
      if (cell.rowSpan === 0) continue;

      if (cell.text) {
        anchorCol = c;
        continue;
      }

      if (anchorCol >= 0) {
        result[r][anchorCol].colSpan = (result[r][anchorCol].colSpan ?? 1) + 1;
        result[r][c] = { text: "", colSpan: 0 };
      }
    }
  }

  return result;
}

function renderRichCellContent(text: string, keyPrefix: string): ReactNode[] {
  const segments = parseContentSegments(text);
  const nodes: ReactNode[] = [];
  let idx = 0;

  for (const seg of segments) {
    if (seg.type === "image") {
      nodes.push(
        <LazyImage
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
        />
      );
      continue;
    }
    const lines = seg.value.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (!lines.length) continue;
    for (const line of lines) {
      if (isFeishuMediaProxyUrl(line)) {
        nodes.push(
          <video
            key={`${keyPrefix}-video-line-${idx++}`}
            src={line.trim()}
            controls
            playsInline
            preload="metadata"
            className={styles.gridColumnImage}
          />
        );
        continue;
      }
      nodes.push(
        <p key={`${keyPrefix}-txt-${idx++}`} className={styles.gridColumnText}>
          {renderInline(line, `${keyPrefix}-inline-${idx}`)}
        </p>
      );
    }
  }

  if (!nodes.length) {
    nodes.push(<Fragment key={`${keyPrefix}-empty`}>{renderInline(text, `${keyPrefix}-plain`)}</Fragment>);
  }
  return nodes;
}

function parseContentSegments(content: string): ContentSegment[] {
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

function renderInline(text: string, keyPrefix: string): ReactNode[] {
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

function parseArticleBlocks(content: string): ArticleBlock[] {
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

function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [handleKey]);

  return (
    <div className={styles.lightboxOverlay} onClick={onClose}>
      <button
        type="button"
        className={styles.lightboxClose}
        onClick={onClose}
        aria-label="关闭大图"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M18 6L6 18" />
          <path d="M6 6l12 12" />
        </svg>
      </button>
      <img
        src={src}
        alt={alt}
        className={styles.lightboxImage}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function LazyImage({
  src,
  alt,
  className,
}: {
  src?: string;
  alt: string;
  className: string;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    if (!src) return;
    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px 0px" }
    );

    observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, [src]);

  return (
    <div ref={wrapRef} className={styles.lazyImageWrap}>
      {!isLoaded && <div className={styles.lazyImageSkeleton} />}
      {isVisible && src ? (
        <img
          src={src}
          alt={alt}
          className={`${className} ${styles.lazyImage} ${
            isLoaded ? styles.lazyImageLoaded : ""
          }`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setIsLoaded(true)}
          onClick={() => isLoaded && setLightbox(true)}
          style={{ cursor: isLoaded ? "zoom-in" : undefined }}
        />
      ) : null}
      {lightbox && src && (
        <ImageLightbox
          src={src}
          alt={alt}
          onClose={() => setLightbox(false)}
        />
      )}
    </div>
  );
}

function ShaderCover({ className }: { className?: string }) {
  const art = useMemo(() => {
    const seed = Math.floor(Math.random() * 2147483647) || 1;
    const rand = (() => {
      let state = seed;
      return () => {
        state |= 0;
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })();

    const cols = 32;
    const rows = 18;
    const width = 1000;
    const height = 320;
    const stepX = width / (cols - 1);
    const stepY = height / (rows - 1);
    const phaseA = rand() * Math.PI * 2;
    const phaseB = rand() * Math.PI * 2;
    const freqA = 0.85 + rand() * 0.6;
    const freqB = 1.1 + rand() * 0.8;

    const dots = Array.from({ length: rows * cols }, (_, idx) => {
      const row = Math.floor(idx / cols);
      const col = idx % cols;
      const x = col * stepX;
      const y = row * stepY;
      const nx = col / (cols - 1);
      const ny = row / (rows - 1);

      const wave =
        0.5 +
        0.5 *
          Math.sin(nx * Math.PI * 2 * freqA + phaseA + ny * 1.35) *
          Math.cos(ny * Math.PI * 2 * freqB + phaseB - nx * 1.2);
      const verticalBias = Math.pow(ny, 1.65);
      const signal = 0.22 * wave + 0.78 * verticalBias;
      const jitter = (rand() - 0.5) * 0.22;
      const radius = 0.55 + signal * 2.1 + jitter;
      const opacity = 0.06 + signal * 0.24;
      const visible = ny > 0.2 || rand() > 0.8;

      return {
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        r: Math.max(0.45, radius),
        opacity,
        visible,
      };
    });

    return { dots };
  }, []);

  return (
    <svg
      className={className}
      viewBox="0 0 1000 320"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
      </defs>
      <rect width="1000" height="320" fill="#F6F8FC" />
      {art.dots.map((dot, idx) =>
        dot.visible ? (
          <circle
            key={`dot-${idx}`}
            cx={dot.x}
            cy={dot.y}
            r={dot.r}
            fill="#4F6FAE"
            opacity={dot.opacity}
          />
        ) : null
      )}
    </svg>
  );
}

function getHeadingClass(level: number): string {
  if (level === 1) return styles.heading1;
  if (level === 2) return styles.heading2;
  return styles.heading3;
}

function parseListText(
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

function renderBlock(block: ArticleBlock, ctx: RenderCtx): ReactNode {
  const { blockIndex } = ctx;
  switch (block.type) {
    case "heading":
      const headingId = buildHeadingId(block.text, blockIndex);
      return (
        <h2
          key={`heading-${blockIndex}`}
          id={headingId}
          className={getHeadingClass(block.level)}
        >
          {renderInline(block.text, `heading-${blockIndex}`)}
        </h2>
      );
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
        <LazyImage
          key={`img-${blockIndex}`}
          src={block.url}
          alt={`article-image-${blockIndex}`}
          className={styles.image}
        />
      );
    default:
      return null;
  }
}

function SkeletonCallout() {
  return (
    <div className={styles.skeletonCallout}>
      <div className={styles.skeletonLine} style={{ width: "80%" }} />
      <div className={styles.skeletonLine} style={{ width: "60%" }} />
    </div>
  );
}

function SkeletonGrid({ cols }: { cols: number }) {
  return (
    <div
      className={styles.skeletonGrid}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}
    >
      {Array.from({ length: cols }).map((_, i) => (
        <div key={i} className={styles.skeletonGridCol}>
          <div className={styles.skeletonImageArea} />
          <div className={styles.skeletonLine} style={{ width: "70%" }} />
          <div className={styles.skeletonLineShort} />
        </div>
      ))}
    </div>
  );
}

function ArticleContent({
  article,
  blocks,
}: {
  article: ArticleApiData;
  blocks: ArticleBlock[];
}) {
  const isPartial = article.partial === true;
  const isPresetDoc = article.documentId === PRESET_DOCUMENT_ID;
  const blockPayloads = article.blocks ?? [];
  return (
    <section className="space-y-4">
      <div className={`${styles.content} ${isPresetDoc ? styles.docPreset : ""}`}>
        {blockPayloads.length
          ? blockPayloads.map((block, index) => {
              if (block.type.startsWith("heading")) {
                const level = block.level ?? 3;
                const cls =
                  level === 1
                    ? styles.heading1
                    : level === 2
                    ? styles.heading2
                    : level === 3
                    ? styles.heading3
                    : level === 4
                    ? styles.heading4
                    : level === 5
                    ? styles.heading5
                    : styles.heading6;
                return (
                  <h2
                    key={block.id}
                    id={buildHeadingId(block.text ?? "", index)}
                    className={cls}
                  >
                    {renderInline(block.text ?? "", `block-heading-${index}`)}
                  </h2>
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
              if (block.type === "bullet") {
                return (
                  <ul key={block.id} className={styles.bulletBlock}>
                    <li className={styles.li}>
                      {renderInline(block.text ?? "", `block-bullet-${index}`)}
                    </li>
                  </ul>
                );
              }
              if (block.type === "ordered") {
                return (
                  <ol key={block.id} className={styles.orderedBlock}>
                    <li className={styles.li}>
                      {renderInline(block.text ?? "", `block-ordered-${index}`)}
                    </li>
                  </ol>
                );
              }
              if (block.type === "callout") {
                if (!block.text?.trim() && isPartial) {
                  return <SkeletonCallout key={block.id} />;
                }
                return (
                  <div key={block.id} className={styles.calloutBlock}>
                    {renderInline(block.text ?? "", `block-callout-${index}`)}
                  </div>
                );
              }
              if (block.type === "quote_container") {
                if (!block.text?.trim() && isPartial) {
                  return <SkeletonCallout key={block.id} />;
                }
                return (
                  <blockquote key={block.id} className={styles.quoteBlock}>
                    {renderInline(block.text ?? "", `block-quote-${index}`)}
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
                    <LazyImage
                      src={block.imageUrl}
                      alt={block.caption || `article-image-${index}`}
                      className={isBoardSnapshot ? styles.boardImage : styles.image}
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
                    />
                    {block.caption ? (
                      <figcaption className={styles.imageCaption}>
                        {block.caption}
                      </figcaption>
                    ) : null}
                  </figure>
                );
              }
              if (block.type === "table") {
                const rows = block.rows ?? [];
                const mergedRows = buildRowSpanTable(rows);
                const [header, ...body] = mergedRows;
                return (
                  <div key={block.id} className={styles.tableWrap}>
                    <table className={styles.table}>
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
                  </div>
                );
              }
              if (block.type === "grid") {
                const columns = block.columns ?? [];
                const hasColumnContent = columns.some((c) => c.trim().length > 0);
                if (!hasColumnContent && isPartial) {
                  const colCount =
                    (block.raw as { column_size?: number } | null)?.column_size ?? 2;
                  return <SkeletonGrid key={block.id} cols={colCount} />;
                }
                if (columns.length) {
                  return (
                    <div
                      key={block.id}
                      className={styles.gridColumns}
                      style={{
                        gridTemplateColumns: `repeat(${Math.max(
                          columns.length,
                          1
                        )}, minmax(0, 1fr))`,
                      }}
                    >
                      {columns.map((column, colIdx) => (
                        <div key={`${block.id}-col-${colIdx}`} className={styles.gridColumn}>
                          {parseContentSegments(column).map((seg, segIdx) =>
                            seg.type === "image" ? (
                              <Fragment key={`${block.id}-col-${colIdx}-img-${segIdx}`}>
                                <LazyImage
                                  src={seg.value}
                                  alt={seg.alt || `grid-image-${colIdx}-${segIdx}`}
                                  className={styles.gridColumnImage}
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
                              />
                            ) : (
                              seg.value.trim() ? (
                                isFeishuMediaProxyUrl(seg.value) ? (
                                  <video
                                    key={`${block.id}-col-${colIdx}-video-url-${segIdx}`}
                                    src={seg.value.trim()}
                                    controls
                                    playsInline
                                    preload="metadata"
                                    className={styles.gridColumnImage}
                                  />
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
                            )
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
          : blocks.map((block, blockIndex) => renderBlock(block, { blockIndex }))}
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

function collectDocUrl(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === "string") {
    const match = value.match(/https?:\/\/[^\s]+/);
    const url = match?.[0] ?? value;
    if (url.includes("/docx/") || url.includes("/wiki/")) return url;
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = collectDocUrl(item);
      if (hit) return hit;
    }
    return null;
  }

  if (typeof value === "object") {
    for (const val of Object.values(value as Record<string, unknown>)) {
      const hit = collectDocUrl(val);
      if (hit) return hit;
    }
  }

  return null;
}

function pickArticleDocsUrl(fields: Record<string, unknown>): string | null {
  const preferred = collectDocUrl(fields["Pub Docs"]);
  if (preferred) return preferred;
  const fallback = collectDocUrl(fields["Ori Docs"]);
  if (fallback) return fallback;
  return null;
}

function extractDocumentId(url: string): string | null {
  const match = url.match(/\/(?:docx|wiki)\/([A-Za-z0-9]+)/i);
  return match?.[1] ?? null;
}

export default function ArticlePage() {
  const [mounted, setMounted] = useState(false);
  const bgShader = "none";
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = params.slug as string;
  const recordIdFromQuery = searchParams.get("rid") ?? searchParams.get("recordId") ?? "";
  const debugEnabled = searchParams.get("debug") === "1";
  const debugDocsUrl =
    searchParams.get("debugDocsUrl") ?? searchParams.get("debugDocUrl");

  const [loading, setLoading] = useState(false);
  const [streamComplete, setStreamComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [splashVisible, setSplashVisible] = useState(true);
  const [lineRatio, setLineRatio] = useState(0);
  const [isFetching, setIsFetching] = useState(true);
  const [sealPhase, setSealPhase] = useState(false);
  const sealingRef = useRef(false);
  const splashDismissedRef = useRef(false);
  const splashCurveRef = useRef<SVGPathElement | null>(null);
  const splashHLineRef = useRef<SVGLineElement | null>(null);
  const splashVLineRef = useRef<SVGLineElement | null>(null);
  const [splashStrokeLens, setSplashStrokeLens] = useState<[number, number, number]>([0, 0, 0]);
  const [article, setArticle] = useState<ArticleApiData | null>(null);
  /** 与 Playbook 同源：多维表 theme 列基准色，供 Hero shader */
  const [articleThemeHex, setArticleThemeHex] = useState<string | null>(null);
  const [articleThemeAccentHexes, setArticleThemeAccentHexes] = useState<string[]>([]);
  const [articleSeed, setArticleSeed] = useState<string | null>(null);
  const articleBlocks = useMemo(
    () => (article ? parseArticleBlocks(article.content) : []),
    [article]
  );
  const articleTitle = useMemo(() => {
    if (article?.docTitle?.trim()) {
      return article.docTitle.trim();
    }
    const fromBlocks = article?.blocks?.find((block) =>
      block.type.startsWith("heading")
    )?.text;
    return fromBlocks?.trim() || "";
  }, [article]);
  const tocItems = useMemo((): TocItem[] => {
    const items: TocItem[] = [];
    if (article?.blocks?.length) {
      article.blocks.forEach((block, index) => {
        if (!block.type.startsWith("heading")) return;
        const raw = block.text ?? "";
        const text = normalizeHeadingText(raw);
        if (!text) return;
        const level =
          block.level ?? (Number(block.type.replace("heading", "")) || 3);
        items.push({
          id: buildHeadingId(raw, index),
          text,
          level: Math.min(Math.max(level, 1), 6),
        });
      });
      return items;
    }

    articleBlocks.forEach((block, index) => {
      if (block.type !== "heading") return;
      const text = normalizeHeadingText(block.text);
      if (!text) return;
      items.push({
        id: buildHeadingId(block.text, index),
        text,
        level: Math.min(Math.max(block.level, 1), 6),
      });
    });
    return items;
  }, [article, articleBlocks]);
  const coverTags = useMemo(
    () =>
      Array.from(
        new Set((article?.tags ?? []).map((item) => item.trim()).filter(Boolean))
      ).slice(0, 6),
    [article?.tags]
  );
  const [activeTocId, setActiveTocId] = useState<string>("");
  const [titleStuck, setTitleStuck] = useState(false);
  const titleSentinelRef = useRef<HTMLDivElement | null>(null);
  const articleCoverSeed = useMemo(
    () => articleSeed ?? `${slug || "article"}|${article?.recordId || "cover"}`,
    [article?.recordId, articleSeed, slug]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  const dismissSplash = useCallback(() => {
    if (splashDismissedRef.current) return;
    splashDismissedRef.current = true;
    sealingRef.current = false;
    setSplashVisible(false);
  }, []);

  useEffect(() => {
    if (!isFetching || !splashVisible) return;
    let raf = 0;
    const tick = () => {
      setLineRatio((p) => {
        if (p >= LINE_CAP_BEFORE_SEAL) return p;
        const room = LINE_CAP_BEFORE_SEAL - p;
        return p + Math.max(0.00035, room * 0.028);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isFetching, splashVisible]);

  useEffect(() => {
    if (!splashVisible) return;
    const measure = () => {
      const c = splashCurveRef.current?.getTotalLength() ?? 0;
      const h = splashHLineRef.current?.getTotalLength() ?? 0;
      const v = splashVLineRef.current?.getTotalLength() ?? 0;
      if (c > 0 && h > 0 && v > 0) {
        setSplashStrokeLens([c, h, v]);
      }
    };
    const id = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", measure);
    };
  }, [splashVisible]);

  const onSplashProgressTransitionEnd = (e: React.TransitionEvent<SVGGeometryElement>) => {
    if (!sealingRef.current) return;
    if (e.propertyName !== "stroke-dashoffset") return;
    dismissSplash();
  };

  useEffect(() => {
    if (!sealPhase || lineRatio < 1 || !splashVisible) return;
    const t = window.setTimeout(() => {
      if (sealingRef.current) dismissSplash();
    }, 1150);
    return () => window.clearTimeout(t);
  }, [dismissSplash, lineRatio, sealPhase, splashVisible]);

  useEffect(() => {
    if (!splashVisible || isFetching) return;
    if (lineRatio >= 1) {
      dismissSplash();
      return;
    }
    sealingRef.current = true;
    setSealPhase(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setLineRatio(1);
      });
    });
  }, [dismissSplash, isFetching, lineRatio, splashVisible]);

  useEffect(() => {
    if (!titleSentinelRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setTitleStuck(!entry.isIntersecting);
      },
      { threshold: 0, rootMargin: "-60px 0px 0px 0px" }
    );
    observer.observe(titleSentinelRef.current);
    return () => observer.disconnect();
  }, [mounted]);

  useEffect(() => {
    setActiveTocId(tocItems[0]?.id ?? "");
    if (!tocItems.length) return;
    const headings = tocItems
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!headings.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) =>
              Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top)
          );
        if (visible[0]?.target?.id) {
          setActiveTocId(visible[0].target.id);
        }
      },
      {
        rootMargin: "-140px 0px -65% 0px",
        threshold: [0, 0.1, 0.3, 0.6, 1],
      }
    );

    headings.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [tocItems]);

  useEffect(() => {
    let cancelled = false;

    const loadArticle = async () => {
      splashDismissedRef.current = false;
      setSplashVisible(true);
      setLineRatio(0);
      setSealPhase(false);
      sealingRef.current = false;
      setIsFetching(true);
      setLoading(true);
      setStreamComplete(false);
      setError(null);
      setArticle(null);
      setArticleThemeHex(null);
      setArticleThemeAccentHexes([]);
      setArticleSeed(null);

      try {
        let docsUrl = "";
        let documentId = "";
        let recordId = slug;
        let articleApiUrl = "";

        if (debugEnabled) {
          const query = new URLSearchParams({
            debug: "1",
            stream: "1",
          });
          if (debugDocsUrl) {
            query.set("debugDocsUrl", debugDocsUrl);
          }
          articleApiUrl = `/api/article?${query.toString()}`;
          docsUrl = debugDocsUrl ?? "";
          documentId = debugDocsUrl ? extractDocumentId(debugDocsUrl) ?? "" : "";
        } else {
          const playbookRes = await fetch(
            `/api/playbook?${new URLSearchParams({
              slug,
              ...(recordIdFromQuery ? { recordId: recordIdFromQuery } : {}),
            }).toString()}`
          );
          const playbookResult = await playbookRes.json();

          if (!playbookResult.ok) {
            throw new Error(playbookResult.error || "Record not found");
          }

          const record = playbookResult.data;
          recordId = record.record_id;
          setArticleSeed(
            heroGradientSeedForRecord({
              record_id: record.record_id,
              fields: record.fields as Record<string, unknown>,
            }),
          );
          const themeHexes = themeHexesFromFields(record.fields as Record<string, unknown>);
          setArticleThemeHex(themeHexes[0] ?? null);
          setArticleThemeAccentHexes(themeHexes.slice(1));
          docsUrl = pickArticleDocsUrl(record.fields as Record<string, unknown>) ?? "";
          documentId = extractDocumentId(docsUrl) ?? "";
          articleApiUrl = `/api/article?appToken=${APP_TOKEN}&tableId=${TABLE_ID}&recordId=${record.record_id}&stream=1`;
        }

        const articleRes = await fetch(articleApiUrl);

        if (!articleRes.ok || !articleRes.body) {
          throw new Error(`HTTP ${articleRes.status}`);
        }

        const reader = articleRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done || cancelled) break;

          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            const msg = JSON.parse(line) as {
              type: string;
              data?: ArticleApiData;
              error?: string;
              recordId?: string;
              docsUrl?: string;
              documentId?: string;
              docTitle?: string;
              debug?: boolean;
              content?: string;
              imageUrls?: string[];
              blocks?: ArticleApiData["blocks"];
            };

            if (cancelled) break;

            if (msg.type === "partial") {
              setArticle({
                recordId: msg.recordId ?? recordId,
                docsUrl: msg.docsUrl ?? docsUrl,
                documentId: msg.documentId ?? documentId,
                docTitle: msg.docTitle,
                debug: msg.debug,
                content: msg.content ?? "",
                imageUrls: msg.imageUrls ?? [],
                blocks: msg.blocks,
                partial: true,
              });
              setLoading(false);
            } else if (msg.type === "complete") {
              setArticle(msg.data ?? null);
              setStreamComplete(true);
              setLoading(false);
            } else if (msg.type === "error") {
              setError(msg.error ?? "加载文章失败");
              setLoading(false);
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
      } finally {
        if (!cancelled) {
          setIsFetching(false);
        }
      }
    };

    loadArticle();
    return () => {
      cancelled = true;
    };
  }, [debugDocsUrl, debugEnabled, recordIdFromQuery, slug]);

  if (!mounted) {
    return (
      <div className="relative min-h-screen bg-white pb-16">
        <div
          className="pointer-events-none fixed inset-0 -z-10"
          style={{
            backgroundImage: bgShader,
            backgroundColor: "#ffffff",
            backgroundRepeat: "no-repeat",
            backgroundSize: "cover",
            backgroundPosition: "center center",
          }}
        />
        <div className="relative w-full px-5 sm:px-8 lg:px-10">
          <article>
            <div className="mx-auto mb-10 flex max-w-[760px] items-center justify-between">
              <span className="inline-block h-10 w-10 animate-pulse rounded-full bg-gray-100" />
              <span className="inline-block h-8 w-8 animate-pulse rounded-md bg-gray-100" />
            </div>
            <header className="mx-auto mb-6 max-w-[760px] border-b border-gray-200 pb-5">
              <h1 className="mt-8 text-4xl font-semibold tracking-tight text-gray-900 sm:text-5xl">
                <span className="block h-10 w-2/3 animate-pulse rounded bg-gray-200" />
              </h1>
            </header>
          </article>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-white pb-16">
      {splashVisible ? (
        <div
          className="fixed inset-0 z-[200] flex min-h-0 min-w-0 flex-col bg-white"
          aria-busy
          aria-live="polite"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(lineRatio * 100)}
        >
          <span className="sr-only">加载中</span>
          <div className="pointer-events-none absolute inset-0 z-0 flex min-h-0 min-w-0 flex-col">
            <PlaybookSplashPaths
              curveRef={splashCurveRef}
              hLineRef={splashHLineRef}
              vLineRef={splashVLineRef}
              lengths={splashStrokeLens}
              measured={
                splashStrokeLens[0] > 0 &&
                splashStrokeLens[1] > 0 &&
                splashStrokeLens[2] > 0
              }
              lineRatio={lineRatio}
              sealPhase={sealPhase}
              onStrokeTransitionEnd={onSplashProgressTransitionEnd}
            />
          </div>
        </div>
      ) : null}
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          backgroundImage: bgShader,
          backgroundColor: "#ffffff",
          backgroundRepeat: "no-repeat",
          backgroundSize: "cover",
          backgroundPosition: "center center",
        }}
      />
      <div className="relative w-full px-5 sm:px-8 lg:px-10">
        <div
          className={`fixed inset-x-0 top-0 z-[70] border-b bg-white transition-[opacity,transform] duration-200 ${
            titleStuck
              ? "translate-y-0 opacity-100 border-gray-200"
              : "pointer-events-none -translate-y-full opacity-0 border-transparent"
          }`}
        >
          <div className="mx-auto flex w-full max-w-[1120px] items-center gap-3 py-3">
            <Link
              href="/lark_growth_design_playbook"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="M19 12H5" />
                <path d="M12 19l-7-7 7-7" />
              </svg>
            </Link>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-gray-900">
                {articleTitle}
              </p>
            </div>
            {article?.docsUrl ? (
              <a
                href={article.docsUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="打开原始飞书文档"
                title="打开原始飞书文档"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-200 text-gray-500 transition hover:bg-gray-50 hover:text-blue-600"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M14 3h7v7" />
                  <path d="M10 14L21 3" />
                  <path d="M21 14v7h-7" />
                  <path d="M3 10v11h11" />
                </svg>
              </a>
            ) : (
              <span className="inline-block h-8 w-8 shrink-0 animate-pulse rounded-md bg-gray-100" />
            )}
          </div>
        </div>

        <div className="-mx-5 mb-6 overflow-hidden border-b border-gray-100 sm:-mx-8 lg:-mx-10">
          <div className="absolute inset-x-0 top-0 z-10">
            <div className="mx-auto flex w-full max-w-[1120px] items-center justify-between py-4">
              <Link
                href="/lark_growth_design_playbook"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/70 bg-white/90 text-gray-700 backdrop-blur transition hover:bg-white"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M19 12H5" />
                  <path d="M12 19l-7-7 7-7" />
                </svg>
              </Link>
              {article?.docsUrl ? (
                <a
                  href={article.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="打开原始飞书文档"
                  title="打开原始飞书文档"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/70 bg-white/90 text-gray-700 backdrop-blur transition hover:bg-white"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4"
                  >
                    <path d="M14 3h7v7" />
                    <path d="M10 14L21 3" />
                    <path d="M21 14v7h-7" />
                    <path d="M3 10v11h11" />
                  </svg>
                </a>
              ) : (
                <span className="inline-block h-8 w-8 animate-pulse rounded-md bg-white/70" />
              )}
            </div>
          </div>
          <div className="relative z-[5] flex items-center justify-center">
            <PlaybookHeroShaderBackground
              seed={articleCoverSeed}
              themeBaseHex={articleThemeHex}
              themeAccentHexes={articleThemeAccentHexes}
              variant="hero"
              motionPaused={false}
            />
            <div ref={titleSentinelRef} className="relative z-10 mx-auto max-w-[860px] px-5 py-20 text-center sm:px-8 sm:py-28 lg:py-45">

              <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-[3rem] lg:leading-[1.15]">
                {!article ? (
                  <span className="mx-auto block h-10 w-2/3 animate-pulse rounded bg-white/25" />
                ) : (
                  articleTitle
                )}
              </h1>
              {article && coverTags.length > 0 ? (
                <div className="mt-4 text-center text-sm text-white/85">
                  {coverTags.join(" · ")}
                </div>
              ) : !article ? (
                <div className="mt-4 flex items-center justify-center gap-2">
                  <span className="h-6 w-16 animate-pulse rounded-full bg-white/60" />
                  <span className="h-6 w-14 animate-pulse rounded-full bg-white/60" />
                  <span className="h-6 w-20 animate-pulse rounded-full bg-white/60" />
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-24 lg:grid lg:grid-cols-[240px_minmax(0,860px)] lg:justify-center lg:gap-10">
          <aside className="hidden lg:row-span-2 lg:row-start-1 lg:block">
            <nav className="sticky top-[110px] max-h-[calc(100vh-130px)] overflow-auto pr-4">
              {/* <p className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                目录
              </p> */}
              <ul className="space-y-1">
                {tocItems.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        const el = document.getElementById(item.id);
                        if (!el) return;
                        const top =
                          el.getBoundingClientRect().top + window.scrollY - 152;
                        window.scrollTo({ top, behavior: "smooth" });
                      }}
                      className={`w-full truncate border-l py-1.5 pl-3 pr-2 text-left text-sm transition ${
                        activeTocId === item.id
                          ? "border-gray-900 text-gray-900"
                          : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800"
                      }`}
                      style={{ paddingLeft: `${8 + (item.level - 1) * 8}px` }}
                      title={item.text}
                    >
                      {item.text}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          <article className="lg:col-start-2">

          {loading && !article && (
            <section className="space-y-4">
              <div className={`${styles.content} ${styles.docPreset}`}>
                <div className={styles.heading2}>
                  <div className={styles.skeletonLine} style={{ width: "42%" }} />
                </div>
                <p className={styles.textBlock}>
                  <span className={styles.skeletonLine} style={{ width: "96%" }} />
                </p>
                <p className={styles.textBlock}>
                  <span className={styles.skeletonLine} style={{ width: "88%" }} />
                </p>
                <div className={styles.imageBlockWrap}>
                  <div className={styles.skeletonImageArea} />
                </div>
              </div>
            </section>
          )}
          {error && <p className="text-red-600">{error}</p>}

          {article && (
            <ArticleContent article={article} blocks={articleBlocks} />
          )}

          {article?.partial && !streamComplete && (
            <div className={styles.skeletonCallout}>
              <div className={styles.skeletonLine} style={{ width: "32%" }} />
              <div className={styles.skeletonLineShort} />
            </div>
          )}
          </article>
        </div>

        <footer className="mt-14 border-t border-gray-200">
          <div className="mx-auto flex w-full max-w-[1120px] items-center justify-between gap-4 py-6 text-sm text-gray-500">
            <p>© {new Date().getFullYear()} Lark Growth Design Playbook</p>
            <p>Built for growth stories and design insights.</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
