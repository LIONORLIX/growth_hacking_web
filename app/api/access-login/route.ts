import { NextResponse } from "next/server";
import {
  createAccessToken,
  getAccessCookieMaxAge,
  getAccessCookieName,
  isAccessProtectionEnabled,
} from "@/lib/access-control";

type LoginPayload = {
  password?: string;
};

export async function POST(request: Request) {
  try {
    if (!isAccessProtectionEnabled()) {
      return NextResponse.json({ ok: true, enabled: false });
    }

    const body = (await request.json()) as LoginPayload;
    const inputPassword = (body.password ?? "").trim();
    const configuredPassword = (process.env.ACCESS_PASSWORD ?? "").trim();

    if (!inputPassword || inputPassword !== configuredPassword) {
      return NextResponse.json({ ok: false, error: "密码错误" }, { status: 401 });
    }

    const token = await createAccessToken(inputPassword);
    const response = NextResponse.json({ ok: true, enabled: true });

    response.cookies.set({
      name: getAccessCookieName(),
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: getAccessCookieMaxAge(),
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "登录失败" },
      { status: 500 }
    );
  }
}
