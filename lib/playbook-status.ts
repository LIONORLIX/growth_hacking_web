/**
 * 飞书多维表格「单选 / 多选」Status 字段解析：字符串、字符串数组、{ text } 选项等。
 */

function extractStatusOptionLabels(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") {
    const t = value.trim();
    return t ? [t] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(extractStatusOptionLabels);
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const t = o.text ?? o.name ?? o.label;
    if (typeof t === "string" && t.trim()) return [t.trim()];
    if (typeof o.value === "string" && o.value.trim()) return [o.value.trim()];
  }
  return [];
}

export function getRecordStatusTokens(fields: Record<string, unknown>): string[] {
  const raw = fields.Status ?? fields.status ?? fields.STATUS;
  return extractStatusOptionLabels(raw)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** 列表/API 可见：含 pub / published / highlight 任一（多选兼容） */
export function recordHasPublishedStatus(fields: Record<string, unknown>): boolean {
  const tokens = getRecordStatusTokens(fields);
  if (tokens.length === 0) return false;
  return (
    tokens.includes("pub") ||
    tokens.includes("published") ||
    tokens.includes("highlight")
  );
}

/** Hero 轮播：仅 Status 含 highlight 的记录 */
export function recordHasHeroHighlight(fields: Record<string, unknown>): boolean {
  return getRecordStatusTokens(fields).includes("highlight");
}

export function itemHasPublishedStatus(item: { fields?: Record<string, unknown> }): boolean {
  return recordHasPublishedStatus((item.fields ?? {}) as Record<string, unknown>);
}

export function itemHasHeroHighlight(item: { fields?: Record<string, unknown> }): boolean {
  return recordHasHeroHighlight((item.fields ?? {}) as Record<string, unknown>);
}
