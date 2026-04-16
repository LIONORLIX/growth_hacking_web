/**
 * 标题展示层级：按全文实际出现的标题级别种类做相对映射（最浅档→展示 1，依次递增），
 * 与目录缩进、正文样式共用同一套映射；超过 6 档时从第 6 档起合并。
 */
import type { ArticleApiData, ArticleBlock } from "./article-types";

/** 从飞书 payload 块解析文档中的原始标题级别 1–6 */
export function rawHeadingLevelFromApiBlock(block: {
  type: string;
  level?: number;
}): number {
  if (!block.type.startsWith("heading")) return 3;
  if (typeof block.level === "number" && Number.isFinite(block.level)) {
    return Math.min(Math.max(Math.round(block.level), 1), 6);
  }
  const m = /^heading([1-6])$/i.exec(block.type);
  if (m) return Number(m[1]);
  return 3;
}

/** 按文档顺序收集所有标题的原始级别（用于构建相对映射） */
export function collectRawHeadingLevelsFromPayloads(
  blocks: NonNullable<ArticleApiData["blocks"]>
): number[] {
  const out: number[] = [];
  for (const b of blocks) {
    if (b.type.startsWith("heading")) {
      out.push(rawHeadingLevelFromApiBlock(b));
    }
  }
  return out;
}

export function collectRawHeadingLevelsFromArticleBlocks(
  blocks: ArticleBlock[]
): number[] {
  const out: number[] = [];
  for (const b of blocks) {
    if (b.type === "heading") {
      out.push(Math.min(Math.max(b.level, 1), 6));
    }
  }
  return out;
}

/**
 * 按「本文实际用到的标题级别种类」做相对映射：最小档映射为展示层级 1，其余按排序依次 2、3…
 * 超过 6 档时从第 6 档起合并到展示层级 6。
 */
export function buildHeadingDisplayLevelMap(rawLevels: number[]): Map<number, number> {
  const map = new Map<number, number>();
  if (!rawLevels.length) return map;
  const uniq = [...new Set(rawLevels)].sort((a, b) => a - b);
  uniq.forEach((lvl, i) => {
    map.set(lvl, Math.min(i + 1, 6));
  });
  return map;
}

/** 展示用层级：有映射表则用相对层级，否则退回原文级别 */
export function displayHeadingLevel(
  rawLevel: number,
  map: Map<number, number>
): number {
  const raw = Math.min(Math.max(Math.round(rawLevel), 1), 6);
  if (!map.size) return raw;
  return map.get(raw) ?? raw;
}

/** 将展示层级 1–6 映射到正文 CSS Module 类名（兼容 CSS Modules 的宽泛类型） */
export function classNameForHeadingDisplayLevel(
  display: number,
  styles: Record<string, string>
): string {
  const d = Math.min(Math.max(Math.round(display), 1), 6);
  const key = `heading${d}`;
  const v = styles[key];
  return typeof v === "string" ? v : (styles.heading3 as string) ?? "";
}

/** 侧栏目录最多展示的标题展示层级（与正文自动序号层级一致） */
export const TOC_MAX_DISPLAY_LEVEL = 2;

/**
 * 按文档块顺序为展示层级 1、2 生成序号（1. / 2. 与 1.1 / 1.2），键为块在数组中的下标。
 * 展示层级 ≥3 不生成条目；若先出现 2 档再出现 1 档，2 档前隐含 1 档计数为 1。
 */
export function buildHeadingNumberPrefixesForPayloads(
  blocks: NonNullable<ArticleApiData["blocks"]>,
  levelMap: Map<number, number>
): Map<number, string> {
  const out = new Map<number, string>();
  let h1 = 0;
  let h2 = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b.type.startsWith("heading")) continue;
    const raw = rawHeadingLevelFromApiBlock(b);
    const d = displayHeadingLevel(raw, levelMap);
    if (d === 1) {
      h1++;
      h2 = 0;
      out.set(i, `${h1}.`);
    } else if (d === 2) {
      if (h1 === 0) h1 = 1;
      h2++;
      out.set(i, `${h1}.${h2}`);
    }
  }
  return out;
}

export function buildHeadingNumberPrefixesForArticleBlocks(
  blocks: ArticleBlock[],
  levelMap: Map<number, number>
): Map<number, string> {
  const out = new Map<number, string>();
  let h1 = 0;
  let h2 = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type !== "heading") continue;
    const d = displayHeadingLevel(b.level, levelMap);
    if (d === 1) {
      h1++;
      h2 = 0;
      out.set(i, `${h1}.`);
    } else if (d === 2) {
      if (h1 === 0) h1 = 1;
      h2++;
      out.set(i, `${h1}.${h2}`);
    }
  }
  return out;
}
