/**
 * Simple API key authentication for protecting AI-powered endpoints.
 *
 * Usage in route handlers:
 *   const authError = requireAuth(request);
 *   if (authError) return authError;
 *
 * The API key is checked against APP_SECRET in .env.
 * Pass it via:
 *   - Header: Authorization: Bearer <key>
 *   - Header: X-API-Key: <key>
 *
 * In development (NODE_ENV !== "production"), auth is optional —
 * requests without a key are allowed so you can test easily.
 */

import { NextRequest, NextResponse } from "next/server";

export function requireAuth(req: NextRequest): NextResponse | null {
  const secret = process.env.APP_SECRET;

  // If no secret configured, skip auth
  if (!secret) return null;

  // In development, auth is optional
  if (process.env.NODE_ENV !== "production") return null;

  const authHeader = req.headers.get("authorization");
  const apiKeyHeader = req.headers.get("x-api-key");

  const token =
    authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : apiKeyHeader;

  if (!token || token !== secret) {
    return NextResponse.json(
      { error: "Unauthorized. Provide a valid API key via Authorization: Bearer <key> or X-API-Key header." },
      { status: 401 }
    );
  }

  return null;
}
