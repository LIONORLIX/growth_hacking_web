import { getTenantAccessToken } from "@/lib/feishu/auth";

const MINDNOTE_IMAGE_CACHE_TTL_MS = 10 * 60 * 1000;
const mindnoteImageCache = new Map<
  string,
  { expiresAt: number; contentType: string; body: ArrayBuffer }
>();

async function fetchMindnoteSnapshot(
  tenantToken: string,
  token: string
): Promise<{ ok: true; body: ArrayBuffer; contentType: string } | { ok: false; status: number; error: string }> {
  // 先尝试带高分辨率参数；若上游不支持再回退到默认导出。
  const endpoints = [
    `https://open.feishu.cn/open-apis/board/v1/whiteboards/${encodeURIComponent(
      token
    )}/download_as_image?density=2`,
    `https://open.feishu.cn/open-apis/board/v1/whiteboards/${encodeURIComponent(
      token
    )}/download_as_image`,
  ];

  let lastStatus = 500;
  let lastErr = "Unknown error";

  for (const url of endpoints) {
    const upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${tenantToken}` },
      cache: "no-store",
    });
    if (upstream.ok) {
      return {
        ok: true,
        body: await upstream.arrayBuffer(),
        contentType: upstream.headers.get("content-type") ?? "application/octet-stream",
      };
    }
    lastStatus = upstream.status;
    lastErr = await upstream.text();
  }

  return { ok: false, status: lastStatus, error: lastErr };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");
    if (!token) {
      return Response.json({ ok: false, error: "Missing mindnote token" }, { status: 400 });
    }

    const cached = mindnoteImageCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return new Response(cached.body, {
        status: 200,
        headers: {
          "Content-Type": cached.contentType,
          "Cache-Control": "private, max-age=600",
        },
      });
    }

    const tenantToken = await getTenantAccessToken();
    const result = await fetchMindnoteSnapshot(tenantToken, token);
    if (!result.ok) {
      return Response.json(
        {
          ok: false,
          error: `Feishu mindnote image fetch failed: ${result.status} ${result.error}`,
        },
        { status: result.status }
      );
    }

    mindnoteImageCache.set(token, {
      expiresAt: Date.now() + MINDNOTE_IMAGE_CACHE_TTL_MS,
      contentType: result.contentType,
      body: result.body,
    });

    return new Response(result.body, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "private, max-age=600",
      },
    });
  } catch (error) {
    return Response.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
