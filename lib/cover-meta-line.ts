/**
 * 封面/卡片元信息一行：Category 与 Region 块、以及其它标签之间用「｜」；
 * 多个 Region 之间用「·」。与 Playbook 列表、文章 Hero 共用。
 */

export function stripCoverMetaText(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\uFE0F/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function flattenFieldToTagStrings(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") {
    const t = value.trim();
    return t ? [t] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(flattenFieldToTagStrings);
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const t = o.text ?? o.name ?? o.label;
    if (typeof t === "string" && t.trim()) return [t.trim()];
  }
  return [];
}

/**
 * @param fields 飞书记录 fields（或任意含 Category / Region / Tags 的对象）
 */
export function formatCoverMetaLine(
  fields: Record<string, unknown>,
  strip: (s: string) => string = stripCoverMetaText
): string {
  const seen = new Set<string>();
  const take = (raw: string): string | null => {
    const t = strip(raw);
    if (!t) return null;
    const key = t.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    return t;
  };

  const segments: string[] = [];

  const categoryRaw = fields.Category ?? fields.category;
  const categories: string[] = [];
  for (const c of flattenFieldToTagStrings(categoryRaw)) {
    const t = take(c);
    if (t) categories.push(t);
  }
  if (categories.length) {
    segments.push(categories.join(" · "));
  }

  const regions: string[] = [];
  const regionRaw = fields.Region ?? fields.region;
  if (Array.isArray(regionRaw)) {
    for (const r of regionRaw) {
      if (typeof r === "string" && r.trim()) {
        const t = take(r.trim());
        if (t) regions.push(t);
      }
    }
  }
  if (regions.length) {
    segments.push(regions.join(" · "));
  }

  for (const key of ["Tags", "tags", "Tag", "tag"] as const) {
    const raw = fields[key];
    for (const s of flattenFieldToTagStrings(raw)) {
      const t = take(s);
      if (t) segments.push(t);
    }
  }

  return segments.join(" ｜ ");
}
