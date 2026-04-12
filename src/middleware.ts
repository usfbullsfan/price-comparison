import { NextRequest, NextResponse } from "next/server";

/**
 * Middleware that protects all pages and API routes behind a simple
 * password gate. The password is APP_SECRET from the environment.
 *
 * Excluded from auth:
 *  - /login (the login page itself)
 *  - /api/auth/* (login/logout endpoints)
 *  - /api/receipts/email (Resend webhook — has its own HMAC auth)
 *  - /api/health (uptime checks)
 *  - /_next/* and static files (Next.js internals)
 */

const PUBLIC_PATHS = [
  "/login",
  "/api/auth",
  "/api/receipts/email",
  "/api/health",
  "/_next",
  "/favicon.ico",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Skip auth for public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const secret = process.env.APP_SECRET;

  // If no secret is configured, skip auth entirely (local dev)
  if (!secret) {
    return NextResponse.next();
  }

  // Check for valid session cookie
  const sessionToken = req.cookies.get("session_token")?.value;
  if (sessionToken && sessionToken === secret) {
    return NextResponse.next();
  }

  // For API routes, return 401 JSON
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // For pages, redirect to login
  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("redirect", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Match all routes except static files
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
