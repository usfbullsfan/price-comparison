import { PrismaClient, Store } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Example products — replace with real data
  const products = await Promise.all([
    prisma.product.upsert({
      where: { upc: "041130336027" },
      update: {},
      create: {
        name: "Publix Whole Milk",
        normalizedName: "publix whole milk",
        brand: "Publix",
        size: "1 gal",
        unit: "gal",
        unitSize: 128, // oz
        upc: "041130336027",
        category: "Dairy",
      },
    }),
  ]);

  console.log(`Seeded ${products.length} products`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
