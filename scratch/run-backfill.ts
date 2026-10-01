import * as fs from "fs";
import * as path from "path";

// Load .env
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

import { prisma } from "../src/lib/prisma";
import { backfillCorpusEmbeddings } from "../src/lib/ai/embedding-pipeline";

async function main() {
  console.log("Backfilling corpus embeddings for all remaining papers...");
  const result = await backfillCorpusEmbeddings();
  console.log("Backfill result:", result);

  const totalChunksWithEmbedding: any[] = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM paper_chunks WHERE embedding IS NOT NULL;
  `;
  console.log(`Total chunks embedded in database: ${totalChunksWithEmbedding[0]?.count}`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
