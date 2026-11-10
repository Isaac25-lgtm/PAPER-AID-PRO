/**
 * PHASE 4C: SUPABASE STORAGE PRIVACY READINESS & ISOLATION AUDIT
 *
 * Verifies:
 * 1. Storage proxy compatibility with private buckets (mocked & isolated).
 * 2. Service role credential boundaries (zero browser exposure).
 * 3. Strict fail-closed behavior for anonymous and cross-tenant callers.
 * 4. Audit of isInternalSystemOperation against parameter injection / bypasses.
 */

import "./test-setup";
import * as fs from "fs";
import * as path from "path";

// Dynamic session store for testing authentication states
let currentMockSession: { user: { id: string; role: string; email?: string } } | null = null;
const nextAuthNext = require("next-auth/next");
nextAuthNext.getServerSession = async () => currentMockSession;

function setMockSession(session: { user: { id: string; role: string; email?: string } } | null) {
  currentMockSession = session;
}

import { GET as pdfRouteHandler } from "@/app/api/papers/[id]/pdf/route";
import { prisma } from "@/lib/prisma";
import { ADMIN_TEST_FIXTURE_IDS } from "@/lib/auth/paper-authorization";
import { downloadPaperPdf, setStorageClientOverride } from "@/lib/storage";
import { disableMockStorage, enableMockStorage } from "@/lib/test-guard";

function assert(condition: boolean, testId: string, message: string) {
  if (!condition) {
    console.error(`[FAIL] ${testId}: ${message}`);
    throw new Error(`Assertion failed: ${testId} - ${message}`);
  }
  console.log(`[PASS] ${testId}: ${message}`);
}

