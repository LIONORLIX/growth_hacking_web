/**
 * 标题与锚点：从标题文案生成可读锚点 id，供目录滚动与页内定位使用。
 */
export function normalizeHeadingText(text: string): string {
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

export function buildHeadingId(text: string, index: number): string {
  return `section-${index}-${slugifyHeading(text)}`;
}
