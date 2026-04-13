import { getTenantAccessToken } from "./auth";

type FeishuResponse<T = any> = {
  code: number;
  msg: string;
  data?: T;
};

const FEISHU_RATE_LIMIT_CODE = 99991400;
const DOC_BLOCKS_CACHE_TTL_MS = 5 * 60_000;
const docBlocksCache = new Map<
  string,
  { expiresAt: number; value: { items: unknown[]; rootItems: unknown[] } }
>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId));
}

export async function feishuRequest<T = any>(
  url: string,
  options: RequestInit = {},
  timeout = 10000
): Promise<T> {
  const token = await getTenantAccessToken();

  const finalOptions: RequestInit = {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    cache: "no-store",
  };

  console.log(`[Feishu Request] ${options.method || "GET"} ${url}`);

  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetchWithTimeout(url, finalOptions, timeout);
    const rawText = await res.text();
    console.log(`[Feishu Response] Status: ${res.status}, Raw:`, rawText);

    let data: FeishuResponse<T> | null = null;
    try {
      data = JSON.parse(rawText) as FeishuResponse<T>;
    } catch {
      data = null;
    }

    const hitRateLimit =
      data?.code === FEISHU_RATE_LIMIT_CODE ||
      rawText.includes("request trigger frequency limit");

    if (hitRateLimit && attempt < maxAttempts) {
      const backoffMs = Math.min(6000, 400 * 2 ** (attempt - 1));
      await sleep(backoffMs);
      continue;
    }

    if (!res.ok) {
      throw new Error(`Feishu API HTTP error: ${res.status} - ${rawText}`);
    }

    if (!data) {
      throw new Error(`Feishu API response is not JSON: ${rawText}`);
    }

    if (data.code !== 0) {
      throw new Error(`Feishu API error: code=${data.code}, msg=${data.msg}`);
    }

    return data.data as T;
  }

  throw new Error("Feishu API request failed after retries");
}

export async function getBaseRecords(appToken: string, tableId: string) {
  return feishuRequest(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`
  );
}

export async function getBaseRecord(
  appToken: string,
  tableId: string,
  recordId: string
) {
  return feishuRequest(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`
  );
}

export async function getDocumentContent(documentId: string) {
  return feishuRequest(
    `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/raw_content`
  );
}

export async function getDocumentMeta(documentId: string) {
  return feishuRequest<{
    document?: {
      title?: string;
    };
  }>(`https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}`);
}


type BlockItem = {
  block_id?: string;
  parent_id?: string;
  children?: string[];
  [key: string]: unknown;
};

/**
 * Fetches ALL blocks in the document with a single paginated API call
 * (`GET /docx/v1/documents/{id}/blocks`), then derives rootItems from parent_id.
 * This replaces the recursive children-per-block approach (30+ calls → 1-2 calls).
 */
export async function streamDocumentBlocks(
  documentId: string,
  onRootReady?: (
    rootItems: BlockItem[],
    allItems: BlockItem[]
  ) => Promise<void>
): Promise<{ items: unknown[]; rootItems: unknown[] }> {
  const cached = docBlocksCache.get(documentId);
  if (cached && cached.expiresAt > Date.now()) {
    if (onRootReady) {
      await onRootReady(
        cached.value.rootItems as BlockItem[],
        cached.value.items as BlockItem[]
      );
    }
    return cached.value;
  }

  // ── Single flat-list API: returns every block in the document at once ──
  const allItems: BlockItem[] = [];
  let pageToken = "";
  let hasMore = true;

  while (hasMore) {
    const query = new URLSearchParams({ page_size: "500" });
    if (pageToken) query.set("page_token", pageToken);

    const data = await feishuRequest<{
      has_more?: boolean;
      page_token?: string;
      items?: BlockItem[];
    }>(
      `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks?${query.toString()}`
    );

    if (data.items?.length) allItems.push(...data.items);
    hasMore = Boolean(data.has_more);
    pageToken = data.page_token ?? "";
  }

  // Root items = direct children of the document block (parent_id === documentId)
  const rootItems = allItems.filter((b) => b.parent_id === documentId);

  if (onRootReady) {
    await onRootReady(rootItems, allItems);
  }

  const value = { items: allItems, rootItems };
  docBlocksCache.set(documentId, {
    expiresAt: Date.now() + DOC_BLOCKS_CACHE_TTL_MS,
    value,
  });
  return value;
}

export async function getDocumentBlocks(documentId: string) {
  return streamDocumentBlocks(documentId);
}

export async function getCurrentUser() {
  return feishuRequest(
    `https://open.feishu.cn/open-apis/contact/v3/users/me`
  );
}

export async function getBaseTables(appToken: string) {
  return feishuRequest(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables`
  );
}

export async function getBaseMeta(appToken: string) {
  return feishuRequest(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}`
  );
}