async function runStoragePrivacyReadinessTests() {
  console.log("================================================================================");
  console.log(" AI RESEARCH HUB — PHASE 4C STORAGE PRIVACY READINESS AUDIT");
  console.log("================================================================================");

  // --------------------------------------------------------------------------
  // TEST GROUP 1: Service Role Credential Isolation & Browser Bundle Protection
  // --------------------------------------------------------------------------
  console.log("\n--- TEST GROUP 1: Credential Isolation & Bundle Protection ---");

  // 1A: Assert NEXT_PUBLIC_ does not expose secret or service role key
  assert(
    process.env.NEXT_PUBLIC_SUPABASE_SECRET_KEY === undefined &&
      process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY === undefined,
    "SEC_4C_01_NO_PUBLIC_SECRET_KEY_ENV",
    "Neither NEXT_PUBLIC_SUPABASE_SECRET_KEY nor NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY is defined in environment"
  );

  // 1B: Scan src directory for any client files importing storage
  const srcDir = path.resolve(process.cwd(), "src");
  const allSrcFiles: string[] = [];

  function collectFiles(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        collectFiles(full);
      } else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
        allSrcFiles.push(full);
      }
    }
  }
  collectFiles(srcDir);

  const clientFilesImportingStorage: string[] = [];
  const clientFilesReferencingSecretKey: string[] = [];

  for (const f of allSrcFiles) {
    const content = fs.readFileSync(f, "utf-8");
    const isClientComponent = content.includes('"use client"') || content.includes("'use client'");

    if (isClientComponent) {
      if (content.includes("@/lib/storage") || content.includes("lib/storage")) {
        clientFilesImportingStorage.push(path.relative(process.cwd(), f));
      }
      if (
        content.includes("SUPABASE_SECRET_KEY") ||
        content.includes("SUPABASE_SERVICE_ROLE_KEY")
      ) {
        clientFilesReferencingSecretKey.push(path.relative(process.cwd(), f));
      }
    }
  }

  assert(
    clientFilesImportingStorage.length === 0,
    "SEC_4C_02_ZERO_CLIENT_STORAGE_IMPORTS",
    `Zero client components import storage module (found ${clientFilesImportingStorage.length})`
  );

  assert(
    clientFilesReferencingSecretKey.length === 0,
    "SEC_4C_03_ZERO_CLIENT_SECRET_KEY_REFS",
    `Zero client components reference SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY (found ${clientFilesReferencingSecretKey.length})`
  );

  // --------------------------------------------------------------------------
  // TEST GROUP 2: Private Bucket Storage Proxy Simulation
  // --------------------------------------------------------------------------
  console.log("\n--- TEST GROUP 2: Storage Proxy Private Bucket Behavior ---");

  const FIXTURE_ID = Array.from(ADMIN_TEST_FIXTURE_IDS)[0];
  const adminUser = { id: "cmugp0d120000vrlghc60x5q1", role: "ADMIN" as const };
  const standardUser = { id: "cmugpapqq0017vrlg3zo0a0k4", role: "USER" as const };

  // 2A: Anonymous user requesting PDF endpoint receives 401 regardless of storage state
  setMockSession(null);
  const anonReq = new Request(`http://localhost:3000/api/papers/${FIXTURE_ID}/pdf`);
  const anonRes = await pdfRouteHandler(anonReq as any, { params: { id: FIXTURE_ID } });
  assert(
    anonRes.status === 401,
    "SEC_4C_04_ANON_REJECTED_BEFORE_STORAGE",
    `Anonymous request rejected with HTTP 401 before any storage operation (status: ${anonRes.status})`
  );

  // 2B: Standard researcher requesting fixture receives 404 regardless of storage state
  setMockSession({ user: { id: standardUser.id, role: standardUser.role } });
  const userFixtureReq = new Request(`http://localhost:3000/api/papers/${FIXTURE_ID}/pdf`);
  const userFixtureRes = await pdfRouteHandler(userFixtureReq as any, { params: { id: FIXTURE_ID } });
  assert(
    userFixtureRes.status === 404,
    "SEC_4C_05_NON_ADMIN_REJECTED_BEFORE_STORAGE",
    `Standard user fixture request rejected with HTTP 404 before any storage operation (status: ${userFixtureRes.status})`
  );

  // 2C: Fail-closed verification without SUPABASE_SECRET_KEY
  // When secret key is absent and mock storage is disabled, downloadPaperPdf must throw server configuration error
  let failClosedThrew = false;
  disableMockStorage();
  try {
    await downloadPaperPdf(`${FIXTURE_ID}/original.pdf`);
  } catch (err: any) {
    failClosedThrew = true;
    assert(
      err.message.includes("SUPABASE_SECRET_KEY is required"),
      "SEC_4C_06_FAIL_CLOSED_WITHOUT_KEY",
      `Storage operation fails closed with explicit error: "${err.message}"`
    );
  } finally {
    enableMockStorage();
  }
  assert(failClosedThrew, "SEC_4C_06B_FAIL_CLOSED_THREW", "downloadPaperPdf threw as expected when key is absent");

  // 2D: With service-role client (simulated via mock), Admin streams PDF with HTTP 200
  setStorageClientOverride({
    storage: {
      from: () => ({
        download: async () => ({
          data: { arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35]).buffer },
          error: null,
        }),
      }),
    },
  });

  setMockSession({ user: { id: adminUser.id, role: adminUser.role } });
  const adminReq = new Request(`http://localhost:3000/api/papers/${FIXTURE_ID}/pdf`);
  const adminRes = await pdfRouteHandler(adminReq as any, { params: { id: FIXTURE_ID } });
  setStorageClientOverride(null);

  assert(
    adminRes.status === 200,
    "SEC_4C_06C_ADMIN_PERMITTED_TO_STREAM",
    `Admin request authorized to stream from storage (status: ${adminRes.status})`
  );

  // 2E: Cache-Control on PDF response must be strictly private and non-cachable
  const cacheHeader = adminRes.headers.get("cache-control") || "";
  assert(
    cacheHeader.includes("no-store") && cacheHeader.includes("private"),
    "SEC_4C_07_PRIVATE_CACHE_HEADERS",
    `Cache-Control header is strictly private: "${cacheHeader}"`
  );

  // 2F: Production override defense: setStorageClientOverride is strictly blocked in production
  const origNodeEnv = process.env.NODE_ENV;
  (process.env as any).NODE_ENV = "production";
  let prodOverrideBlocked = false;
  try {
    setStorageClientOverride({ storage: {} });
  } catch (err: any) {
    prodOverrideBlocked = true;
    assert(
      err.message.includes("Security violation") || err.message.includes("prohibited in production"),
      "SEC_4C_07B_PROD_OVERRIDE_REJECTED",
      `Storage client override rejected in production: "${err.message}"`
    );
  } finally {
    (process.env as any).NODE_ENV = origNodeEnv;
  }
  assert(prodOverrideBlocked, "SEC_4C_07C_PROD_GUARD_ACTIVE", "setStorageClientOverride threw in production mode");

  // --------------------------------------------------------------------------
  // TEST GROUP 3: Audit of isInternalSystemOperation Boundary
  // --------------------------------------------------------------------------
  console.log("\n--- TEST GROUP 3: Internal System Operation Audit ---");

  // 3A: Check that no API route parameters expose isInternalSystemOperation
  const apiRouteFiles = allSrcFiles.filter((f) => f.includes(path.join("app", "api")));
  const leakedApiRoutes: string[] = [];

  for (const rf of apiRouteFiles) {
    const content = fs.readFileSync(rf, "utf-8");
    if (content.includes("isInternalSystemOperation")) {
      leakedApiRoutes.push(path.relative(process.cwd(), rf));
    }
  }

  assert(
    leakedApiRoutes.length === 0,
    "SEC_4C_08_NO_API_EXPOSES_INTERNAL_FLAG",
    `Zero API routes expose or accept isInternalSystemOperation (found ${leakedApiRoutes.length})`
  );

  // 3B: Check that Server Actions do not expose isInternalSystemOperation
  const serverActionFiles = allSrcFiles.filter(
    (f) => f.includes("actions.ts") || f.includes("-actions.ts")
  );
  const leakedActionFiles: string[] = [];

  for (const af of serverActionFiles) {
    const content = fs.readFileSync(af, "utf-8");
    if (content.includes("isInternalSystemOperation")) {
      leakedActionFiles.push(path.relative(process.cwd(), af));
    }
  }

  assert(
    leakedActionFiles.length === 0,
    "SEC_4C_09_NO_ACTIONS_EXPOSE_INTERNAL_FLAG",
    `Zero Server Actions expose or accept isInternalSystemOperation (found ${leakedActionFiles.length})`
  );

  // 3C: Check that RAG retrievePaperEvidence options do not accept isInternalSystemOperation
  const ragRetrievalFile = path.resolve(process.cwd(), "src/lib/rag/retrieve-paper-evidence.ts");
  const ragContent = fs.readFileSync(ragRetrievalFile, "utf-8");
  assert(
    !ragContent.includes("isInternalSystemOperation"),
    "SEC_4C_10_RAG_NO_INTERNAL_FLAG",
    "RAG evidence retrieval interface does not accept isInternalSystemOperation"
  );

  // --------------------------------------------------------------------------
  // TEST GROUP 4: UI Link & CDN URL Audit
  // --------------------------------------------------------------------------
  console.log("\n--- TEST GROUP 4: UI Link & Public CDN Audit ---");

  const componentsAndPages = allSrcFiles.filter(
    (f) =>
      f.includes(path.join("src", "app")) ||
      f.includes(path.join("src", "components"))
  );

  const leakedCdnLinks: string[] = [];
  for (const cf of componentsAndPages) {
    const content = fs.readFileSync(cf, "utf-8");
    if (content.includes(".supabase.co/storage/v1/object/public/research-papers")) {
      leakedCdnLinks.push(path.relative(process.cwd(), cf));
    }
  }

  assert(
    leakedCdnLinks.length === 0,
    "SEC_4C_11_ZERO_PUBLIC_CDN_LINKS_IN_UI",
    `Zero UI components or pages reference public Supabase Storage CDN URLs (found ${leakedCdnLinks.length})`
  );

  console.log("\n================================================================================");
  console.log(" SUMMARY: All Phase 4C Storage Privacy Readiness Assertions Passed (100.0%)");
  console.log("================================================================================");
}

runStoragePrivacyReadinessTests()
  .catch((err) => {
    console.error("Test suite encountered fatal error:", err);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
