import { formatCoverMetaLine } from "@/lib/cover-meta-line";
import { recordHasPublishedStatus } from "@/lib/playbook-status";
import {
  getBaseRecords,
  getDocumentBlocks,
  getDocumentContent,
  getDocumentMeta,
  streamDocumentBlocks,
} from "@/lib/feishu/client";
import { pickArticleDocsUrl, extractDocumentId } from "@/app/article/[slug]/article-doc-utils";

const DEFAULT_DEBUG_DOCS_URL =
  "https://bytedance.larkoffice.com/wiki/JCKEw8gDBiupjkko8ZCcOtYOnLd";
const DEBUG_DOCUMENT_ID = "JCKEw8gDBiupjkko8ZCcOtYOnLd";
const DEBUG_DOCS_URL_FROM_ENV = process.env.ARTICLE_DEBUG_DOCS_URL?.trim() || "";
const GLOBAL_DEBUG_ENABLED =
  process.env.ARTICLE_DEBUG === "1" ||
  process.env.ARTICLE_DEBUG?.toLowerCase() === "true";
const ARTICLE_CACHE_TTL_MS = 3 * 60_000;
const ARTICLE_CACHE_SCHEMA_VERSION = "v8";
const articleCache = new Map<string, { expiresAt: number; data: unknown }>();

function isPublishedFields(fields: Record<string, unknown>): boolean {
  return recordHasPublishedStatus(fields);
}

function extractImageUrls(content: string): string[] {
  const urls = new Set<string>();

  const markdownImageRegex = /!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/g;
  let markdownMatch: RegExpExecArray | null = null;
  while ((markdownMatch = markdownImageRegex.exec(content)) !== null) {
    urls.add(markdownMatch[1]);
  }

  const htmlImageRegex = /<img[^>]*src=["'](https?:\/\/[^"']+)["'][^>]*>/g;
  let htmlMatch: RegExpExecArray | null = null;
  while ((htmlMatch = htmlImageRegex.exec(content)) !== null) {
    urls.add(htmlMatch[1]);
  }

  const plainImageRegex =
    /(https?:\/\/[^\s)]+?\.(?:png|jpg|jpeg|gif|webp|bmp|svg))/gi;
  let plainMatch: RegExpExecArray | null = null;
  while ((plainMatch = plainImageRegex.exec(content)) !== null) {
    urls.add(plainMatch[1]);
  }

  return Array.from(urls);
}

function collectTagsFromValue(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") {
    return value
      .split(/[,\uFF0C\u3001|/\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTagsFromValue(item));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const direct = [obj.name, obj.text, obj.label, obj.value]
      .flatMap((item) => collectTagsFromValue(item))
      .filter(Boolean);
    if (direct.length) return direct;
    return Object.values(obj).flatMap((item) => collectTagsFromValue(item));
  }
  return [];
}

