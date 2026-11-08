/**
 * AI RESEARCH HUB — PHASE 11.1A REGISTRATION & PRIVACY ACCESS CONTROL
 *
 * Scope:
 * A. Responses Paper Summary sets store: false
 * B. Responses Paper Q&A sets store: false
 * C. Responses Quick Research sets store: false
 * D. Responses Deep Research extraction sets store: false
 * E. Responses Deep Research brief and planner set store: false
 * F. Open registration permits personal emails (e.g. gmail.com)
 * G. Open registration permits institutional emails (e.g. ox.ac.uk)
 * H. Email case normalization on registration
 * I. Whitespace trimming on registration
 * J. Password validation (< 6 chars rejected)
 * K. Duplicate email registration rejected (409 Conflict)
 * L. USER role still cannot access admin
 * M. Password hashing verification (stored hash is bcrypt salt/hash, never plaintext)
 * N. Registration page copy confirms Open Access
 */

import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
} from "../src/lib/test-guard";

loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import * as fs from "fs";
import * as path from "path";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import { authOptions } from "../src/lib/auth";
import { POST as registerHandler } from "../src/app/api/auth/register/route";

async function runPhase11_1ATests() {
  console.log("==========================================================");
  console.log("AI RESEARCH HUB — OPEN REGISTRATION & ACCESS CONTROL TESTS");
  console.log("==========================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName}${detail ? ` - ${detail}` : ""}`);
      failed++;
    }
  }

  const createdUserEmails: string[] = [];
  const testRunId = Date.now();

  try {
    // --------------------------------------------------------------------------
    // Test A: Responses Paper Summary request sets store: false
    // --------------------------------------------------------------------------
    {
      const generatorPath = path.resolve(process.cwd(), "src/lib/ai/generator.ts");
      const code = fs.readFileSync(generatorPath, "utf-8");
      const hasResponsesCall = code.includes("openai.responses.parse");
      const hasStoreFalse = code.includes("store: false");
      assert(
        hasResponsesCall && hasStoreFalse,
        "Test A: Responses Paper Summary request configures store: false in src/lib/ai/generator.ts"
      );
    }

    // --------------------------------------------------------------------------
    // Test B: Responses Paper Q&A request sets store: false
    // --------------------------------------------------------------------------
    {
      const qaPath = path.resolve(process.cwd(), "src/lib/rag/qa-orchestrator.ts");
      const code = fs.readFileSync(qaPath, "utf-8");
      const hasResponsesCall = code.includes("openai.responses.parse");
      const hasStoreFalse = code.includes("store: false");
      assert(
        hasResponsesCall && hasStoreFalse,
        "Test B: Responses Paper Q&A request configures store: false in src/lib/rag/qa-orchestrator.ts"
      );
    }

    // --------------------------------------------------------------------------
    // Test C: Responses Quick Research request sets store: false
    // --------------------------------------------------------------------------
    {
      const synthesisPath = path.resolve(process.cwd(), "src/lib/synthesis/synthesis-orchestrator.ts");
      const code = fs.readFileSync(synthesisPath, "utf-8");
      const hasResponsesCall = code.includes("openai.responses.parse");
      const hasStoreFalse = code.includes("store: false");
      assert(
        hasResponsesCall && hasStoreFalse,
        "Test C: Responses Quick Research request configures store: false in src/lib/synthesis/synthesis-orchestrator.ts"
      );
    }

    // --------------------------------------------------------------------------
    // Test D: Responses Deep Research extraction sets store: false
    // --------------------------------------------------------------------------
    {
      const extractorPath = path.resolve(process.cwd(), "src/lib/agent/study-extractor.ts");
      const code = fs.readFileSync(extractorPath, "utf-8");
      const hasResponsesCall = code.includes("openai.responses.parse");
      const hasStoreFalse = code.includes("store: false");
      assert(
        hasResponsesCall && hasStoreFalse,
        "Test D: Responses Deep Research extraction configures store: false in src/lib/agent/study-extractor.ts"
      );
    }

    // --------------------------------------------------------------------------
    // Test E: Responses Deep Research brief sets store: false
    // --------------------------------------------------------------------------
    {
      const briefPath = path.resolve(process.cwd(), "src/lib/agent/brief-synthesizer.ts");
      const code = fs.readFileSync(briefPath, "utf-8");
      const hasResponsesCall = code.includes("openai.responses.parse");
      const hasStoreFalse = code.includes("store: false");

      const plannerPath = path.resolve(process.cwd(), "src/lib/agent/agent-orchestrator.ts");
      const plannerCode = fs.readFileSync(plannerPath, "utf-8");
      const plannerHasStoreFalse = plannerCode.includes("store: false");

      assert(
        hasResponsesCall && hasStoreFalse && plannerHasStoreFalse,
        "Test E: Responses Deep Research brief and planner configure store: false"
      );
    }

    // --------------------------------------------------------------------------
    // Test F: Open registration permits personal emails (e.g. gmail.com)
    // --------------------------------------------------------------------------
    {
      const personalEmail = `personal.scholar.${testRunId}@gmail.com`;
      createdUserEmails.push(personalEmail);

      const mockReq = new Request("http://localhost:3000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Personal Scholar",
          email: personalEmail,
          password: "SecurePassword123!",
        }),
      });

      const res = await registerHandler(mockReq);
      const data = await res.json();
      assert(
        res.status === 201 && data.user?.email === personalEmail,
        "Test F: Open registration permits personal emails (e.g. gmail.com) with 201 Created",
        `status: ${res.status}, error: ${data.error}`
      );
    }

    // --------------------------------------------------------------------------
    // Test G: Open registration permits institutional emails (e.g. ox.ac.uk)
    // --------------------------------------------------------------------------
    {
      const instEmail = `fellow.${testRunId}@ox.ac.uk`;
      createdUserEmails.push(instEmail);

      const mockReq = new Request("http://localhost:3000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Oxford Fellow",
          email: instEmail,
          password: "SecurePassword123!",
        }),
      });

      const res = await registerHandler(mockReq);
      const data = await res.json();
      assert(
        res.status === 201 && data.user?.email === instEmail,
        "Test G: Open registration permits institutional emails (e.g. ox.ac.uk) with 201 Created",
        `status: ${res.status}, error: ${data.error}`
      );
    }

    // --------------------------------------------------------------------------
    // Test H: Case normalization on registration
    // --------------------------------------------------------------------------
    {
      const rawEmail = `MixedCase.${testRunId}@Lab.ORG`;
      const normalizedExpected = `mixedcase.${testRunId}@lab.org`;
      createdUserEmails.push(normalizedExpected);

      const mockReq = new Request("http://localhost:3000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Case Test User",
          email: rawEmail,
          password: "SecurePassword123!",
        }),
      });

      const res = await registerHandler(mockReq);
      const data = await res.json();
      assert(
        res.status === 201 && data.user?.email === normalizedExpected,
        "Test H: Email case variations are normalized to lowercase on registration",
        `status: ${res.status}, email: ${data.user?.email}`
      );
    }

    // --------------------------------------------------------------------------
    // Test I: Whitespace trimming on registration
    // --------------------------------------------------------------------------
    {
      const rawWhitespaceEmail = `   spaced.${testRunId}@university.edu   \n `;
      const trimmedExpected = `spaced.${testRunId}@university.edu`;
      createdUserEmails.push(trimmedExpected);

      const mockReq = new Request("http://localhost:3000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Whitespace User",
          email: rawWhitespaceEmail,
          password: "SecurePassword123!",
        }),
      });

      const res = await registerHandler(mockReq);
      const data = await res.json();
      assert(
        res.status === 201 && data.user?.email === trimmedExpected,
        "Test I: Leading/trailing whitespace on email is trimmed during registration",
        `status: ${res.status}, email: ${data.user?.email}`
      );
    }

    // --------------------------------------------------------------------------
    // Test J: Short password validation (< 6 chars rejected)
    // --------------------------------------------------------------------------
    {
      const shortPwEmail = `shortpw.${testRunId}@test.org`;

      const mockReq = new Request("http://localhost:3000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Short Pw",
          email: shortPwEmail,
          password: "12345",
        }),
      });

      const res = await registerHandler(mockReq);
      const data = await res.json();
      assert(
        res.status === 400 && data.error?.includes("at least 6 characters"),
        "Test J: Password shorter than 6 characters is rejected with 400 Bad Request",
        `status: ${res.status}, error: ${data.error}`
      );
    }

    // --------------------------------------------------------------------------
    // Test K: Duplicate registration rejected (409 Conflict)
    // --------------------------------------------------------------------------
    {
      const dupEmail = `duplicate.${testRunId}@university.edu`;
      createdUserEmails.push(dupEmail);

      // Create first user
      const firstReq = new Request("http://localhost:3000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Original User",
          email: dupEmail,
          password: "SecurePassword123!",
        }),
      });
      const firstRes = await registerHandler(firstReq);
      assert(firstRes.status === 201, "Test K.1: First registration succeeds");

      // Attempt duplicate registration
      const dupReq = new Request("http://localhost:3000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Imposter User",
          email: dupEmail.toUpperCase(),
          password: "DifferentPassword123!",
        }),
      });
      const dupRes = await registerHandler(dupReq);
      const dupData = await dupRes.json();
      assert(
        dupRes.status === 409 && dupData.error?.includes("already exists"),
        "Test K.2: Duplicate registration (even case variation) returns 409 Conflict",
        `status: ${dupRes.status}, error: ${dupData.error}`
      );
    }

    // --------------------------------------------------------------------------
    // Test L: USER role cannot access admin
    // --------------------------------------------------------------------------
    {
      const { default: middleware } = await import("../src/middleware");

      const userReq = new NextRequest("http://localhost:3000/admin/papers");
      const userAttempt = await (middleware as any)(userReq, {
        token: { role: "USER", email: "user@institution.edu" },
      });

      assert(
        Boolean(userAttempt?.status === 307 || userAttempt?.headers?.get("location")?.includes("unauthorized")),
        "Test L.1: Middleware redirects USER role away from /admin"
      );

      const adminReq = new NextRequest("http://localhost:3000/admin/papers");
      const adminAttempt = await (middleware as any)(adminReq, {
        token: { role: "ADMIN", email: "admin@institution.edu" },
      });

      assert(
        !adminAttempt?.headers?.get("location")?.includes("unauthorized"),
        "Test L.2: ADMIN role is allowed to access /admin"
      );
    }

    // --------------------------------------------------------------------------
    // Test M: Password hashing verification
    // --------------------------------------------------------------------------
    {
      const hashTestEmail = `hash.test.${testRunId}@university.edu`;
      createdUserEmails.push(hashTestEmail);
      const plaintextPw = "MySecretPassphrase2026!";

      const mockReq = new Request("http://localhost:3000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Hash Verifier",
          email: hashTestEmail,
          password: plaintextPw,
        }),
      });

      await registerHandler(mockReq);

      const userInDb = await prisma.user.findUnique({
        where: { email: hashTestEmail },
      });

      assert(
        Boolean(userInDb?.passwordHash) &&
        userInDb!.passwordHash !== plaintextPw &&
        Boolean(userInDb!.passwordHash?.startsWith("$2")),
        "Test M.1: Stored password is a valid bcrypt hash, never plaintext"
      );

      const matches = await bcrypt.compare(plaintextPw, userInDb!.passwordHash!);
      assert(matches === true, "Test M.2: bcrypt verifies plaintext password against stored hash");
    }

    // --------------------------------------------------------------------------
    // Test N: Register page copy confirms Open Access
    // --------------------------------------------------------------------------
    {
      const registerPagePath = path.resolve(process.cwd(), "src/app/register/page.tsx");
      const registerCode = fs.readFileSync(registerPagePath, "utf-8");

      assert(
        registerCode.includes("Open Access") &&
        !registerCode.includes("BETA_ALLOWED_EMAILS") &&
        !registerCode.includes("isRegistrationAllowed"),
        "Test N: Register UI contains Open Access badge and does not reference beta allowlists"
      );
    }

  } finally {
    // Teardown created test users
    if (createdUserEmails.length > 0) {
      await prisma.user.deleteMany({
        where: { email: { in: createdUserEmails } },
      });
    }
  }

  console.log("\n==========================================================");
  console.log(`OPEN REGISTRATION TEST SUMMARY: ${passed} PASSED / ${failed} FAILED`);
  console.log("==========================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase11_1ATests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
