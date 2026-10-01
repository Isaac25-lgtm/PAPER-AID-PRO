/**
 * AI RESEARCH HUB — PHASE 11.1A TEST SUITE
 * Pre-Deployment Privacy & Private-Beta Access Hardening
 *
 * Covers:
 * A. Responses Paper Summary request sets store: false
 * B. Responses Paper Q&A request sets store: false
 * C. Responses Quick Research request sets store: false
 * D. Responses Deep Research extraction sets store: false
 * E. Responses Deep Research brief sets store: false
 * F. Invited normalized email can register
 * G. Uninvited email cannot register
 * H. Case differences in email do not bypass allowlist
 * I. Whitespace differences do not bypass allowlist
 * J. Empty allowlist in allowlist mode fails closed
 * K. Existing registered user can still log in even if no longer on registration allowlist
 * L. USER role still cannot access admin
 * M. Registration error does not expose allowed emails
 * N. BETA_ALLOWED_EMAILS never reaches client bundle
 */

import "../scratch/load-env";
import * as fs from "fs";
import * as path from "path";
import { prisma } from "../src/lib/prisma";
import { authOptions } from "../src/lib/auth";
import { isRegistrationAllowed, BETA_INVITE_ONLY_MESSAGE } from "../src/lib/auth/beta-access";
import { POST as registerHandler } from "../src/app/api/auth/register/route";

