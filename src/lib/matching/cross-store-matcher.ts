/**
 * Cross-store product matcher.
 *
 * When a new product is created from a receipt, this module finds
 * semantically equivalent products from other stores and links them
 * via canonicalProductId.
 *
 * Matching tiers (tried in order):
 *  1. UPC match — exact, instant
 *  2. Attribute match — same productType + similar size
 *  3. AI-assisted match — Claude/Gemini compares attributes
 *
 * Once linked, the canonical group is permanent. This runs once per
 * new product, not on every receipt import.
 */

import { prisma } from "@/lib/db";
import { getAIProvider, type ProductAttributes } from "@/lib/ai/provider";

/**
 * For a newly created product, find cross-store matches and link them
 * via canonicalProductId.
 *
 * @returns the canonicalProductId if a match was found, null otherwise
 */
export async function findAndLinkCrossStoreMatches(
  productId: string
): Promise<string | null> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
  });
  if (!product || product.canonicalProductId) return product?.canonicalProductId ?? null;
  if (!product.productType) return null;

  // Find candidate products from other stores with the same productType
  // that already have prices (meaning they've been seen in receipts)
  const candidates = await prisma.product.findMany({
    where: {
      id: { not: productId },
      productType: product.productType,
      prices: { some: {} },
    },
    include: {
      prices: {
        orderBy: { date: "desc" },
        take: 1,
        select: { store: true },
      },
    },
    take: 20,
  });

  if (candidates.length === 0) return null;

  // Tier 1: UPC match
  if (product.upc) {
    const upcMatch = candidates.find((c) => c.upc === product.upc);
    if (upcMatch) {
      return await linkProducts(product.id, upcMatch);
    }
  }

  // Tier 2: Attribute match — same productType + similar size + compatible brand
  for (const candidate of candidates) {
    const score = attributeMatchScore(product, candidate);
    if (score >= 0.85) {
      return await linkProducts(product.id, candidate);
    }
  }

  // Tier 3: AI-assisted match
  const provider = getAIProvider();
  if (provider && candidates.length > 0) {
    try {
      const sourceAttrs: ProductAttributes = {
        rawName: product.name,
        brand: product.brand ?? undefined,
        productType: product.productType,
        variety: product.variety ?? undefined,
        size: product.size ?? undefined,
        unit: product.unit ?? undefined,
        unitSize: product.unitSize ?? undefined,
        category: product.category ?? undefined,
        isStoreGeneric: product.isStoreGeneric,
      };

      const candidateAttrs: ProductAttributes[] = candidates.map((c) => ({
        rawName: c.name,
        brand: c.brand ?? undefined,
        productType: c.productType ?? "unknown",
        variety: c.variety ?? undefined,
        size: c.size ?? undefined,
        unit: c.unit ?? undefined,
        unitSize: c.unitSize ?? undefined,
        category: c.category ?? undefined,
        isStoreGeneric: c.isStoreGeneric,
      }));

      const matches = await provider.matchProductsAcrossStores(
        sourceAttrs,
        candidateAttrs
      );

      // Take the highest-confidence match
      const bestMatch = matches.sort((a, b) => b.confidence - a.confidence)[0];
      if (bestMatch && bestMatch.confidence >= 0.7) {
        const matchedCandidate = candidates.find(
          (c) => c.name === bestMatch.candidateRawName
        );
        if (matchedCandidate) {
          return await linkProducts(product.id, matchedCandidate);
        }
      }
    } catch {
      // AI failure is non-critical
    }
  }

  return null;
}

/**
 * Score how well two products match based on their attributes.
 * Returns 0-1 confidence.
 */
function attributeMatchScore(
  a: { productType: string | null; size: string | null; unitSize: number | null; isStoreGeneric: boolean; brand: string | null; variety: string | null },
  b: { productType: string | null; size: string | null; unitSize: number | null; isStoreGeneric: boolean; brand: string | null; variety: string | null }
): number {
  if (!a.productType || !b.productType) return 0;
  if (a.productType.toLowerCase() !== b.productType.toLowerCase()) return 0;

  let score = 0.6; // Base score for same productType

  // Size similarity
  if (a.unitSize && b.unitSize) {
    const sizeRatio = Math.min(a.unitSize, b.unitSize) / Math.max(a.unitSize, b.unitSize);
    if (sizeRatio >= 0.9) score += 0.2; // Very similar size
    else if (sizeRatio >= 0.7) score += 0.1; // Somewhat similar
  } else if (a.size && b.size && a.size.toLowerCase() === b.size.toLowerCase()) {
    score += 0.2;
  }

  // Brand compatibility
  if (a.isStoreGeneric && b.isStoreGeneric) {
    score += 0.1; // Store generics from different stores are interchangeable
  } else if (a.brand && b.brand && a.brand.toLowerCase() === b.brand.toLowerCase()) {
    score += 0.15; // Same brand is a strong signal
  }

  // Variety similarity
  if (a.variety && b.variety) {
    if (a.variety.toLowerCase() === b.variety.toLowerCase()) {
      score += 0.05;
    }
  }

  return Math.min(score, 1.0);
}

/**
 * Link a new product to an existing product's canonical group.
 * If the existing product doesn't have a canonical group yet,
 * it becomes its own canonical (self-referencing is fine).
 */
async function linkProducts(
  newProductId: string,
  existingProduct: { id: string; canonicalProductId: string | null }
): Promise<string> {
  const canonicalId = existingProduct.canonicalProductId ?? existingProduct.id;

  // Ensure the existing product points to the canonical
  if (!existingProduct.canonicalProductId) {
    await prisma.product.update({
      where: { id: existingProduct.id },
      data: { canonicalProductId: canonicalId },
    });
  }

  // Link the new product
  await prisma.product.update({
    where: { id: newProductId },
    data: { canonicalProductId: canonicalId },
  });

  return canonicalId;
}
