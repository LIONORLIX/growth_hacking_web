import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  getAccessCookieName,
  getExpectedAccessToken,
  isAccessProtectionEnabled,
} from "@/lib/access-control";

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

function buildLoginUrl(request: NextRequest): URL {
  const url = new URL("/access", request.url);
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  url.searchParams.set("next", next);
  return url;
}

export async function proxy(request: NextRequest) {
  if (!isAccessProtectionEnabled()) {
    return NextResponse.next();
  }

  const cookieToken = request.cookies.get(getAccessCookieName())?.value ?? "";
  const expectedToken = await getExpectedAccessToken();
  const authorized = Boolean(expectedToken && cookieToken === expectedToken);

  if (authorized) {
    return NextResponse.next();
  }

  if (isApiPath(request.nextUrl.pathname)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.redirect(buildLoginUrl(request));
}

export const config = {
  matcher: [
    "/lark_growth_design_playbook/:path*",
    "/article/:path*",
    "/api/playbook/:path*",
    "/api/article/:path*",
    "/api/feishu-image/:path*",
    "/api/feishu-board-image/:path*",
    "/api/feishu-mindnote-image/:path*",
  ],
};