function stripEmoji(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function collectTagsFromFields(fields: Record<string, unknown>): string[] {
  // 仅读取指定的两个筛选字段
  const raw = [fields.Category, fields.Region].flatMap((value) =>
    collectTagsFromValue(value)
  );

  return Array.from(
    new Set(
      raw
        .map((item) => stripEmoji(item))
        .filter((item) => item.length >= 1 && item.length <= 24)
    )
  ).slice(0, 12);
}

type DocxElement = {
  text_run?: {
    content?: string;
    text_element_style?: {
      bold?: boolean;
      italic?: boolean;
      inline_code?: boolean;
    };
    link?: { url?: string };
  };
  mention_doc?: {
    title?: string;
    url?: string;
  };
  mention_user?: {
    name?: string;
    en_name?: string;
    user_name?: string;
    title?: string;
    nickname?: string;
  };
};

function getMentionUserName(mention: DocxElement["mention_user"]): string {
  if (!mention) return "同事";
  return (
    mention.name?.trim() ||
    mention.user_name?.trim() ||
    mention.en_name?.trim() ||
    mention.nickname?.trim() ||
    mention.title?.trim() ||
    "同事"
  );
}

type DocxBlock = {
  block_id?: string;
  block_type?: number;
  heading1?: { elements?: DocxElement[] };
  heading2?: { elements?: DocxElement[] };
  heading3?: { elements?: DocxElement[] };
  heading4?: { elements?: DocxElement[] };
  heading5?: { elements?: DocxElement[] };
  heading6?: { elements?: DocxElement[] };
  text?: { elements?: DocxElement[] };
  bullet?: { elements?: DocxElement[] };
  ordered?: { elements?: DocxElement[] };
  callout?: { elements?: DocxElement[] };
  quote?: { elements?: DocxElement[] };
  quote_container?: { elements?: DocxElement[] };
  image?: { token?: string; caption?: { content?: string } };
  video?: { token?: string; caption?: { content?: string } };
  media?: { token?: string; caption?: { content?: string }; mime_type?: string; name?: string };
  file?: { token?: string; name?: string; mime_type?: string };
  board?: { token?: string };
  mindnote?: { token?: string };
  divider?: Record<string, unknown>;
  /** 分栏块：列数 2–5 */
  grid?: { column_size?: number };
  /** 分栏列子块（block_type 25） */
  grid_column?: { width_ratio?: number };
  children?: string[];
  /** 文档表格块（block_type 31）：含列数等，用于正确分行 */
  table?: {
    cells?: string[];
    property?: {
      column_size?: number;
      row_size?: number;
      merge_info?: unknown;
    };
  };
};

type ArticleBlockPayload = {
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
  /** 与 columns 同序；飞书 grid_column.width_ratio（1–99），用于前端列宽比例 */
  columnWidthRatios?: number[];
  /** 与表格单元格展平顺序一致（行优先），飞书 property.merge_info */
  tableCellMerge?: Array<{ row_span: number; col_span: number }>;
  /** 与表格列同序；来源于 table.property.* 的列宽比例信息 */
  tableColumnWidthRatios?: number[];
  mindnoteToken?: string;
  mindnoteUrl?: string;
  raw?: unknown;
};

const TABLE_CELL_GRID_COLUMN_SPLITTER = "@@__TABLE_CELL_GRID_COLUMN_SPLITTER__@@";
const TABLE_CELL_GRID_BLOCK_START = "@@__TABLE_CELL_GRID_BLOCK_START__@@";
const TABLE_CELL_GRID_BLOCK_END = "@@__TABLE_CELL_GRID_BLOCK_END__@@";

function looksLikeVideoByMeta(name?: string, mimeType?: string): boolean {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.startsWith("video/")) return true;
  const lower = (name ?? "").toLowerCase();
  return [".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"].some((ext) => lower.endsWith(ext));
}

function resolveVideoToken(block: DocxBlock): { token: string; caption?: string } | null {
  if (block.video?.token) {
    return { token: block.video.token, caption: block.video.caption?.content ?? "" };
  }
  if (block.media?.token && looksLikeVideoByMeta(block.media.name, block.media.mime_type)) {
    return { token: block.media.token, caption: block.media.caption?.content ?? "" };
  }
  if (block.file?.token && looksLikeVideoByMeta(block.file.name, block.file.mime_type)) {
    return { token: block.file.token, caption: block.file.name ?? "" };
  }
  return null;
}

function renderElementsToMarkdown(elements: DocxElement[] = []): string {
  return elements
    .map((el) => {
      const run = el.text_run;
      if (el.mention_doc) {
        const title = el.mention_doc.title ?? "文档";
        const url = el.mention_doc.url;
        return url ? `[${title}](${url})` : title;
      }
      if (el.mention_user) {
        const name = getMentionUserName(el.mention_user);
        return `@${name}`;
      }
      if (!run?.content) return "";

      let text = run.content;
      const url = run.link?.url;
      const style = run.text_element_style;

      if (style?.inline_code) text = `\`${text}\``;
      if (style?.italic) text = `*${text}*`;
      if (style?.bold) text = `**${text}**`;
      if (url) text = `[${text}](${url})`;

      return text;
    })
    .join("");
}

