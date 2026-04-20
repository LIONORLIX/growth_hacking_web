import { getTenantAccessToken } from "@/lib/feishu/auth";

const IMAGE_CACHE_TTL_MS = 60 * 60 * 1000;
const FEISHU_RATE_LIMIT_CODE = 99991400;
const imageCache = new Map<
  string,
  { expiresAt: number; contentType: string; body: ArrayBuffer }
>();

const pendingRequests = new Map<
  string,
  Promise<{ contentType: string; body: ArrayBuffer } | null>
>();

function simpleHash(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer);
  let hash = 0;
  for (let i = 0; i < Math.min(view.length, 4096); i += 1) {
    hash = ((hash << 5) - hash + view[i]!) | 0;
  }
  return `"${hash.toString(36)}-${buffer.byteLength}"`;
}

function parseRangeHeader(rangeHeader: string, size: number): { start: number; end: number } | null {
  const m = rangeHeader.match(/^bytes=(\d*)-(\d*)$/i);
  if (!m) return null;
  const startRaw = m[1];
  const endRaw = m[2];

  if (!startRaw && !endRaw) return null;

  if (!startRaw && endRaw) {
    const suffixLen = Number(endRaw);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return null;
    const start = Math.max(0, size - suffixLen);
    return { start, end: size - 1 };
  }

  const start = Number(startRaw);
  const end = endRaw ? Number(endRaw) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

async function fetchImageFromFeishu(
  token: string
): Promise<{ contentType: string; body: ArrayBuffer } | null> {
  const tenantToken = await getTenantAccessToken();
  const maxAttempts = 4;
  let lastStatus = 500;
  let lastErrText = "Unknown error";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const upstream = await fetch(
      `https://open.feishu.cn/open-apis/drive/v1/medias/${encodeURIComponent(
        token
      )}/download`,
      {
        headers: {
          Authorization: `Bearer ${tenantToken}`,
        },
        cache: "no-store",
      }
    );

    if (upstream.ok) {
      const arrayBuffer = await upstream.arrayBuffer();
      const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
      return { contentType, body: arrayBuffer };
    }

    const errText = await upstream.text();
    lastStatus = upstream.status;
    lastErrText = errText;
    const isRateLimited =
      upstream.status === 429 ||
      errText.includes("request trigger frequency limit") ||
      errText.includes(String(FEISHU_RATE_LIMIT_CODE));

    if (!isRateLimited || attempt === maxAttempts) {
      break;
    }

    const waitMs = Math.min(1200, 180 * 2 ** (attempt - 1));
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  console.error(
    `[Feishu Image] fetch failed for token ${token}: ${lastStatus} ${lastErrText}`
  );
  return null;
}

function sendCachedResponse(
  body: ArrayBuffer,
  contentType: string,
  rangeHeader: string | null
): Response {
  const totalSize = body.byteLength;
  const bodyView = new Uint8Array(body);
  const etag = simpleHash(body);
  const commonHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
    "Accept-Ranges": "bytes",
    ETag: etag,
  };

  if (rangeHeader) {
    const range = parseRangeHeader(rangeHeader, totalSize);
    if (!range) {
      return new Response(null, {
        status: 416,
        headers: {
          ...commonHeaders,
          "Content-Range": `bytes */${totalSize}`,
        },
      });
    }
    const chunk = bodyView.slice(range.start, range.end + 1);
    return new Response(chunk, {
      status: 206,
      headers: {
        ...commonHeaders,
        "Content-Range": `bytes ${range.start}-${range.end}/${totalSize}`,
        "Content-Length": String(chunk.byteLength),
      },
    });
  }
  return new Response(body, {
    status: 200,
    headers: { ...commonHeaders, "Content-Length": String(totalSize) },
  });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");
    const rangeHeader = request.headers.get("range");
    const ifNoneMatch = request.headers.get("if-none-match");

    if (process.env.NODE_ENV === "production") {
      const referer = request.headers.get("referer") || "";
      const origin = request.headers.get("origin") || "";
      const host = request.headers.get("host") || "";
      const isSameOrigin = origin.includes(host) || referer.includes(host);
      if (!isSameOrigin) {
        return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
    }

    if (!token) {
      return Response.json({ ok: false, error: "Missing image token" }, { status: 400 });
    }

    const cached = imageCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      if (ifNoneMatch) {
        const etag = simpleHash(cached.body);
        if (ifNoneMatch === etag) {
          return new Response(null, {
            status: 304,
            headers: {
              "Cache-Control": "public, max-age=3600, s-maxage=86400",
              ETag: etag,
            },
          });
        }
      }
      return sendCachedResponse(cached.body, cached.contentType, rangeHeader);
    }

    const pending = pendingRequests.get(token);
    if (pending) {
      const result = await pending;
      if (!result) {
        return Response.json(
          { ok: false, error: "Feishu image fetch failed" },
          { status: 502 }
        );
      }
      if (ifNoneMatch) {
        const etag = simpleHash(result.body);
        if (ifNoneMatch === etag) {
          return new Response(null, { status: 304, headers: { ETag: etag } });
        }
      }
      return sendCachedResponse(result.body, result.contentType, rangeHeader);
    }

    const fetchPromise = fetchImageFromFeishu(token);
    pendingRequests.set(token, fetchPromise);

    try {
      const result = await fetchPromise;
      if (!result) {
        return Response.json(
          { ok: false, error: "Feishu image fetch failed" },
          { status: 502 }
        );
      }

      imageCache.set(token, {
        expiresAt: Date.now() + IMAGE_CACHE_TTL_MS,
        contentType: result.contentType,
        body: result.body,
      });

      if (ifNoneMatch) {
        const etag = simpleHash(result.body);
        if (ifNoneMatch === etag) {
          return new Response(null, { status: 304, headers: { ETag: etag } });
        }
      }
      return sendCachedResponse(result.body, result.contentType, rangeHeader);
    } finally {
      pendingRequests.delete(token);
    }
  } catch (error) {
    console.error("[Feishu Image Route Error]", error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
