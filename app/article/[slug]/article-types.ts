/**
 * 文章页共用类型：API 数据结构、正文块、目录项及表格合并单元格等。
 */
export type ContentSegment =
  | { type: "text"; value: string }
  | { type: "image"; value: string; alt?: string }
  | { type: "video"; value: string };

export type ArticleBlock =
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

export type ArticleApiData = {
  recordId: string;
  docsUrl: string;
  documentId: string;
  tags?: string[];
  /** Category ｜ Region·Region ｜ Tags…，与 Playbook 元信息分隔规则一致 */
  coverMetaLine?: string;
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
    /** 与 columns 同序，飞书分栏 width_ratio，用于 grid-template-columns */
    columnWidthRatios?: number[];
    /** 与表格单元格行优先顺序一致，飞书 merge_info */
    tableCellMerge?: Array<{ row_span: number; col_span: number }>;
    /** 与表格列同序，飞书表格列宽比例（如有） */
    tableColumnWidthRatios?: number[];
    raw?: unknown;
  }[];
};

export type RenderCtx = { blockIndex: number };
export type MergedCell = { text: string; rowSpan?: number; colSpan?: number };
export type TocItem = { id: string; text: string; level: number };
