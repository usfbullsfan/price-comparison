import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    build: process.env.NEXT_PUBLIC_BUILD_SHA ?? "unknown",
    uptime: process.uptime(),
  });
}
