import "./load-env";
import { prisma } from "../src/lib/prisma";

async function main() {
  const p6 = await prisma.paper.findUnique({
    where: { id: "cmunxw9il00dnvrus7w9mqij9" },
    include: {
      chunks: { take: 6, orderBy: { chunkIndex: "asc" } },
    },
  });

  const p1 = await prisma.paper.findUnique({
    where: { id: "cmumgtiix0000vr445cn8ry7o" },
    include: {
      chunks: { take: 6, orderBy: { chunkIndex: "asc" } },
    },
  });

  console.log(`=== PAPER 6: ${p6?.title} ===`);
  p6?.chunks.forEach((c) => {
    console.log(`[P6 Chunk ${c.id}] P.${c.pageNumber} (${c.section}):\n${c.text.slice(0, 350)}...\n`);
  });

  console.log(`=== PAPER 1: ${p1?.title} ===`);
  p1?.chunks.forEach((c) => {
    console.log(`[P1 Chunk ${c.id}] P.${c.pageNumber} (${c.section}):\n${c.text.slice(0, 350)}...\n`);
  });
}

main().catch(console.error);
