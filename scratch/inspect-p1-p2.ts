import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const papers = await prisma.paper.findMany({
    where: {
      id: { in: ["cmugxsj280000vrpontgz0vlf", "cmugydswv0003vrpoassf36yi"] }
    },
    select: {
      id: true,
      title: true,
      status: true,
      pdfUrl: true,
      storagePath: true,
      createdAt: true,
    }
  });
  console.log(JSON.stringify(papers, null, 2));
}

main().finally(() => prisma.$disconnect());