function blockToMarkdownLine(block: DocxBlock): string | null {
  if (block.heading1) return `# ${renderElementsToMarkdown(block.heading1.elements)}`;
  if (block.heading2) return `## ${renderElementsToMarkdown(block.heading2.elements)}`;
  if (block.heading3) return `### ${renderElementsToMarkdown(block.heading3.elements)}`;
  if (block.heading4) return `#### ${renderElementsToMarkdown(block.heading4.elements)}`;
  if (block.heading5) return `##### ${renderElementsToMarkdown(block.heading5.elements)}`;
  if (block.heading6) return `###### ${renderElementsToMarkdown(block.heading6.elements)}`;
  if (block.bullet) return `- ${renderElementsToMarkdown(block.bullet.elements)}`;
  if (block.ordered) return `1. ${renderElementsToMarkdown(block.ordered.elements)}`;
  if (block.callout) return `> ${renderElementsToMarkdown(block.callout.elements)}`;
  if (block.quote) return `> ${renderElementsToMarkdown(block.quote.elements)}`;
  if (block.quote_container)
    return `> ${renderElementsToMarkdown(block.quote_container.elements)}`;
  if (block.image?.token) {
    const caption = block.image.caption?.content ?? "";
    const url = `/api/feishu-image?token=${encodeURIComponent(block.image.token)}`;
    return `![${caption}](${url})`;
  }
  const video = resolveVideoToken(block);
  if (video?.token) {
    const caption = video.caption ?? "";
    const url = `/api/feishu-image?token=${encodeURIComponent(video.token)}`;
    return `![${caption}](${url})`;
  }
  if (block.board?.token) {
    const url = `/api/feishu-board-image?token=${encodeURIComponent(block.board.token)}`;
    return `![Board Snapshot](${url})`;
  }
  if (block.mindnote?.token) {
    const url = `https://bytedance.larkoffice.com/mindnote/${encodeURIComponent(
      block.mindnote.token
    )}`;
    return `[思维导图](${url})`;
  }
  if (block.text) return renderElementsToMarkdown(block.text.elements);
  if (block.block_type === 19) return "---";
  return null;
}

function normalizeDocxBlock(block: DocxBlock): ArticleBlockPayload {
  const id = block.block_id ?? `${Date.now()}-${Math.random()}`;
  if (block.heading1)
    return { id, type: "heading1", text: renderElementsToMarkdown(block.heading1.elements), level: 1 };
  if (block.heading2)
    return { id, type: "heading2", text: renderElementsToMarkdown(block.heading2.elements), level: 2 };
  if (block.heading3)
    return { id, type: "heading3", text: renderElementsToMarkdown(block.heading3.elements), level: 3 };
  if (block.heading4)
    return { id, type: "heading4", text: renderElementsToMarkdown(block.heading4.elements), level: 4 };
  if (block.heading5)
    return { id, type: "heading5", text: renderElementsToMarkdown(block.heading5.elements), level: 5 };
  if (block.heading6)
    return { id, type: "heading6", text: renderElementsToMarkdown(block.heading6.elements), level: 6 };
  if (block.text) return { id, type: "text", text: renderElementsToMarkdown(block.text.elements) };
  if (block.bullet)
    return { id, type: "bullet", text: renderElementsToMarkdown(block.bullet.elements) };
  if (block.ordered)
    return { id, type: "ordered", text: renderElementsToMarkdown(block.ordered.elements) };
  if (block.callout)
    return { id, type: "callout", text: renderElementsToMarkdown(block.callout.elements) };
  if (block.quote)
    return {
      id,
      type: "quote_container",
      text: renderElementsToMarkdown(block.quote.elements),
    };
  if (block.quote_container)
    return {
      id,
      type: "quote_container",
      text: renderElementsToMarkdown(block.quote_container.elements),
    };
  if (block.image?.token) {
    return {
      id,
      type: "image",
      imageUrl: `/api/feishu-image?token=${encodeURIComponent(block.image.token)}`,
      imageToken: block.image.token,
      caption: block.image.caption?.content ?? "",
    };
  }
  const video = resolveVideoToken(block);
  if (video?.token) {
    return {
      id,
      type: "video",
      videoUrl: `/api/feishu-image?token=${encodeURIComponent(video.token)}`,
      videoToken: video.token,
      caption: video.caption ?? "",
    };
  }
  if (block.board?.token) {
    return {
      id,
      type: "image",
      imageUrl: `/api/feishu-board-image?token=${encodeURIComponent(block.board.token)}`,
      imageToken: block.board.token,
      caption: "Board Snapshot",
    };
  }
  if (block.mindnote?.token) {
    return {
      id,
      type: "mindnote",
      mindnoteToken: block.mindnote.token,
      mindnoteUrl: `https://bytedance.larkoffice.com/mindnote/${encodeURIComponent(
        block.mindnote.token
      )}`,
      caption: "MindNote",
    };
  }
  if (block.divider || block.block_type === 19) return { id, type: "divider" };
  if (block.grid) return { id, type: "grid", raw: block.grid };
  if (block.children) return { id, type: "children", raw: block.children };
  return { id, type: `unknown_${block.block_type ?? "na"}`, raw: block };
}

