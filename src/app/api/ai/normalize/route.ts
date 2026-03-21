import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getAIProvider } from "@/lib/ai/provider";

/**
 * POST /api/ai/normalize
 * Body: { names: string[], candidates?: string[] }
 * Returns: { results: Record<string, string>, provider: string }
 *
 * Uses AI to normalize messy receipt product names into clean names.
 */
export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const provider = getAIProvider();
  if (!provider) {
    return NextResponse.json(
      { error: "No AI provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env" },
      { status: 503 }
    );
  }

  const body = await req.json();
  const names: string[] = body.names;
  const candidates: string[] | undefined = body.candidates;

  if (!Array.isArray(names) || names.length === 0) {
    return NextResponse.json(
      { error: "Provide a non-empty 'names' array" },
      { status: 400 }
    );
  }

  if (names.length > 50) {
    return NextResponse.json(
      { error: "Maximum 50 names per request" },
      { status: 400 }
    );
  }

  const results = await provider.normalizeProductNames(names, candidates);
  return NextResponse.json({ results, provider: provider.name });
}
