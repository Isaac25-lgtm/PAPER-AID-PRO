import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// Mock server-only package for standalone tsx test runners
try {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
  } as any;
} catch (e) {
  // ignore
}

import { setStorageClientOverride } from "./storage";

/**
 * AI RESEARCH HUB — ENHANCED FAIL-CLOSED TEST ISOLATION GUARD
 *
 * Guarantees:
 * 1. Database whitelist: ONLY loopback hosts (127.0.0.1, localhost, ::1).
 *    Explicitly rejects 0.0.0.0 and all remote or production hosts.
 * 2. Storage safety guard: Prohibits tests from using the production Supabase
 *    URL, production service key, or live research-papers bucket.
 * 3. Enforces mock in-memory Storage for local tests.
 */

export interface TestIsolationVerification {
  isIsolated: boolean;
  hostname: string;
  port: string;
  database: string;
  storageIsolated: boolean;
}

export const FORBIDDEN_WORKING_DATABASES = [
  "ai_research_hub",
  "postgres",
  "template0",
  "template1",
];

export const ALLOWED_DISPOSABLE_DATABASES = [
  "ai_research_hub_test",
  "ai_research_hub_rehearsal_clone",
];

export function isAllowedDisposableDatabase(dbName: string): boolean {
  const lower = dbName.toLowerCase();
  if (FORBIDDEN_WORKING_DATABASES.includes(lower)) return false;
  if (ALLOWED_DISPOSABLE_DATABASES.includes(lower)) return true;
  return lower.endsWith("_test") || lower.endsWith("_clone") || lower.endsWith("_disposable");
}

// In-memory mock storage repository
const mockStorageBuckets = new Map<string, Map<string, Buffer>>();

export function createMockStorageClient() {
  return {
    storage: {
      from(bucketName: string) {
        if (!mockStorageBuckets.has(bucketName)) {
          mockStorageBuckets.set(bucketName, new Map<string, Buffer>());
        }
        const bucket = mockStorageBuckets.get(bucketName)!;

        return {
          _bucket: bucket,
          has: (filePath: string) => {
            const clean = filePath.replace(/^[\\/]+/, "");
            return bucket.has(clean) || bucket.has(filePath);
          },
          upload: async (
            filePath: string,
            fileBody: Buffer | Uint8Array,
            _options?: any
          ) => {
            const clean = filePath.replace(/^[\\/]+/, "");
            const buf = Buffer.isBuffer(fileBody) ? fileBody : Buffer.from(fileBody);
            bucket.set(clean, buf);
            bucket.set(filePath, buf);
            return { data: { path: filePath }, error: null };
          },

          download: async (filePath: string) => {
            if (!bucket.has(filePath)) {
              return {
                data: null,
                error: { message: `Object not found in mock storage: ${filePath}` },
              };
            }
            const buf = bucket.get(filePath)!;
            return {
              data: {
                arrayBuffer: async () =>
                  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
              },
              error: null,
            };
          },

          remove: async (filePaths: string[]) => {
            for (const p of filePaths) {
              bucket.delete(p);
            }
            return { data: filePaths, error: null };
          },
        };
      },
    },
  };
}

let mockStorageInstalled = false;

export function enableMockStorage(): void {
  const mockClient = createMockStorageClient();
  setStorageClientOverride(mockClient);
  mockStorageInstalled = true;
}

export function resetMockStorage(): void {
  mockStorageBuckets.clear();
}

/**
 * Asserts that the active database configuration is strictly an isolated local loopback
 * and connects to an authorized disposable test/clone database (NEVER the working database).
 */
