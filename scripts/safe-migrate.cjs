/**
 * AI RESEARCH HUB — SAFE DATABASE MIGRATION RUNNER
 *
 * Requirements:
 * 1. Preflight check: Prints target database host and database name WITHOUT exposing credentials.
 * 2. Strict rejection: Rejects remote or production hosts by default.
 * 3. Loopback requirement: Permits migrations ONLY when both DATABASE_URL and DIRECT_URL
 *    point to the authorized loopback Docker database (127.0.0.1 or localhost on port 5432).
 * 4. Zero automatic production migration: No production bypass or automated migration flag.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// Supported prisma commands
const ALLOWED_COMMANDS = {
  deploy: ["prisma", "migrate", "deploy"],
  dev: ["prisma", "migrate", "dev"],
  status: ["prisma", "migrate", "status"],
  push: ["prisma", "db", "push"],
  generate: ["prisma", "generate"],
  validate: ["prisma", "validate"],
  studio: ["prisma", "studio"],
};

const FORBIDDEN_KEYWORDS = [
  "supabase",
  "pooler",
  "aws-",
  "gcp-",
  "azure-",
  "render",
  "neon",
  "railway",
  "cockroach",
  ".supabase.co",
  ".pooler.supabase.com",
];

const ALLOWED_LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1", "[::1]"];
const AUTHORIZED_LOCAL_PORTS = ["5432"];

function sanitizeUrl(urlString) {
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

function runPreflight() {
  const rootDir = path.resolve(__dirname, "..");
  const testEnvPath = path.join(rootDir, ".env.test");

  // Build target environment:
  // If .env.test exists, source default values from .env.test to ensure local isolation.
  // BUT if process.env already has values, inspect what process.env is trying to target.
  let envToUse = { ...process.env };

  if (fs.existsSync(testEnvPath)) {
    const testConfig = dotenv.parse(fs.readFileSync(testEnvPath, "utf8"));
    // Default to testConfig if not explicitly overridden
    if (!envToUse.DATABASE_URL) envToUse.DATABASE_URL = testConfig.DATABASE_URL;
    if (!envToUse.DIRECT_URL) envToUse.DIRECT_URL = testConfig.DIRECT_URL;
  }

  const databaseUrl = envToUse.DATABASE_URL;
  const directUrl = envToUse.DIRECT_URL;

  console.log("\n========================================================");
  console.log("  AI RESEARCH HUB — DATABASE MIGRATION PREFLIGHT GUARD");
  console.log("========================================================");

  if (!databaseUrl) {
    console.error("[PREFLIGHT REJECTED] DATABASE_URL is not set.");
    process.exit(1);
  }

  if (!directUrl) {
    console.error("[PREFLIGHT REJECTED] DIRECT_URL is not set.");
    process.exit(1);
  }

  const dbSanitized = sanitizeUrl(databaseUrl);
  const directSanitized = sanitizeUrl(directUrl);

  if (!dbSanitized) {
    console.error("[PREFLIGHT REJECTED] Unable to parse DATABASE_URL (malformed URL).");
    process.exit(1);
  }
  if (!directSanitized) {
    console.error("[PREFLIGHT REJECTED] Unable to parse DIRECT_URL (malformed URL).");
    process.exit(1);
  }

  // Print sanitized target without credentials
  console.log(`Target DATABASE_URL: Host: ${dbSanitized.host} | Port: ${dbSanitized.port} | DB: ${dbSanitized.database} | Schema: ${dbSanitized.schema}`);
  console.log(`Target DIRECT_URL:   Host: ${directSanitized.host} | Port: ${directSanitized.port} | DB: ${directSanitized.database}`);

  // Check 1: Forbidden host keywords
  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (
      dbSanitized.host.toLowerCase().includes(keyword) ||
      directSanitized.host.toLowerCase().includes(keyword)
    ) {
      console.error(`\n[CRITICAL SECURITY REJECTION] Remote/production database detected!`);
      console.error(`  Keyword match: "${keyword}"`);
      console.error(`  Migrations against remote/cloud databases are STRICTLY FORBIDDEN in development workflows.`);
      console.error(`  Target host: ${dbSanitized.host}`);
      console.error("========================================================\n");
      process.exit(1);
    }
  }

  // Check 2: Loopback whitelist check for BOTH URLs
  const dbIsLoopback = ALLOWED_LOOPBACK_HOSTS.includes(dbSanitized.host.toLowerCase());
  const directIsLoopback = ALLOWED_LOOPBACK_HOSTS.includes(directSanitized.host.toLowerCase());

  if (!dbIsLoopback || !directIsLoopback) {
    console.error(`\n[CRITICAL SECURITY REJECTION] Non-loopback database host:`);
    console.error(`  DATABASE_URL host: "${dbSanitized.host}" (loopback: ${dbIsLoopback})`);
    console.error(`  DIRECT_URL host:   "${directSanitized.host}" (loopback: ${directIsLoopback})`);
    console.error(`  Authorized hosts: ${ALLOWED_LOOPBACK_HOSTS.join(", ")}`);
    console.error("========================================================\n");
    process.exit(1);
  }

  // Check 3: Authorized port check
  if (
    !AUTHORIZED_LOCAL_PORTS.includes(dbSanitized.port) ||
    !AUTHORIZED_LOCAL_PORTS.includes(directSanitized.port)
  ) {
    console.error(`\n[CRITICAL SECURITY REJECTION] Unauthorized database port:`);
    console.error(`  Expected port: 5432 (local Docker PostgreSQL)`);
    console.error(`  Received: db=${dbSanitized.port}, direct=${directSanitized.port}`);
    console.error("========================================================\n");
    process.exit(1);
  }

  console.log("[PREFLIGHT PASSED] Authorized local loopback Docker PostgreSQL confirmed.");
  console.log("========================================================\n");

  return envToUse;
}

function main() {
  const args = process.argv.slice(2);
  const action = args[0] || "status";

  if (!ALLOWED_COMMANDS[action]) {
    console.error(`[ERROR] Unknown migration action: "${action}".`);
    console.error(`Allowed actions: ${Object.keys(ALLOWED_COMMANDS).join(", ")}`);
    process.exit(1);
  }

  const verifiedEnv = runPreflight();

  const command = ALLOWED_COMMANDS[action];
  const extraArgs = args.slice(1);
  const fullArgs = [...command, ...extraArgs];

  console.log(`Executing safe command: npx ${fullArgs.join(" ")}\n`);

  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(npxCmd, fullArgs, {
    env: verifiedEnv,
    stdio: "inherit",
    shell: true,
  });

  if (result.error) {
    console.error("[ERROR] Failed to spawn migration process:", result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 0);
}

main();
