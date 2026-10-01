import * as fs from "fs";
import * as path from "path";

// Load .env into process.env if not already loaded
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

import { getOpenAIClient } from "../src/lib/ai/config";

async function main() {
  const openai = getOpenAIClient();
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: "AI Research Hub retrieval test",
    encoding_format: "float",
  });

  console.log("Embedding response model:", response.model);
  console.log("Embedding vector length:", response.data[0].embedding.length);
  console.log("Usage:", response.usage);
}

main().catch(err => {
  console.error("Error verifying OpenAI embedding:", err);
  process.exit(1);
});