export function assertIsolatedDatabaseEnvironment(): {
  hostname: string;
  port: string;
  database: string;
} {
  const dbUrlsToCheck: { name: string; url: string | undefined }[] = [
    { name: "DATABASE_URL", url: process.env.DATABASE_URL },
    { name: "DIRECT_URL", url: process.env.DIRECT_URL },
  ];

  const forbiddenKeywords = [
    "supabase",
    "pooler",
    "aws-",
    "gcp-",
    "azure-",
    "render",
    "neon",
    "railway",
    "cockroach",
  ];

  const allowedLoopbackHosts = ["127.0.0.1", "localhost", "::1", "[::1]"];
  let resolvedHost = "127.0.0.1";
  let resolvedPort = "5432";
  let resolvedDatabase = "";

  for (const { name, url } of dbUrlsToCheck) {
    if (!url) {
      if (name === "DATABASE_URL") {
        throw new Error(
          `[FAIL-CLOSED GUARD] ${name} is not configured. Execution blocked.`
        );
      }
      continue;
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (err: any) {
      throw new Error(
        `[FAIL-CLOSED GUARD] Malformed ${name}: ${err.message}. Execution blocked.`
      );
    }

    const host = parsed.hostname.toLowerCase();
    const rawDb = parsed.pathname.replace(/^\//, "");
    const dbName = rawDb.toLowerCase();

    // 1. Explicit blacklist
    for (const keyword of forbiddenKeywords) {
      if (host.includes(keyword)) {
        throw new Error(
          `\n====================================================================\n` +
          `[CRITICAL SECURITY VIOLATION] FAIL-CLOSED TEST GUARD TRIGGERED!\n` +
          `${name} host "${host}" is identified as a remote/cloud service.\n` +
          `Write-enabled integration tests are strictly prohibited from executing\n` +
          `against remote production infrastructure.\n\n` +
          `REQUIRED ACTION:\n` +
          `Run tests with isolated local Docker PostgreSQL (127.0.0.1:5432).\n` +
          `====================================================================\n`
        );
      }
    }

    // 2. Strict loopback whitelist
    if (!allowedLoopbackHosts.includes(host)) {
      throw new Error(
        `\n====================================================================\n` +
        `[CRITICAL SECURITY VIOLATION] FAIL-CLOSED TEST GUARD TRIGGERED!\n` +
        `${name} host "${host}" is not an authorized local loopback host.\n` +
        `Only loopback hosts (127.0.0.1, localhost, ::1) are permitted for tests.\n` +
        `Rejected host: "${host}" (0.0.0.0 and remote hosts are strictly denied).\n` +
        `====================================================================\n`
      );
    }

    // 3. Reject working and system databases
    if (FORBIDDEN_WORKING_DATABASES.includes(dbName)) {
      throw new Error(
        `\n====================================================================\n` +
        `[CRITICAL TEST SAFETY VIOLATION] FAIL-CLOSED TEST GUARD TRIGGERED!\n` +
        `${name} targets forbidden working/system database "${rawDb}".\n` +
        `Integration tests and test runners are strictly prohibited from mutating "${rawDb}".\n` +
        `A loopback address alone cannot distinguish working from test databases.\n\n` +
        `REQUIRED ACTION:\n` +
        `Configure DATABASE_URL to a dedicated disposable database (e.g. ai_research_hub_test).\n` +
        `====================================================================\n`
      );
    }

    // 4. Require authorized disposable database name pattern
    if (!isAllowedDisposableDatabase(dbName)) {
      throw new Error(
        `\n====================================================================\n` +
        `[CRITICAL TEST SAFETY VIOLATION] FAIL-CLOSED TEST GUARD TRIGGERED!\n` +
        `${name} database "${rawDb}" is not recognized as a disposable test database.\n` +
        `Allowed databases: ${ALLOWED_DISPOSABLE_DATABASES.join(", ")} or names ending with _test/_clone/_disposable.\n` +
        `====================================================================\n`
      );
    }

    if (name === "DATABASE_URL") {
      resolvedHost = host;
      resolvedPort = parsed.port || "5432";
      resolvedDatabase = rawDb;
    }
  }

  return {
    hostname: resolvedHost,
    port: resolvedPort,
    database: resolvedDatabase,
  };
}

/**
 * Asserts that the connected database contains a verified disposable-database marker
 * before any write operations or mutation tests.
 */
export async function assertDisposableDatabaseMarker(prismaClient: any): Promise<{
  dbName: string;
  markerKey: string;
  testDb: string;
  serverAddr: string | null;
  serverPort: number | null;
}> {
  const connRows = await prismaClient.$queryRawUnsafe(
    `SELECT current_database() AS db_name, inet_server_addr()::text AS server_addr, inet_server_port()::int AS server_port`
  );
  const conn = connRows[0];
  if (!conn || !conn.db_name) {
    throw new Error("[FAIL-CLOSED GUARD] Unable to query current_database(). Aborting before mutations.");
  }

  const dbName = String(conn.db_name);

  // Check forbidden working database
  if (FORBIDDEN_WORKING_DATABASES.includes(dbName.toLowerCase())) {
    throw new Error(
      `[CRITICAL TEST SAFETY VIOLATION] Connected database is '${dbName}' (the working development database). ` +
      `A loopback address (${conn.server_addr}:${conn.server_port}) cannot distinguish databases. ` +
      `All test writes and mutations to '${dbName}' are strictly prohibited.`
    );
  }

  // Check marker table
  let markerRows: Array<{ marker_key: string; test_db: string }> = [];
  try {
    const testMarkerReg = await prismaClient.$queryRawUnsafe(
      `SELECT to_regclass('_disposable_test_marker') IS NOT NULL AS exists`
    );
    if (testMarkerReg[0]?.exists) {
      const rows = await prismaClient.$queryRawUnsafe(
        `SELECT marker_key, test_db FROM "_disposable_test_marker"`
      );
      markerRows.push(...rows);
    }

    const cloneMarkerReg = await prismaClient.$queryRawUnsafe(
      `SELECT to_regclass('_rehearsal_clone_marker') IS NOT NULL AS exists`
    );
    if (cloneMarkerReg[0]?.exists) {
      const rows = await prismaClient.$queryRawUnsafe(
        `SELECT marker_key, clone_db AS test_db FROM "_rehearsal_clone_marker"`
      );
      markerRows.push(...rows);
    }
  } catch (err: any) {
    throw new Error(
      `[CRITICAL TEST SAFETY VIOLATION] Failed to inspect disposable database markers in '${dbName}': ${err.message}. ` +
      `Aborting before any mutations.`
    );
  }

  if (markerRows.length === 0) {
    throw new Error(
      `[CRITICAL TEST SAFETY VIOLATION] Disposable database marker table missing in '${dbName}'. ` +
      `Test executions require a verified disposable database marker (_disposable_test_marker or _rehearsal_clone_marker). ` +
      `Aborting before any mutations.`
    );
  }

  const validMarkers = ["DISPOSABLE_TEST_DATABASE_V1", "DISPOSABLE_REHEARSAL_CLONE_V1"];
  const marker = markerRows.find(
    (m) => validMarkers.includes(m.marker_key) && m.test_db === dbName
  );

  if (!marker) {
    throw new Error(
      `[CRITICAL TEST SAFETY VIOLATION] Valid disposable marker missing or mismatched in '${dbName}'. ` +
      `Found markers: ${JSON.stringify(markerRows)}. Aborting before any mutations.`
    );
  }

  return {
    dbName,
    markerKey: marker.marker_key,
    testDb: marker.test_db,
    serverAddr: conn.server_addr,
    serverPort: conn.server_port,
  };
}

/**
 * Asserts that the storage layer is strictly isolated from production Supabase Storage.
 */
export function assertIsolatedStorageEnvironment(): void {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const secretKey = process.env.SUPABASE_SECRET_KEY || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  // If remote Supabase URL or live secret keys are detected, mock storage MUST be active
  if (supabaseUrl.includes("supabase.co") || secretKey.length > 30 || serviceKey.length > 30) {
    if (!mockStorageInstalled) {
      throw new Error(
        `\n====================================================================\n` +
        `[CRITICAL SECURITY VIOLATION] FAIL-CLOSED STORAGE GUARD TRIGGERED!\n` +
        `Detected remote Supabase URL or live service keys.\n` +
        `Tests must NEVER interact with live remote Supabase Storage.\n` +
        `Mock storage must be activated via enableMockStorage() before testing.\n` +
        `====================================================================\n`
      );
    }
  }
}

/**
 * Master assertion verifying complete database AND storage isolation.
 */
export function assertIsolatedTestEnvironment(): TestIsolationVerification {
  const db = assertIsolatedDatabaseEnvironment();
  assertIsolatedStorageEnvironment();

  return {
    isIsolated: true,
    hostname: db.hostname,
    port: db.port,
    database: db.database,
    storageIsolated: mockStorageInstalled,
  };
}

/**
 * Explicitly loads .env.test from workspace root, preserves explicitly selected test/clone database targets,
 * enforces fail-closed assertions, and enables in-memory mock storage.
 */
export function loadIsolatedTestEnvironment(options: { installMockStorage?: boolean } = {}): TestIsolationVerification {
  const testEnvPath = path.resolve(process.cwd(), ".env.test");

  if (!fs.existsSync(testEnvPath)) {
    throw new Error(
      `[FAIL-CLOSED GUARD] .env.test file not found at: ${testEnvPath}`
    );
  }

  const parsed = dotenv.parse(fs.readFileSync(testEnvPath, "utf-8"));

  // Check if caller explicitly supplied a target via TEST_DATABASE_URL, REHEARSAL_DATABASE_URL,
  // or a local loopback DATABASE_URL that differs from unconfigured remote defaults.
  const explicitCandidate =
    process.env.TEST_DATABASE_URL ||
    process.env.REHEARSAL_DATABASE_URL ||
    (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("supabase.co") && !process.env.DATABASE_URL.includes("pooler.supabase.com")
      ? process.env.DATABASE_URL
      : undefined);

  let preserveExplicit = false;
  if (explicitCandidate) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(explicitCandidate);
    } catch (err: any) {
      throw new Error(
        `[CRITICAL TEST SAFETY VIOLATION] Explicitly selected database target is malformed: ${err.message}`
      );
    }

    const host = parsedUrl.hostname.toLowerCase();
    const rawDb = parsedUrl.pathname.replace(/^\//, "");
    const db = rawDb.toLowerCase();
    const allowedLoopbacks = ["127.0.0.1", "localhost", "::1", "[::1]"];

    // 1. Explicitly selected remote targets must be rejected
    const forbiddenKeywords = ["supabase", "pooler", "aws-", "gcp-", "azure-", "render", "neon", "railway", "cockroach"];
    if (forbiddenKeywords.some((kw) => host.includes(kw)) || !allowedLoopbacks.includes(host)) {
      throw new Error(
        `[CRITICAL TEST SAFETY VIOLATION] Explicitly selected database host "${host}" is not an authorized local loopback. ` +
        `Tests must never execute against remote infrastructure.`
      );
    }

    // 2. Explicitly selected working or system databases must be rejected
    if (FORBIDDEN_WORKING_DATABASES.includes(db)) {
      throw new Error(
        `[CRITICAL TEST SAFETY VIOLATION] Explicitly selected database targets forbidden working/system database "${rawDb}". ` +
        `Integration tests and test runners are strictly prohibited from mutating "${rawDb}".`
      );
    }

    // 3. Explicitly selected non-disposable databases must be rejected
    if (!isAllowedDisposableDatabase(db)) {
      throw new Error(
        `[CRITICAL TEST SAFETY VIOLATION] Explicitly selected database "${rawDb}" is not an authorized disposable database. ` +
        `Allowed databases: ${ALLOWED_DISPOSABLE_DATABASES.join(", ")} or names ending with _test/_clone/_disposable.`
      );
    }

    // Explicit candidate is verified and authorized
    preserveExplicit = true;
  }

  // Force override process.env with .env.test values
  for (const key of Object.keys(parsed)) {
    if (preserveExplicit && (key === "DATABASE_URL" || key === "DIRECT_URL")) {
      continue;
    }
    process.env[key] = parsed[key];
  }

  if (preserveExplicit && explicitCandidate) {
    process.env.DATABASE_URL = explicitCandidate;
    process.env.DIRECT_URL = process.env.DIRECT_URL || explicitCandidate;
  }

  (process.env as any).NODE_ENV = "test";
  process.env.ALLOW_MOCK_AUTOCOMPLETE = "true";

  // Strictly clear / neutralize production Supabase secret keys in test process
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (options.installMockStorage !== false) {
    enableMockStorage();
  }

  return assertIsolatedTestEnvironment();
}
