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
  storageIsolated: boolean;
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
          upload: async (
            filePath: string,
            fileBody: Buffer | Uint8Array,
            _options?: any
          ) => {
            const buf = Buffer.isBuffer(fileBody) ? fileBody : Buffer.from(fileBody);
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
 * Asserts that the active database configuration is strictly an isolated local loopback.
 */
export function assertIsolatedDatabaseEnvironment(): { hostname: string; port: string } {
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

    if (name === "DATABASE_URL") {
      resolvedHost = host;
      resolvedPort = parsed.port || "5432";
    }
  }

  return {
    hostname: resolvedHost,
    port: resolvedPort,
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
    storageIsolated: mockStorageInstalled,
  };
}

/**
 * Explicitly loads .env.test from workspace root, overrides process.env,
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

  // Force override process.env with .env.test values
  for (const key of Object.keys(parsed)) {
    process.env[key] = parsed[key];
  }
  (process.env as any).NODE_ENV = "test";

  // Strictly clear / neutralize production Supabase secret keys in test process
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (options.installMockStorage !== false) {
    enableMockStorage();
  }

  return assertIsolatedTestEnvironment();
}
