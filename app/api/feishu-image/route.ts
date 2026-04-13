import { getTenantAccessToken } from "@/lib/feishu/auth";

const IMAGE_CACHE_TTL_MS = 10 * 60 * 1000;
const FEISHU_RATE_LIMIT_CODE = 99991400;
const imageCache = new Map<
  string,
  { expiresAt: number; contentType: string; body: ArrayBuffer }
>();

function parseRangeHeader(rangeHeader: string, size: number): { start: number; end: number } | null {
  const m = rangeHeader.match(/^bytes=(\d*)-(\d*)$/i);
  if (!m) return null;
  const startRaw = m[1];
  const endRaw = m[2];

  if (!startRaw && !endRaw) return null;

  // bytes=-N: 最后 N 字节
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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");
    const rangeHeader = request.headers.get("range");

    if (!token) {
      return Response.json({ ok: false, error: "Missing image token" }, { status: 400 });
    }

    const cached = imageCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      const totalSize = cached.body.byteLength;
      const cachedView = new Uint8Array(cached.body);
      const commonHeaders: Record<string, string> = {
        "Content-Type": cached.contentType,
        "Cache-Control": "private, max-age=600",
        "Accept-Ranges": "bytes",
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
        const chunk = cachedView.slice(range.start, range.end + 1);
        return new Response(chunk, {
          status: 206,
          headers: {
            ...commonHeaders,
            "Content-Range": `bytes ${range.start}-${range.end}/${totalSize}`,
            "Content-Length": String(chunk.byteLength),
          },
        });
      }
      return new Response(cached.body, {
        status: 200,
        headers: { ...commonHeaders, "Content-Length": String(totalSize) },
      });
    }

    const tenantToken = await getTenantAccessToken();
    const maxAttempts = 4;
    let arrayBuffer: ArrayBuffer | null = null;
    let contentType = "application/octet-stream";
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
        arrayBuffer = await upstream.arrayBuffer();
        contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
        break;
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

    if (!arrayBuffer) {
      return Response.json(
        { ok: false, error: `Feishu image fetch failed: ${lastStatus} ${lastErrText}` },
        { status: lastStatus }
      );
    }

    const body = arrayBuffer;
    imageCache.set(token, {
      expiresAt: Date.now() + IMAGE_CACHE_TTL_MS,
      contentType,
      body,
    });

    const totalSize = body.byteLength;
    const bodyView = new Uint8Array(body);
    const commonHeaders: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=600",
      "Accept-Ranges": "bytes",
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
      headers: {
        ...commonHeaders,
        "Content-Length": String(totalSize),
      },
    });
  } catch (error) {
    return Response.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
