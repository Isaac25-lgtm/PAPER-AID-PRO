/**
 * AI RESEARCH HUB — ISOLATED LOCAL DATABASE SCRIPT RUNNER
 *
 * Guarantees:
 * 1. Strictly forces process.env.DATABASE_URL and DIRECT_URL to local Docker PostgreSQL (127.0.0.1:5432) from .env.test.
 * 2. Neutralizes and strips all remote Supabase keys and production credentials.
 * 3. Enforces mock Storage (USE_MOCK_STORAGE=true) to prevent cloud bucket mutation.
 * 4. Fails closed and aborts execution if any remote host or forbidden keyword is detected.
 * 5. Safely executes target script or inline command under the verified loopback environment.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const rootDir = path.resolve(__dirname, "..");
const testEnvPath = path.join(rootDir, ".env.test");

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

function verifyAndBuildEnvironment() {
  console.log("\n========================================================");
  console.log("  AI RESEARCH HUB — ISOLATED LOCAL SCRIPT PREFLIGHT");
  console.log("========================================================");

  if (!fs.existsSync(testEnvPath)) {
    console.error("[PREFLIGHT REJECTED] .env.test not found. Local script runner requires .env.test.");
    process.exit(1);
  }

  const testConfig = dotenv.parse(fs.readFileSync(testEnvPath, "utf8"));
  const envToUse = { ...process.env };

  // Enforce loopback Docker database URLs from .env.test
  envToUse.DATABASE_URL = testConfig.DATABASE_URL;
  envToUse.DIRECT_URL = testConfig.DIRECT_URL;
  envToUse.NODE_ENV = "test";
  envToUse.USE_MOCK_STORAGE = "true";

  // Neutralize remote production keys
  delete envToUse.SUPABASE_SECRET_KEY;
  delete envToUse.SUPABASE_SERVICE_ROLE_KEY;

  const dbSanitized = sanitizeUrl(envToUse.DATABASE_URL);
  const directSanitized = sanitizeUrl(envToUse.DIRECT_URL);

  if (!dbSanitized || !directSanitized) {
    console.error("[PREFLIGHT REJECTED] Malformed or missing database URLs in .env.test.");
    process.exit(1);
  }

  // Print sanitized target without credentials
  console.log(`Target DATABASE_URL: Host: ${dbSanitized.host} | Port: ${dbSanitized.port} | DB: ${dbSanitized.database}`);
  console.log(`Target DIRECT_URL:   Host: ${directSanitized.host} | Port: ${directSanitized.port} | DB: ${directSanitized.database}`);
  console.log(`Storage Mode:        ISOLATED MOCK STORAGE (USE_MOCK_STORAGE=true)`);

  // Check 1: Forbidden keywords
  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (
      dbSanitized.host.toLowerCase().includes(keyword) ||
      directSanitized.host.toLowerCase().includes(keyword)
    ) {
      console.error(`\n[CRITICAL SAFETY BLOCK] Remote database keyword detected: "${keyword}"!`);
      console.error("Local script execution against remote/production databases is strictly forbidden.");
      process.exit(1);
    }
  }

  // Check 2: Loopback whitelist
  if (
    !ALLOWED_LOOPBACK_HOSTS.includes(dbSanitized.host.toLowerCase()) ||
    !ALLOWED_LOOPBACK_HOSTS.includes(directSanitized.host.toLowerCase())
  ) {
    console.error(`\n[CRITICAL SAFETY BLOCK] Database host must be local loopback (127.0.0.1 or localhost).`);
    console.error(`Received: ${dbSanitized.host}`);
    process.exit(1);
  }

  // Check 3: Port check
  if (
    !AUTHORIZED_LOCAL_PORTS.includes(dbSanitized.port) ||
    !AUTHORIZED_LOCAL_PORTS.includes(directSanitized.port)
  ) {
    console.error(`\n[CRITICAL SAFETY BLOCK] Database port must be 5432 (local Docker PostgreSQL).`);
    console.error(`Received: ${dbSanitized.port}`);
    process.exit(1);
  }

  console.log("[PREFLIGHT PASSED] Script isolated strictly to local Docker PostgreSQL.");
  console.log("========================================================\n");

  return envToUse;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: node scripts/run-isolated-db.cjs <script-path> [args...]");
    console.error("   or: node scripts/run-isolated-db.cjs -e \"<code>\"");
    process.exit(1);
  }

  const isolatedEnv = verifyAndBuildEnvironment();

  let cmd;
  let cmdArgs;

  if (args[0] === "-e") {
    cmd = process.platform === "win32" ? "node.exe" : "node";
    const code = args.slice(1).join(" ");
    cmdArgs = ["-e", code];
  } else if (args[0].endsWith(".ts")) {
    cmd = process.platform === "win32" ? "npx.cmd" : "npx";
    cmdArgs = ["tsx", ...args];
  } else {
    cmd = process.platform === "win32" ? "node.exe" : "node";
    cmdArgs = args;
  }

  const result = spawnSync(cmd, cmdArgs, {
    env: isolatedEnv,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    console.error("[ERROR] Failed to execute isolated script:", result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 0);
}

main();
