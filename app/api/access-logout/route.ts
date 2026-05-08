import { NextResponse } from "next/server";
import { getAccessCookieName } from "@/lib/access-control";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: getAccessCookieName(),
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