function extractTextFromBlockTree(
  block: DocxBlock | undefined,
  blockById: Map<string, DocxBlock>,
  depth = 0,
  allowGridSplit = true
): string {
  if (!block || depth > 6) return "";
  if (allowGridSplit && block.grid && (block.children?.length ?? 0) > 0) {
    const columns = (block.children ?? [])
      .map((childId) =>
        extractTextFromBlockTree(blockById.get(childId), blockById, depth + 1, false).trim()
      )
      .filter(Boolean);
    if (columns.length > 1) {
      return `${TABLE_CELL_GRID_BLOCK_START}\n${columns.join(
        `\n${TABLE_CELL_GRID_COLUMN_SPLITTER}\n`
      )}\n${TABLE_CELL_GRID_BLOCK_END}`;
    }
    if (columns.length === 1) {
      return columns[0]!;
    }
  }
  const imageLine = block.image?.token
    ? `![${block.image.caption?.content ?? ""}](/api/feishu-image?token=${encodeURIComponent(
        block.image.token
      )})`
    : "";
  const videoMeta = resolveVideoToken(block);
  const videoLine = videoMeta?.token
    ? `<video src="/api/feishu-image?token=${encodeURIComponent(videoMeta.token)}"></video>`
    : "";
  const own =
    renderElementsToMarkdown(block.heading1?.elements) ||
    renderElementsToMarkdown(block.heading2?.elements) ||
    renderElementsToMarkdown(block.heading3?.elements) ||
    renderElementsToMarkdown(block.heading4?.elements) ||
    renderElementsToMarkdown(block.heading5?.elements) ||
    renderElementsToMarkdown(block.heading6?.elements) ||
    renderElementsToMarkdown(block.text?.elements) ||
    (block.bullet ? `- ${renderElementsToMarkdown(block.bullet.elements)}` : "") ||
    (block.ordered ? `1. ${renderElementsToMarkdown(block.ordered.elements)}` : "") ||
    renderElementsToMarkdown(block.callout?.elements) ||
    renderElementsToMarkdown(block.quote?.elements) ||
    renderElementsToMarkdown(block.quote_container?.elements) ||
    imageLine ||
    videoLine;

  const childText = (block.children ?? [])
    .map((childId) =>
      extractTextFromBlockTree(blockById.get(childId), blockById, depth + 1, allowGridSplit)
    )
    .filter(Boolean)
    .join("\n");

  return [own, childText].filter(Boolean).join("\n");
}

// ─── shared helpers ──────────────────────────────────────────────────────────

