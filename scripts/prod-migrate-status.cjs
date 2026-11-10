/**
 * AI RESEARCH HUB — READ-ONLY PRODUCTION MIGRATION STATUS CHECK
 *
 * Requirements:
 * 1. Strictly READ-ONLY: Executes only `prisma migrate status` (never deploy, dev, or push).
 * 2. Explicit Opt-In Confirmation: Requires typing the exact project ref from DIRECT_URL.
 * 3. Uses DIRECT_URL session connection (port 5432) needed by Prisma migrate status.
 * 4. Never prints credentials or secret URLs.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const dotenv = require("dotenv");

function parseUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    return {
      host: parsed.hostname,
      port: parsed.port || "5432",
      database: parsed.pathname.replace(/^\//, ""),
      schema: parsed.searchParams.get("schema") || "public",
    };
  } catch (err) {
    return null;
  }
}

async function main() {
  const rootDir = path.resolve(__dirname, "..");
  const envPath = path.join(rootDir, ".env");

  let envToUse = { ...process.env };
  if (fs.existsSync(envPath)) {
    const parsedEnv = dotenv.parse(fs.readFileSync(envPath, "utf8"));
    if (!envToUse.DIRECT_URL && parsedEnv.DIRECT_URL) {
      envToUse.DIRECT_URL = parsedEnv.DIRECT_URL;
    }
    if (!envToUse.DATABASE_URL && parsedEnv.DATABASE_URL) {
      envToUse.DATABASE_URL = parsedEnv.DATABASE_URL;
    }
  }

  const directUrl = envToUse.DIRECT_URL;
  if (!directUrl) {
    console.error("[ERROR] DIRECT_URL is not set in environment or .env");
    process.exit(1);
  }

  const directSanitized = parseUrl(directUrl);
  if (!directSanitized) {
    console.error("[ERROR] DIRECT_URL is malformed.");
    process.exit(1);
  }

  // Extract expected project ref from username or hostname
  let expectedProjectRef = "";
  try {
    const parsed = new URL(directUrl);
    const userParts = parsed.username.split(".");
    if (userParts.length > 1) {
      expectedProjectRef = userParts[1];
    } else {
      const hostParts = parsed.hostname.split(".");
      expectedProjectRef = hostParts[0];
    }
  } catch {
    expectedProjectRef = directSanitized.host;
  }

  console.log("\n========================================================");
  console.log("  AI RESEARCH HUB — READ-ONLY PRODUCTION MIGRATION STATUS");
  console.log("========================================================");
  console.log(`Target Host: ${directSanitized.host}`);
  console.log(`Target Port: ${directSanitized.port}`);
  console.log(`Target DB:   ${directSanitized.database}`);
  console.log(`Command:     prisma migrate status (STRICTLY READ-ONLY)`);
  console.log("--------------------------------------------------------");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const promptText = expectedProjectRef
    ? `Type the Supabase project reference to proceed [${expectedProjectRef}]: `
    : `Type the target hostname to proceed [${directSanitized.host}]: `;

  const expectedMatch = expectedProjectRef || directSanitized.host;

  const answer = await new Promise((resolve) => {
    rl.question(promptText, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });

  if (answer !== expectedMatch) {
    console.error("\n[ABORTED] Project reference did not match. Aborting.");
    process.exit(1);
  }

  console.log("\nConnecting to production via DIRECT_URL for read-only status check...\n");

  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  // Prisma migrate status requires DATABASE_URL to point to direct session connection
  const checkEnv = {
    ...envToUse,
    DATABASE_URL: directUrl,
  };

  const result = spawnSync(npxCmd, ["prisma", "migrate", "status"], {
    env: checkEnv,
    stdio: "inherit",
    shell: true,
  });

  process.exit(result.status ?? 0);
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});

