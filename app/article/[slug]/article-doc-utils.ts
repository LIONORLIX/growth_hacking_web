/**
 * 飞书文档链接工具：从多维表字段中递归提取 docx/wiki URL 并解析 documentId。
 */
export function collectDocUrl(value: unknown): string | null {
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

export function pickArticleDocsUrl(fields: Record<string, unknown>): string | null {
  const preferred = collectDocUrl(fields["Pub Docs"]);
  if (preferred) return preferred;
  const fallback = collectDocUrl(fields["Ori Docs"]);
  if (fallback) return fallback;
  return null;
}

export function extractDocumentId(url: string): string | null {
  const match = url.match(/\/(?:docx|wiki)\/([A-Za-z0-9]+)/i);
  return match?.[1] ?? null;
}