/** 解析飞书表格 merge_info，长度须与单元格数一致 */
function normalizeTableCellMergeFlat(
  mergeInfo: unknown,
  cellCount: number
): { row_span: number; col_span: number }[] | null {
  if (cellCount <= 0 || mergeInfo == null) return null;
  const rawArr = Array.isArray(mergeInfo) ? mergeInfo : [mergeInfo];
  if (rawArr.length !== cellCount) return null;
  const out: { row_span: number; col_span: number }[] = [];
  for (const item of rawArr) {
    if (!item || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    const rs = Number(o.row_span ?? o.rowSpan ?? 1);
    const cs = Number(o.col_span ?? o.colSpan ?? 1);
    if (!Number.isFinite(rs) || !Number.isFinite(cs)) return null;
    out.push({
      row_span: Math.min(99, Math.max(0, Math.floor(rs))),
      col_span: Math.min(99, Math.max(0, Math.floor(cs))),
    });
  }
  return out;
}

function buildBlockById(items: DocxBlock[]): Map<string, DocxBlock> {
  const map = new Map<string, DocxBlock>();
  for (const b of items) {
    if (b.block_id) map.set(b.block_id, b);
  }
  return map;
}

function pickTableColumnWidthRatios(
  tableProperty: NonNullable<DocxBlock["table"]>["property"] | undefined,
  colCount: number
): number[] | null {
  if (!tableProperty || colCount <= 0) return null;
  const candidates: unknown[] = [
    (tableProperty as Record<string, unknown>).column_width_ratio,
    (tableProperty as Record<string, unknown>).column_width_ratios,
    (tableProperty as Record<string, unknown>).column_width,
    (tableProperty as Record<string, unknown>).column_widths,
    (tableProperty as Record<string, unknown>).width_ratio,
    (tableProperty as Record<string, unknown>).width_ratios,
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate) || candidate.length !== colCount) continue;
    const normalized = candidate.map((item) => Number(item));
    if (normalized.every((n) => Number.isFinite(n) && n > 0)) {
      return normalized;
    }
  }
  return null;
}

function normalizeBlocks(
  rootBlocks: DocxBlock[],
  blockById: Map<string, DocxBlock>
): ArticleBlockPayload[] {
  const textLikeTypes = new Set([
    "text",
    "bullet",
    "ordered",
    "callout",
    "quote_container",
  ]);

  return rootBlocks.map((block) => {
    const normalized = normalizeDocxBlock(block);
    if (textLikeTypes.has(normalized.type)) {
      // bullet / ordered 自身节点已由 normalizeDocxBlock 正确抽取文本；
      // 若再走树提取会把 "- " / "1. " 前缀重复注入，导致列表渲染异常。
      if (normalized.type === "bullet" || normalized.type === "ordered") {
        return normalized;
      }
      normalized.text = extractTextFromBlockTree(block, blockById);
    }
    if (normalized.type === "grid") {
      const childIds = block.children ?? [];
      normalized.columns = childIds.map((childId) =>
        extractTextFromBlockTree(blockById.get(childId), blockById)
      );
      const ratios: number[] = [];
      for (const childId of childIds) {
        const child = blockById.get(childId);
        const r = child?.grid_column?.width_ratio;
        if (typeof r === "number" && r >= 1 && r <= 99) {
          ratios.push(r);
        }
      }
      if (ratios.length === childIds.length && ratios.length > 0) {
        normalized.columnWidthRatios = ratios;
      }
    }
    if (normalized.type === "children" && block.children?.length) {
      const childIds = block.children ?? [];
      const orderedIds =
        block.table?.cells?.length === childIds.length
          ? block.table.cells
          : childIds;

      const childBlocks = orderedIds
        .map((childId) => blockById.get(childId))
        .filter((item): item is DocxBlock => Boolean(item));
      const looksLikeTable =
        childBlocks.length > 0 &&
        childBlocks.every((child) => child.block_type === 32);

      if (looksLikeTable) {
        const cells = childBlocks.map((child) =>
          extractTextFromBlockTree(child, blockById).trim()
        );
        const total = cells.length;

        const declared = block.table?.property?.column_size;
        let colCount =
          typeof declared === "number" &&
          declared > 0 &&
          total % declared === 0
            ? declared
            : 0;

        if (!colCount) {
          colCount = 2;
          // 无 column_size 时沿用较小列数优先（如 8 格→2 列×4 行 challenge 表）
          for (const c of [2, 3, 4, 5, 6]) {
            if (total >= c && total % c === 0) {
              colCount = c;
              break;
            }
          }
        }

        const rows: string[][] = [];
        for (let i = 0; i < cells.length; i += colCount) {
          rows.push(cells.slice(i, i + colCount));
        }
        normalized.type = "table";
        normalized.rows = rows;
        const tableColumnWidthRatios = pickTableColumnWidthRatios(
          block.table?.property,
          colCount
        );
        if (tableColumnWidthRatios) {
          normalized.tableColumnWidthRatios = tableColumnWidthRatios;
        }
        const mergeFlat = normalizeTableCellMergeFlat(
          block.table?.property?.merge_info,
          cells.length
        );
        if (mergeFlat) {
          normalized.tableCellMerge = mergeFlat;
        }
      } else {
        normalized.text = extractTextFromBlockTree(block, blockById);
      }
    }
    return normalized;
  });
}

