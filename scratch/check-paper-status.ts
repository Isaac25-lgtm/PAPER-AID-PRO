import "./load-env";
import { prisma } from "../src/lib/prisma";

async function main() {
  const papers = await prisma.paper.findMany({
    select: { id: true, title: true, status: true, storagePath: true },
    orderBy: { createdAt: "desc" }
  });
  console.log("PAPER STATUSES:");
  for (const p of papers) {
    console.log(`[${p.id}] status=${p.status} path=${p.storagePath ? "yes" : "no"} title="${p.title.slice(0, 60)}"`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