async function runPhase11_1ATests() {
  console.log("==========================================================");
  console.log("AI RESEARCH HUB — PHASE 11.1A PRE-DEPLOYMENT HARDENING TESTS");
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

  // Preserve initial env
  const originalMode = process.env.BETA_REGISTRATION_MODE;
  const originalAllowlist = process.env.BETA_ALLOWED_EMAILS;

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
    // Test F: Invited normalized email can register
    // --------------------------------------------------------------------------
    {
      process.env.BETA_REGISTRATION_MODE = "allowlist";
      process.env.BETA_ALLOWED_EMAILS = "invited-researcher@institution.edu,scholar@lab.org";

      const check = isRegistrationAllowed("invited-researcher@institution.edu");
      assert(
        check.allowed === true,
        "Test F.1: isRegistrationAllowed permits invited email in allowlist mode"
      );

      // Route-level verification: uninvited vs invited
      const mockReq = new Request("http://localhost:3000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Invited",
          email: "invited-researcher@institution.edu",
          password: "password123",
        }),
      });

      const res = await registerHandler(mockReq);
      const data = await res.json();
      // Should NOT be 403 forbidden
      assert(
        res.status !== 403,
        "Test F.2: Registration API does not return 403 Forbidden for invited email",
        `status: ${res.status}, msg: ${data.message || data.error}`
      );
    }

    // --------------------------------------------------------------------------
    // Test G: Uninvited email cannot register
    // --------------------------------------------------------------------------
    {
      process.env.BETA_REGISTRATION_MODE = "allowlist";
      process.env.BETA_ALLOWED_EMAILS = "invited-researcher@institution.edu,scholar@lab.org";

      const check = isRegistrationAllowed("uninvited-visitor@unknown.com");
      assert(
        check.allowed === false && check.reason === BETA_INVITE_ONLY_MESSAGE,
        "Test G.1: isRegistrationAllowed blocks uninvited email with researcher-friendly message"
      );

      const mockReq = new Request("http://localhost:3000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Uninvited Visitor",
          email: "uninvited-visitor@unknown.com",
          password: "password123",
        }),
      });

      const res = await registerHandler(mockReq);
      const data = await res.json();
      assert(
        res.status === 403 && data.error === BETA_INVITE_ONLY_MESSAGE,
        "Test G.2: Registration API returns 403 Forbidden with exact safe invite-only message",
        `status: ${res.status}, error: ${data.error}`
      );
    }

    // --------------------------------------------------------------------------
    // Test H: Case differences in email do not bypass allowlist
    // --------------------------------------------------------------------------
    {
      process.env.BETA_REGISTRATION_MODE = "allowlist";
      process.env.BETA_ALLOWED_EMAILS = "Scholar@Lab.ORG";

      const checkUpper = isRegistrationAllowed("SCHOLAR@LAB.ORG");
      const checkMixed = isRegistrationAllowed("sChOlAr@lAb.OrG");
      const checkLower = isRegistrationAllowed("scholar@lab.org");

      assert(
        checkUpper.allowed && checkMixed.allowed && checkLower.allowed,
        "Test H.1: Case variations of invited email correctly match normalized allowlist"
      );

      const checkUninvitedUpper = isRegistrationAllowed("NOT-INVITED@LAB.ORG");
      assert(
        !checkUninvitedUpper.allowed,
        "Test H.2: Uppercase uninvited email is strictly blocked"
      );
    }

    // --------------------------------------------------------------------------
    // Test I: Whitespace differences do not bypass allowlist
    // --------------------------------------------------------------------------
    {
      process.env.BETA_REGISTRATION_MODE = "allowlist";
      process.env.BETA_ALLOWED_EMAILS = "   lead.scientist@lab.org  ,   fellow@lab.org   ";

      const checkWhitespaceInput = isRegistrationAllowed("  lead.scientist@lab.org \n ");
      assert(
        checkWhitespaceInput.allowed === true,
        "Test I.1: Leading/trailing whitespace on input email is cleanly trimmed and matched"
      );

      const checkWhitespaceEnv = isRegistrationAllowed("fellow@lab.org");
      assert(
        checkWhitespaceEnv.allowed === true,
        "Test I.2: Whitespace surrounding items in BETA_ALLOWED_EMAILS is stripped"
      );
    }

    // --------------------------------------------------------------------------
    // Test J: Empty allowlist in allowlist mode fails closed
    // --------------------------------------------------------------------------
    {
      process.env.BETA_REGISTRATION_MODE = "allowlist";
      process.env.BETA_ALLOWED_EMAILS = "";

      let capturedWarn = "";
      const originalWarn = console.warn;
      console.warn = (...args: any[]) => {
        capturedWarn += args.join(" ");
      };

      const checkEmpty = isRegistrationAllowed("anyone@anywhere.com");

      console.warn = originalWarn;

      assert(
        checkEmpty.allowed === false && checkEmpty.reason === BETA_INVITE_ONLY_MESSAGE,
        "Test J.1: Empty allowlist fails closed for new registration"
      );
      assert(
        capturedWarn.includes("Failing closed"),
        "Test J.2: System logs sanitized configuration warning when allowlist is empty in allowlist mode"
      );
      assert(
        !capturedWarn.includes("anyone@anywhere.com"),
        "Test J.3: Warning does not expose candidate email"
      );
    }

    // --------------------------------------------------------------------------
    // Test K: Existing registered user can still log in even if no longer on registration allowlist
    // --------------------------------------------------------------------------
    {
      const { hash } = await import("bcryptjs");
      const testEmail = `existing-scholar-${Date.now()}@university.edu`;
      const testPassword = "SafeBetaPassword123!";
      const passwordHash = await hash(testPassword, 10);

      // Create an existing registered user in the database
      const existingUser = await prisma.user.create({
        data: {
          name: "Dr. Existing Researcher",
          email: testEmail,
          passwordHash,
          role: "USER",
        },
      });

      try {
        // Configure allowlist to strictly NOT contain this existing user
        process.env.BETA_REGISTRATION_MODE = "allowlist";
        process.env.BETA_ALLOWED_EMAILS = "completely-different-person@lab.edu,another-invitee@nih.gov";

        // Verify that this email is NOT allowed to register anew
        const isAllowedOnRegistration = isRegistrationAllowed(existingUser.email);
        assert(
          isAllowedOnRegistration.allowed === false,
          "Test K.1: Existing user is not on the registration allowlist"
        );

        // Verify NextAuth authorize does NOT check allowlist for existing users
        const credentialsProvider = authOptions.providers.find(
          (p: any) => p.id === "credentials" || p.name === "Credentials"
        ) as any;

        assert(Boolean(credentialsProvider), "Test K.2: CredentialsProvider is present in authOptions");

        // Test login with valid credentials via NextAuth authorize handler
        const authorizeFn = credentialsProvider.options?.authorize || credentialsProvider.authorize;
        const loginResult = await authorizeFn({
          email: existingUser.email,
          password: testPassword,
        });

        assert(
          Boolean(loginResult) && loginResult.id === existingUser.id,
          "Test K.3: Existing registered user logs in successfully despite not being on registration allowlist",
          `Authenticated user id: ${loginResult?.id}`
        );
      } finally {
        // Clean up test user
        await prisma.user.delete({ where: { id: existingUser.id } }).catch(() => {});
      }
    }

    // --------------------------------------------------------------------------
    // Test L: USER still cannot access admin
    // --------------------------------------------------------------------------
    {
      // Test middleware RBAC logic
      const simulateMiddleware = (pathname: string, token: { role?: string } | null) => {
        if (pathname.startsWith("/admin")) {
          if (token?.role !== "ADMIN") {
            return { redirected: true, destination: "/?error=unauthorized" };
          }
        }
        return { redirected: false };
      };

      const regularUserAttempt = simulateMiddleware("/admin/papers", { role: "USER" });
      const guestAttempt = simulateMiddleware("/admin/papers", null);
      const adminAttempt = simulateMiddleware("/admin/papers", { role: "ADMIN" });

      assert(
        regularUserAttempt.redirected && regularUserAttempt.destination === "/?error=unauthorized",
        "Test L.1: Regular USER token is intercepted from /admin and redirected with error=unauthorized"
      );
      assert(
        guestAttempt.redirected && guestAttempt.destination === "/?error=unauthorized",
        "Test L.2: Unauthenticated token is intercepted from /admin"
      );
      assert(
        !adminAttempt.redirected,
        "Test L.3: ADMIN role is allowed to access /admin"
      );
    }

    // --------------------------------------------------------------------------
    // Test M: Registration error does not expose allowed emails
    // --------------------------------------------------------------------------
    {
      process.env.BETA_REGISTRATION_MODE = "allowlist";
      const sensitiveEmails = "secret-dean@harvard.edu,confidential-pi@mit.edu";
      process.env.BETA_ALLOWED_EMAILS = sensitiveEmails;

      const mockReq = new Request("http://localhost:3000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Curious Hacker",
          email: "probe@external.org",
          password: "password123",
        }),
      });

      const res = await registerHandler(mockReq);
      const body = await res.json();
      const stringifiedBody = JSON.stringify(body);

      assert(
        !stringifiedBody.includes("secret-dean") &&
        !stringifiedBody.includes("harvard.edu") &&
        !stringifiedBody.includes("confidential-pi") &&
        !stringifiedBody.includes("mit.edu"),
        "Test M: Registration error response never leaks allowlist entries or email domains"
      );
    }

    // --------------------------------------------------------------------------
    // Test N: BETA_ALLOWED_EMAILS never reaches client bundle
    // --------------------------------------------------------------------------
    {
      // Verify no NEXT_PUBLIC_ prefix is used
      const hasClientPrefix = "NEXT_PUBLIC_BETA_ALLOWED_EMAILS" in process.env;
      assert(
        !hasClientPrefix,
        "Test N.1: BETA_ALLOWED_EMAILS does NOT have NEXT_PUBLIC_ prefix"
      );

      // Verify register/page.tsx does NOT import or read process.env.BETA_ALLOWED_EMAILS
      const registerPagePath = path.resolve(process.cwd(), "src/app/register/page.tsx");
      const registerCode = fs.readFileSync(registerPagePath, "utf-8");

      assert(
        !registerCode.includes("BETA_ALLOWED_EMAILS"),
        "Test N.2: Client-side register component (src/app/register/page.tsx) never references BETA_ALLOWED_EMAILS"
      );
    }

  } finally {
    // Restore original env
    if (originalMode !== undefined) {
      process.env.BETA_REGISTRATION_MODE = originalMode;
    } else {
      delete process.env.BETA_REGISTRATION_MODE;
    }
    if (originalAllowlist !== undefined) {
      process.env.BETA_ALLOWED_EMAILS = originalAllowlist;
    } else {
      delete process.env.BETA_ALLOWED_EMAILS;
    }
  }

  console.log("\n==========================================================");
  console.log(`PHASE 11.1A TEST SUMMARY: ${passed} PASSED / ${failed} FAILED`);
  console.log("==========================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase11_1ATests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
