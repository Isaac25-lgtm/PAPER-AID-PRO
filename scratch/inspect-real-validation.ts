import "./load-env";
import { prisma } from "../src/lib/prisma";

async function main() {
  const paperIds = [
    "cmumgtiix0000vr445cn8ry7o", // Magnuska et al. (Cancers 2022)
    "cmunotrr10000vrusnqyv61ut", // Su et al. (BMC Med Imaging 2026)
    "cmunwm6m2004ivrusrlr89j95", // Kim et al. (Appl Sci 2021)
    "cmunwvfkr006uvrus0m3ky4wn", // Zakareya et al. (Diagnostics 2023)
    "cmunxiwf900blvruskrclq381", // Lee et al. (Sensors 2023)
    "cmunxw9il00dnvrus7w9mqij9", // Li et al. (Frontiers 2025)
  ];

  console.log("=== INSPECTING VALIDATION IN 6 REAL PAPERS ===");

  for (const id of paperIds) {
    const paper = await prisma.paper.findUnique({
      where: { id },
      select: { id: true, title: true, journal: true },
    });

    // Search for chunks matching validation keywords
    const validationChunks = await prisma.paperChunk.findMany({
      where: {
        paperId: id,
        OR: [
          { text: { contains: "validation", mode: "insensitive" } },
          { text: { contains: "multicenter", mode: "insensitive" } },
          { text: { contains: "multi-center", mode: "insensitive" } },
          { text: { contains: "external", mode: "insensitive" } },
          { text: { contains: "cohort", mode: "insensitive" } },
          { text: { contains: "cross-validation", mode: "insensitive" } },
        ],
      },
      select: { id: true, chunkIndex: true, pageNumber: true, section: true, text: true },
      take: 4,
    });

    console.log(`\n--------------------------------------------------`);
    console.log(`Paper: [${id}] "${paper?.title}"`);
    console.log(`Validation chunks found: ${validationChunks.length}`);
    for (const c of validationChunks) {
      console.log(`  Chunk ${c.id} (P.${c.pageNumber}, ${c.section}):`);
      const lines = c.text.split("\n").filter((l) =>
        /validation|multicenter|multi-center|external|cohort|cross-validation/i.test(l)
      );
      console.log(`    Matching snippet: ${lines.slice(0, 3).join(" ... ")}`);
    }
  }
}

main().catch(console.error);
