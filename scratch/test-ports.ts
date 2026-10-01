import { PrismaClient } from "@prisma/client";
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

async function testConnection(url: string, name: string) {
  console.log(`Testing ${name}...`);
  const client = new PrismaClient({
    datasources: {
      db: { url },
    },
  });

  try {
    const start = Date.now();
    const res: any[] = await client.$queryRaw`SELECT 1 as connected;`;
    console.log(`✅ ${name} succeeded in ${Date.now() - start}ms:`, res);
  } catch (err: any) {
    console.error(`❌ ${name} failed:`, err.message);
  } finally {
    await client.$disconnect();
  }
}

async function main() {
  const directUrl = process.env.DIRECT_URL!;
  const databaseUrl = process.env.DATABASE_URL!;

  await testConnection(directUrl, "DIRECT_URL (port 5432)");
  await testConnection(databaseUrl, "DATABASE_URL (port 6543)");
}

main().catch(console.error);
