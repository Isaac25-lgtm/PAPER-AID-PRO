import "./load-env";
import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("==========================================================");
  console.log("PHASE 10: 12-CLAIM GROUND-TRUTH PDF AUDIT");
  console.log("==========================================================\n");

  const chunkIds = [
    "cmumgu5fb002pvr44qni8eswc", // Paper 1 (Cancers 2022) P.14
    "cmumgu5fb0035vr44i816sqko", // Paper 1 (Cancers 2022) P.18
    "cmunou2gs0019vrustty6cuo0", // Paper 2 (BMC Med Imaging) P.5
    "cmunwmok5005hvrusov8p89n9", // Paper 3 (Appl Sci 2021) P.2
    "cmunwmok9006nvrusepnqq3qk", // Paper 3 (Appl Sci 2021) P.13
    "cmunwvp49007pvrusvp1fi71b", // Paper 4 (Diagnostics 2023) P.3
    "cmunxj7kt00d7vrusq5qiy4pj", // Paper 5 (Sensors 2023) P.10
  ];

  const chunks = await prisma.paperChunk.findMany({
    where: { id: { in: chunkIds } },
    include: {
      paper: {
        select: {
          id: true,
          title: true,
          doi: true,
          journal: true,
          storagePath: true,
        },
      },
    },
  });

  console.log(`Found ${chunks.length} chunks in database.\n`);

  for (const c of chunks) {
    console.log("----------------------------------------------------------");
    console.log(`CHUNK ID: ${c.id}`);
    console.log(`PAPER: [${c.paper.id}] ${c.paper.title}`);
    console.log(`JOURNAL: ${c.paper.journal} | DOI: ${c.paper.doi}`);
    console.log(`PAGE: ${c.pageNumber} | SECTION: ${c.section}`);
    console.log(`STORAGE PATH: ${c.paper.storagePath}`);
    console.log(`VERBATIM TEXT:\n${c.text}`);
    console.log("----------------------------------------------------------\n");
  }

  // Let's also check other chunks from these 4 papers to construct 12 full claim audits
  const additionalChunks = await prisma.paperChunk.findMany({
    where: {
      paperId: {
        in: [
          "cmumgtiix0000vr445cn8ry7o", // Paper 1
          "cmunou2gs0019vrustty6cuo0".slice(0, 0), // (will use paperId)
          "cmunwm6m2004ivrusrlr89j95", // Paper 3
          "cmunwvfkr006uvrus0m3ky4wn", // Paper 4
          "cmunxw9il00dnvrus7w9mqij9", // Paper 6 (Multimodal US BI-RADS 4)
        ],
      },
    },
    take: 15,
    include: {
      paper: {
        select: { id: true, title: true, doi: true, journal: true },
      },
    },
  });

  console.log(`Loaded ${additionalChunks.length} additional chunks for comprehensive multi-paper audit.`);
}

main().catch(console.error);
