/**
 * AI RESEARCH HUB — ISOLATED LOCAL DEV SERVER RUNNER
 *
 * Guarantees:
 * 1. Verifies the effective database URL before starting Next.js.
 * 2. Enforces local Docker PostgreSQL (127.0.0.1:5432) and rejects production Supabase.
 * 3. Enforces isolated mock Storage (USE_MOCK_STORAGE=true) so browser interactions
 *    cannot touch live Supabase Storage buckets.
 * 4. Prints sanitized preflight audit before launching next dev.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const rootDir = path.resolve(__dirname, "..");
const testEnvPath = path.join(rootDir, ".env.test");
const defaultEnvPath = path.join(rootDir, ".env");

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

function verifyIsolation() {
  console.log("\n========================================================");
  console.log("  AI RESEARCH HUB — LOCAL DEV ISOLATION PREFLIGHT");
  console.log("========================================================");

  // Start with existing process.env
  let envToUse = { ...process.env };

  // Load .env base if present (for app keys, etc.)
  if (fs.existsSync(defaultEnvPath)) {
    const defaultConfig = dotenv.parse(fs.readFileSync(defaultEnvPath, "utf8"));
    envToUse = { ...defaultConfig, ...envToUse };
  }

  // Force override database URLs with .env.test (strictly local Docker)
  if (fs.existsSync(testEnvPath)) {
    const testConfig = dotenv.parse(fs.readFileSync(testEnvPath, "utf8"));
    envToUse.DATABASE_URL = testConfig.DATABASE_URL;
    envToUse.DIRECT_URL = testConfig.DIRECT_URL;
  } else {
    console.error("[PREFLIGHT REJECTED] .env.test file not found. Local dev isolation requires .env.test.");
    process.exit(1);
  }

  // Enable mock storage to prevent any interaction with live Supabase Storage
  envToUse.USE_MOCK_STORAGE = "true";
  envToUse.ALLOW_MOCK_AUTOCOMPLETE = "true";
  delete envToUse.SUPABASE_SECRET_KEY;
  delete envToUse.SUPABASE_SERVICE_ROLE_KEY;

  const dbSanitized = sanitizeUrl(envToUse.DATABASE_URL);
  const directSanitized = sanitizeUrl(envToUse.DIRECT_URL);

  if (!dbSanitized || !directSanitized) {
    console.error("[PREFLIGHT REJECTED] Invalid or malformed database URLs.");
    process.exit(1);
  }

  console.log(`Effective DATABASE_URL: Host: ${dbSanitized.host} | Port: ${dbSanitized.port} | DB: ${dbSanitized.database}`);
  console.log(`Effective DIRECT_URL:   Host: ${directSanitized.host} | Port: ${directSanitized.port} | DB: ${directSanitized.database}`);
  console.log(`Storage Mode:           ISOLATED MOCK STORAGE (USE_MOCK_STORAGE=true)`);

  // Check 1: Forbidden keywords
  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (
      dbSanitized.host.toLowerCase().includes(keyword) ||
      directSanitized.host.toLowerCase().includes(keyword)
    ) {
      console.error(`\n[CRITICAL SAFETY BLOCK] Production database detected: "${keyword}"!`);
      console.error(`Local development server cannot connect to production Supabase.`);
      process.exit(1);
    }
  }

  // Check 2: Loopback whitelist
  if (
    !ALLOWED_LOOPBACK_HOSTS.includes(dbSanitized.host.toLowerCase()) ||
    !ALLOWED_LOOPBACK_HOSTS.includes(directSanitized.host.toLowerCase())
  ) {
    console.error(`\n[CRITICAL SAFETY BLOCK] Database host must be a local loopback (127.0.0.1 or localhost).`);
    console.error(`Received: ${dbSanitized.host}`);
    process.exit(1);
  }

  console.log("[PREFLIGHT PASSED] Dev server fully isolated to local Docker PostgreSQL.");
  console.log("========================================================\n");

  return envToUse;
}

function main() {
  const verifiedEnv = verifyIsolation();
  const nextCmd = process.platform === "win32" ? "npx.cmd" : "npx";

  console.log("Launching Next.js dev server with isolated local environment...\n");

  const child = spawn(nextCmd, ["next", "dev"], {
    env: verifiedEnv,
    stdio: "inherit",
    shell: true,
  });

  child.on("error", (err) => {
    console.error("[ERROR] Failed to start Next.js dev server:", err.message);
    process.exit(1);
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

main();
