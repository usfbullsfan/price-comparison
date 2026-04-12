import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

export async function POST(req: NextRequest) {
  const secret = process.env.APP_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "APP_SECRET not configured" }, { status: 500 });
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { password } = body;
  if (!password || typeof password !== "string") {
    return NextResponse.json({ error: "Password required" }, { status: 400 });
  }

  // Timing-safe comparison to prevent timing attacks
  const passwordBuf = Buffer.from(password);
  const secretBuf = Buffer.from(secret);
  const valid =
    passwordBuf.length === secretBuf.length &&
    timingSafeEqual(passwordBuf, secretBuf);

  if (!valid) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set("session_token", secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return response;
}