/** Resolve document ID from params, returns null + Response on error */
async function resolveDocumentId(
  debug: boolean,
  appToken: string | null,
  tableId: string | null,
  recordId: string | null,
  debugDocsUrl: string | null
): Promise<
  | { ok: true; documentId: string; docsUrl: string; tags: string[]; coverMetaLine: string }
  | { ok: false; response: Response }
> {
  if (debug) {
    const configuredDebugUrl =
      debugDocsUrl?.trim() || DEBUG_DOCS_URL_FROM_ENV || DEFAULT_DEBUG_DOCS_URL;
    const configuredDebugDocumentId =
      extractDocumentId(configuredDebugUrl) ?? DEBUG_DOCUMENT_ID;
    return {
      ok: true,
      documentId: configuredDebugDocumentId,
      docsUrl: configuredDebugUrl,
      tags: [],
      coverMetaLine: "",
    };
  }
  const recordsData = await getBaseRecords(appToken!, tableId!);
  const record = ((recordsData as { items?: Array<{ record_id?: string; fields?: Record<string, unknown> }> }).items ?? [])
    .find((item) => item.record_id === recordId);
  if (!record) {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: "Record not found" },
        { status: 404 }
      ),
    };
  }
  const fields = record?.fields ?? {};
  if (!isPublishedFields(fields)) {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: "Record not found" },
        { status: 404 }
      ),
    };
  }
  const docsUrl = pickArticleDocsUrl(fields) ?? "";
  const tags = collectTagsFromFields(fields);
  const coverMetaLine = formatCoverMetaLine(fields);
  if (!docsUrl) {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: "No docs link found in record fields" },
        { status: 404 }
      ),
    };
  }
  const documentId = extractDocumentId(docsUrl) ?? "";
  if (!documentId) {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: "Invalid docs link format" },
        { status: 400 }
      ),
    };
  }
  return { ok: true, documentId, docsUrl, tags, coverMetaLine };
}

// ─── streaming handler ───────────────────────────────────────────────────────

