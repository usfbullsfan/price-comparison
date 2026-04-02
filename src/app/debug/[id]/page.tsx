import { prisma } from "@/lib/db";
import { CopyButton } from "@/components/CopyButton";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ReceiptDebugPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;

  const receipt = await prisma.receipt.findUnique({
    where: { id },
    include: {
      lineItems: {
        orderBy: { createdAt: "asc" },
        include: {},
      },
      items: {
        orderBy: { date: "desc" },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              normalizedName: true,
              brand: true,
              size: true,
              unit: true,
              upc: true,
              category: true,
            },
          },
        },
      },
    },
  });

  if (!receipt) {
    notFound();
  }

  // Collect unique products linked via prices
  const productsMap = new Map<string, typeof receipt.items[0]["product"]>();
  for (const price of receipt.items) {
    if (!productsMap.has(price.productId)) {
      productsMap.set(price.productId, price.product);
    }
  }

  const data = {
    receipt: {
      id: receipt.id,
      source: receipt.source,
      store: receipt.store,
      status: receipt.status,
      purchaseDate: receipt.purchaseDate,
      total: receipt.total,
      taxAmount: receipt.taxAmount,
      createdAt: receipt.createdAt,
      parsedAt: receipt.parsedAt,
      parseError: receipt.parseError,
    },
    rawInput: {
      content: receipt.rawContent,
      metadata: receipt.rawMetadata,
    },
    debugTrace: receipt.debugData ?? null,
    debugExpiresAt: receipt.debugExpiresAt,
    finalData: {
      lineItems: receipt.lineItems.map((li) => ({
        id: li.id,
        rawName: li.rawName,
        price: li.price,
        quantity: li.quantity,
        weight: li.weight,
        onSale: li.onSale,
        salePrice: li.salePrice,
        saleType: li.saleType,
        upc: li.upc,
        matched: li.matched,
        productId: li.productId,
      })),
      products: Array.from(productsMap.values()),
      prices: receipt.items.map((p) => ({
        id: p.id,
        productId: p.productId,
        store: p.store,
        price: p.price,
        salePrice: p.salePrice,
        onSale: p.onSale,
        saleType: p.saleType,
        unitPrice: p.unitPrice,
        date: p.date,
      })),
    },
  };

  const jsonText = JSON.stringify(data, null, 2);

  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <div style={{ marginBottom: "1rem" }}>
        <h1 style={{ margin: 0 }}>Receipt Debug Data</h1>
        <p style={{ color: "#666", margin: "0.5rem 0" }}>
          Receipt <strong>{receipt.id}</strong> &mdash;{" "}
          {receipt.createdAt.toISOString()}
        </p>
        <CopyButton text={jsonText} />
      </div>
      <pre
        style={{
          background: "#f5f5f5",
          padding: "1rem",
          borderRadius: "4px",
          overflow: "auto",
          fontSize: "13px",
          lineHeight: 1.4,
        }}
      >
        {jsonText}
      </pre>
    </div>
  );
}
