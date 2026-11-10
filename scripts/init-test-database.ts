/**
 * AI RESEARCH HUB — EXPLICIT TEST DATABASE INITIALIZATION SCRIPT
 *
 * This script initializes the disposable marker in the isolated test database:
 * - Strictly verifies host is loopback (127.0.0.1, localhost, ::1)
 * - Strictly verifies database name is exactly 'ai_research_hub_test'
 * - Creates table `_disposable_test_marker` and inserts the disposable verification marker.
 *
 * It MUST NEVER run against the development database 'ai_research_hub' or any production/remote database.
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// Explicitly load .env.test if present to guarantee isolated test configuration
const testEnvPath = path.resolve(process.cwd(), ".env.test");
if (fs.existsSync(testEnvPath)) {
  dotenv.config({ path: testEnvPath, override: true });
}

export async function initTestDatabase(databaseUrl?: string): Promise<{ success: boolean; message: string }> {
  const urlString =
    databaseUrl ||
    process.env.TEST_DATABASE_URL ||
    (process.env.DATABASE_URL && process.env.DATABASE_URL.includes("ai_research_hub_test")
      ? process.env.DATABASE_URL
      : "postgresql://postgres:postgres@127.0.0.1:5432/ai_research_hub_test?schema=public");

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch (err: any) {
    throw new Error(`[INIT-TEST-DB] Invalid database connection URL: ${err.message}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLoopback =
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]";

  if (!isLoopback) {
    throw new Error(
      `[CRITICAL SAFETY VIOLATION] Host '${hostname}' is not a local loopback address. ` +
      `Test database initialization is strictly prohibited on non-local hosts.`
    );
  }

  const rawPath = parsed.pathname.replace(/^\//, "");
  const dbName = rawPath.split("?")[0].toLowerCase();

  if (dbName !== "ai_research_hub_test") {
    throw new Error(
      `[CRITICAL SAFETY VIOLATION] Database name '${dbName}' is NOT 'ai_research_hub_test'. ` +
      `Test database marker initialization is strictly prohibited on '${dbName}'.`
    );
  }

  const prisma = new PrismaClient({
    datasources: {
      db: { url: urlString },
    },
  });

  try {
    // Double check connected database name directly from PostgreSQL server
    const dbInfo = await prisma.$queryRawUnsafe<Array<{ current_database: string }>>(
      `SELECT current_database()`
    );
    const connectedDb = dbInfo[0]?.current_database || "";

    if (connectedDb !== "ai_research_hub_test") {
      throw new Error(
        `[CRITICAL SAFETY VIOLATION] Connected database is '${connectedDb}', not 'ai_research_hub_test'. Aborting.`
      );
    }

    // Create marker table and record
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "_disposable_test_marker" (
        marker_key TEXT PRIMARY KEY,
        test_db TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "_disposable_test_marker" (marker_key, test_db)
      VALUES ('DISPOSABLE_TEST_DATABASE_V1', 'ai_research_hub_test')
      ON CONFLICT (marker_key) DO UPDATE SET test_db = EXCLUDED.test_db, created_at = NOW();
    `);

    const msg = `✔ Successfully initialized disposable test database marker in 'ai_research_hub_test' on ${hostname}.`;
    console.log(msg);
    return { success: true, message: msg };
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module || (process.argv[1] && process.argv[1].endsWith("init-test-database.ts"))) {
  initTestDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}