async function handleStreaming(
  documentId: string,
  docsUrl: string,
  recordId: string,
  tags: string[],
  coverMetaLine: string,
  debug: boolean
): Promise<Response> {
  const enc = new TextEncoder();
  const cacheKey = `${ARTICLE_CACHE_SCHEMA_VERSION}|${documentId}|${recordId}`;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
        } catch {
          // stream already closed
        }
      };

      try {
        // ── cache hit: single complete message ──
        const cached = articleCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          send({ type: "complete", data: cached.data });
          controller.close();
          return;
        }

        // ── start meta fetch in parallel ──
        const metaPromise = getDocumentMeta(documentId);
        let partialSent = false;

        const result = await streamDocumentBlocks(
          documentId,
          async (rootLevelItems, _allSoFar) => {
            if (!partialSent) {
              partialSent = true;
              const rootBlocks = rootLevelItems as DocxBlock[];
              // Only root items available → grid/callout columns will be empty strings
              const emptyBlockById = buildBlockById(rootBlocks);
              const partialBlocks = normalizeBlocks(rootBlocks, emptyBlockById);
              const metaData = await metaPromise;
              send({
                type: "partial",
                recordId,
                docsUrl,
                documentId,
                tags,
                coverMetaLine,
                docTitle: metaData.document?.title ?? "",
                debug,
                content: "",
                imageUrls: [],
                blocks: partialBlocks,
                partial: true,
              });
            }
          }
        );

        // ── complete: full normalized data ──
        const metaData = await metaPromise;
        const allBlocks = result.items as DocxBlock[];
        const rootBlocks = result.rootItems as DocxBlock[];
        const blockById = buildBlockById(allBlocks);

        const blockLines = rootBlocks
          .map(blockToMarkdownLine)
          .filter((line): line is string => Boolean(line));
        let content = blockLines.join("\n\n");
        if (!content.trim()) {
          const docData = await getDocumentContent(documentId);
          content =
            (docData as { content?: string }).content ??
            JSON.stringify(docData, null, 2);
        }
        const imageUrls = extractImageUrls(content);
        const blocks = normalizeBlocks(rootBlocks, blockById);

        const data = {
          recordId,
          docsUrl,
          documentId,
          tags,
          coverMetaLine,
          docTitle: metaData.document?.title ?? "",
          debug,
          content,
          imageUrls,
          blocks,
        };
        articleCache.set(cacheKey, {
          expiresAt: Date.now() + ARTICLE_CACHE_TTL_MS,
          data,
        });

        send({ type: "complete", data });
      } catch (err) {
        console.error("[Article Stream Error]", err);
        send({ type: "error", error: String(err) });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// ─── main handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const appToken = searchParams.get("appToken");
    const tableId = searchParams.get("tableId");
    const recordId = searchParams.get("recordId");
    const debugByQuery = searchParams.get("debug") === "1";
    /**
     * 线上正常路径（带 recordId）应优先读取真实记录。
     * GLOBAL_DEBUG_ENABLED 仅在无 recordId（独立调试入口）时兜底启用。
     */
    const debug = debugByQuery || (GLOBAL_DEBUG_ENABLED && !recordId);
    const debugDocsUrl =
      searchParams.get("debugDocsUrl") ?? searchParams.get("debugDocUrl");
    const streaming = searchParams.get("stream") === "1";

    if (!debug && (!appToken || !tableId || !recordId)) {
      return Response.json(
        { ok: false, error: "Missing appToken, tableId or recordId" },
        { status: 400 }
      );
    }

    const resolved = await resolveDocumentId(
      debug,
      appToken,
      tableId,
      recordId,
      debugDocsUrl
    );
    if (!resolved.ok) return resolved.response;
    const { documentId, docsUrl, tags, coverMetaLine } = resolved;
    const effectiveRecordId = recordId ?? "debug";

    // ── streaming mode ──
    if (streaming) {
      return handleStreaming(
        documentId,
        docsUrl,
        effectiveRecordId,
        tags,
        coverMetaLine,
        debug
      );
    }

    // ── regular JSON mode (legacy / cache fast path) ──
    const cacheKey = `${ARTICLE_CACHE_SCHEMA_VERSION}|${documentId}|${effectiveRecordId}`;
    const cached = articleCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return Response.json({ ok: true, data: cached.data });
    }

    const [blocksData, metaData] = await Promise.all([
      getDocumentBlocks(documentId),
      getDocumentMeta(documentId),
    ]);
    const allBlocks = blocksData.items as DocxBlock[];
    const rootBlocks = (blocksData.rootItems as DocxBlock[]) || allBlocks;
    const blockById = buildBlockById(allBlocks);

    const blockLines = rootBlocks
      .map(blockToMarkdownLine)
      .filter((line): line is string => Boolean(line));
    let content = blockLines.join("\n\n");
    if (!content.trim()) {
      const docData = await getDocumentContent(documentId);
      content =
        (docData as { content?: string }).content ??
        JSON.stringify(docData, null, 2);
    }
    const imageUrls = extractImageUrls(content);
    const blocks = normalizeBlocks(rootBlocks, blockById);

    const data = {
      recordId: effectiveRecordId,
      docsUrl,
      documentId,
      tags,
      coverMetaLine,
      docTitle: metaData.document?.title ?? "",
      debug,
      content,
      imageUrls,
      blocks,
    };
    articleCache.set(cacheKey, {
      expiresAt: Date.now() + ARTICLE_CACHE_TTL_MS,
      data,
    });

    return Response.json({ ok: true, data });
  } catch (error) {
    return Response.json(
      { ok: false, error: String(error) },
      { status: 500 }
    );
  }
}
