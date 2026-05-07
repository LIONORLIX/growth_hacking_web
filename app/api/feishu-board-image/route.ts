import { getTenantAccessToken } from "@/lib/feishu/auth";

const BOARD_IMAGE_CACHE_TTL_MS = 10 * 60 * 1000;
const BOARD_IMAGE_CACHE_CONTROL_HEADER =
  "public, max-age=300, s-maxage=600, stale-while-revalidate=86400";
const boardImageCache = new Map<
  string,
  { expiresAt: number; contentType: string; body: ArrayBuffer }
>();

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

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
      return Response.json(
        { ok: false, error: "Missing board token" },
        { status: 400 }
      );
    }

    const cached = boardImageCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return new Response(cached.body, {
        status: 200,
        headers: {
          "Content-Type": cached.contentType,
          "Cache-Control": BOARD_IMAGE_CACHE_CONTROL_HEADER,
        },
      });
    }

    const tenantToken = await getTenantAccessToken();
    const upstream = await fetch(
      `https://open.feishu.cn/open-apis/board/v1/whiteboards/${encodeURIComponent(
        token
      )}/download_as_image`,
      {
        headers: {
          Authorization: `Bearer ${tenantToken}`,
        },
        cache: "no-store",
      }
    );

    if (!upstream.ok) {
      const errText = await upstream.text();
      return Response.json(
        {
          ok: false,
          error: `Feishu board image fetch failed: ${upstream.status} ${errText}`,
        },
        { status: upstream.status }
      );
    }

    const arrayBuffer = await upstream.arrayBuffer();
    const body = arrayBuffer;
    const contentType =
      upstream.headers.get("content-type") ?? "application/octet-stream";

    boardImageCache.set(token, {
      expiresAt: Date.now() + BOARD_IMAGE_CACHE_TTL_MS,
      contentType,
      body,
    });

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": BOARD_IMAGE_CACHE_CONTROL_HEADER,
      },
    });
  } catch (error) {
    return Response.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
