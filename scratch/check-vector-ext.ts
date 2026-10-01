import { prisma } from "../src/lib/prisma";

async function main() {
  const result: any[] = await prisma.$queryRaw`
    SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
  `;
  console.log("Vector extension query result:", result);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error("Error checking vector extension:", err);
  process.exit(1);
});
