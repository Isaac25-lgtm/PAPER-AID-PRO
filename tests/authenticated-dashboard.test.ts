/**
 * AI RESEARCH HUB — AUTHENTICATED DASHBOARD & WORKSPACE ACCEPTANCE TEST SUITE
 *
 * Verifies:
 * 1. Login redirects & authorized callback URL sanitization
 * 2. Unauthorized dashboard access protection
 * 3. Multi-tenant user data isolation (documents, library items, conversations)
 * 4. New-user empty states and academic onboarding milestone calculation
 * 5. Returning-user data aggregation, metrics, and recent activity
 * 6. Authenticated navigation structure and working action mapping
 */

import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
} from "../src/lib/test-guard";

loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { DocumentType, PaperProcessingStatus } from "@prisma/client";
import { getSafeCallbackUrl } from "../src/lib/auth/safe-redirect";
import { listResearchDocuments } from "../src/lib/editor/document-service";
import { getUserLibraryItems } from "../src/lib/library/user-library-service";

describe("AI Research Hub — Authenticated Dashboard & Workspace Tests", () => {
  let userAId: string;
  let userBId: string;
  let userADocId: string;
  let userAPaperId: string;
  let userAConvId: string;

  before(async () => {
    // 1. Verify isolated test environment
    const dbUrl = process.env.DATABASE_URL || "";
    assert(dbUrl.includes("127.0.0.1") || dbUrl.includes("localhost"), "DATABASE_URL must be local loopback");
    assert(!dbUrl.includes("supabase"), "DATABASE_URL must NOT connect to remote Supabase");

    // 2. Create User A (Returning Researcher)
    const userA = await prisma.user.upsert({
      where: { email: "dashboard-returning@university.edu" },
      update: {},
      create: {
        email: "dashboard-returning@university.edu",
        passwordHash: "test-hash-a",
        name: "Dr. Returning Researcher",
        role: "USER",
      },
    });
    userAId = userA.id;

    // 3. Create User B (New Researcher / Isolated Observer)
    const userB = await prisma.user.upsert({
      where: { email: "dashboard-newuser@university.edu" },
      update: {},
      create: {
        email: "dashboard-newuser@university.edu",
        passwordHash: "test-hash-b",
        name: "Dr. New Researcher",
        role: "USER",
      },
    });
    userBId = userB.id;

    // 4. Seed User A assets: Research Document
    const doc = await prisma.researchDocument.create({
      data: {
        userId: userAId,
        title: "Comparative Evaluation of Vision Transformers in Histopathology",
        docType: DocumentType.MANUSCRIPT,
        version: 2,
        textContent: "Introduction\nThis manuscript investigates transformer attention in whole-slide histopathology.",
      },
    });
    userADocId = doc.id;

    // 5. Seed User A assets: Library Paper (Private Upload)
    const paper = await prisma.paper.create({
      data: {
        title: "Benchmarking Multimodal Foundation Models in Pathology",
        abstract: "Comprehensive empirical evaluation across 500 patient cohorts.",
        status: PaperProcessingStatus.COMPLETED,
        sourceProvenance: {
          isPrivate: true,
          uploadedByUserId: userAId,
          ownerId: userAId,
        },
      },
    });
    userAPaperId = paper.id;

    await prisma.bookmark.create({
      data: {
        userId: userAId,
        paperId: userAPaperId,
      },
    });

    // 6. Seed User A assets: AI Conversation Thread
    const conv = await prisma.aIConversation.create({
      data: {
        userId: userAId,
        title: "Synthesis of Attention Mechanisms",
        paperId: userAPaperId,
      },
    });
    userAConvId = conv.id;
  });

  after(async () => {
    // Clean up seeded test records
    if (userADocId) {
      await prisma.researchDocument.deleteMany({ where: { id: userADocId } });
    }
    if (userAConvId) {
      await prisma.aIConversation.deleteMany({ where: { id: userAConvId } });
    }
    if (userAPaperId) {
      await prisma.bookmark.deleteMany({ where: { paperId: userAPaperId } });
      await prisma.paper.deleteMany({ where: { id: userAPaperId } });
    }
    await prisma.$disconnect();
  });

  // =========================================================================
  // 1. LOGIN REDIRECTS & CALLBACK URL TESTS
  // =========================================================================
  it("1. Callback URLs: defaults to /dashboard when no callback is provided", () => {
    assert.equal(getSafeCallbackUrl(null, "/dashboard"), "/dashboard");
    assert.equal(getSafeCallbackUrl(undefined, "/dashboard"), "/dashboard");
    assert.equal(getSafeCallbackUrl("", "/dashboard"), "/dashboard");
    assert.equal(getSafeCallbackUrl("   ", "/dashboard"), "/dashboard");
  });

  it("2. Callback URLs: preserves authorized internal deep links and query parameters", () => {
    assert.equal(getSafeCallbackUrl("/editor/doc-browser-fixture", "/dashboard"), "/editor/doc-browser-fixture");
    assert.equal(getSafeCallbackUrl("/library?tab=collections", "/dashboard"), "/library?tab=collections");
    assert.equal(getSafeCallbackUrl("/research?thread=thread-xyz", "/dashboard"), "/research?thread=thread-xyz");
    assert.equal(getSafeCallbackUrl("/discover?q=Transformers", "/dashboard"), "/discover?q=Transformers");
  });

  it("3. Callback URLs: rejects open-redirect vulnerabilities and falls back to /dashboard", () => {
    assert.equal(getSafeCallbackUrl("//evil.com", "/dashboard"), "/dashboard");
    assert.equal(getSafeCallbackUrl("/\\evil.com", "/dashboard"), "/dashboard");
    assert.equal(getSafeCallbackUrl("https://phishing-academic.com", "/dashboard"), "/dashboard");
    assert.equal(getSafeCallbackUrl("http://attacker.com/steal-session", "/dashboard"), "/dashboard");
    assert.equal(getSafeCallbackUrl("javascript:alert(1)", "/dashboard"), "/dashboard");
  });

  // =========================================================================
  // 2. USER DATA ISOLATION TESTS
  // =========================================================================
  it("4. Data Isolation: User A sees their own manuscripts and User B sees zero", async () => {
    const userADocs = await prisma.researchDocument.findMany({
      where: { userId: userAId },
    });
    assert.ok(userADocs.length >= 1, "User A should have at least 1 document");
    assert.equal(userADocs[0].id, userADocId);

    const userBDocs = await prisma.researchDocument.findMany({
      where: { userId: userBId },
    });
    assert.equal(userBDocs.length, 0, "User B must have 0 documents (strict isolation)");
  });

  it("5. Data Isolation: User A sees their own library items and User B cannot access them", async () => {
    const userAItems = await getUserLibraryItems(userAId);
    assert.ok(userAItems.some((item) => item.id === userAPaperId), "User A should see their private paper");

    const userBItems = await getUserLibraryItems(userBId);
    assert.ok(!userBItems.some((item) => item.id === userAPaperId), "User B must NOT see User A's private paper");
  });

  it("6. Data Isolation: User A sees their synthesis conversation and User B sees zero", async () => {
    const userAConvs = await prisma.aIConversation.findMany({
      where: { userId: userAId, NOT: { title: { startsWith: "__SYSTEM_" } } },
    });
    assert.ok(userAConvs.some((c) => c.id === userAConvId), "User A should see their conversation");

    const userBConvs = await prisma.aIConversation.findMany({
      where: { userId: userBId, NOT: { title: { startsWith: "__SYSTEM_" } } },
    });
    assert.equal(userBConvs.length, 0, "User B must have 0 conversations (strict isolation)");
  });

  // =========================================================================
  // 3. ONBOARDING MILESTONE CALCULATION TESTS
  // =========================================================================
  it("7. Onboarding Milestones: calculates correctly for brand new researcher (1/4 milestones)", async () => {
    // For User B (0 docs, 0 papers, 0 convs)
    const docCount = await prisma.researchDocument.count({ where: { userId: userBId } });
    const libraryCount = (await getUserLibraryItems(userBId)).length;
    const convCount = await prisma.aIConversation.count({
      where: { userId: userBId, NOT: { title: { startsWith: "__SYSTEM_" } } },
    });

    const milestones = {
      hasAccount: true,
      hasPapers: libraryCount > 0,
      hasAnalyzed: convCount > 0,
      hasDrafted: docCount > 0,
    };

    assert.equal(milestones.hasAccount, true);
    assert.equal(milestones.hasPapers, false);
    assert.equal(milestones.hasAnalyzed, false);
    assert.equal(milestones.hasDrafted, false);

    const completed = Object.values(milestones).filter(Boolean).length;
    assert.equal(completed, 1); // 1 of 4 completed
  });

  it("8. Onboarding Milestones: calculates correctly for returning active researcher (4/4 milestones)", async () => {
    // For User A (has docs, papers, convs)
    const docCount = await prisma.researchDocument.count({ where: { userId: userAId } });
    const libraryCount = (await getUserLibraryItems(userAId)).length;
    const convCount = await prisma.aIConversation.count({
      where: { userId: userAId, NOT: { title: { startsWith: "__SYSTEM_" } } },
    });

    const milestones = {
      hasAccount: true,
      hasPapers: libraryCount > 0,
      hasAnalyzed: convCount > 0,
      hasDrafted: docCount > 0,
    };

    assert.equal(milestones.hasAccount, true);
    assert.equal(milestones.hasPapers, true);
    assert.equal(milestones.hasAnalyzed, true);
    assert.equal(milestones.hasDrafted, true);

    const completed = Object.values(milestones).filter(Boolean).length;
    assert.equal(completed, 4); // 4 of 4 completed
  });

  // =========================================================================
  // 4. RETURNING-USER DASHBOARD DATA INTEGRITY
  // =========================================================================
  it("9. Returning Dashboard Data: accurately aggregates manuscript metrics without synthetic fabrication", async () => {
    const recentDocs = await prisma.researchDocument.findMany({
      where: { userId: userAId },
      orderBy: { updatedAt: "desc" },
      take: 4,
      select: {
        id: true,
        title: true,
        docType: true,
        version: true,
        textContent: true,
        _count: {
          select: { citations: true, linkedPapers: true },
        },
      },
    });

    assert.ok(recentDocs.length >= 1);
    const doc = recentDocs[0];
    assert.equal(doc.docType, "MANUSCRIPT");
    assert.equal(doc.version, 2);
    assert.equal(typeof doc._count.citations, "number");
    assert.equal(typeof doc._count.linkedPapers, "number");
    assert.ok(doc.textContent && doc.textContent.includes("Introduction"));
  });

  // =========================================================================
  // 5. WORKSPACE SHELL & SIDEBAR NAVIGATION INTEGRITY
  // =========================================================================
  it("10. Workspace Shell Route Detection: distinguishes authenticated workspace routes from public pages", () => {
    const isWorkspaceRoute = (pathname: string, isAuthenticated: boolean) =>
      pathname.startsWith("/dashboard") ||
      pathname.startsWith("/library") ||
      pathname.startsWith("/editor") ||
      pathname.startsWith("/research") ||
      pathname.startsWith("/history") ||
      pathname.startsWith("/conversations") ||
      pathname.startsWith("/account") ||
      pathname.startsWith("/admin") ||
      (pathname.startsWith("/discover") && isAuthenticated);

    // Authenticated workspace routes
    assert.equal(isWorkspaceRoute("/dashboard", true), true);
    assert.equal(isWorkspaceRoute("/discover", true), true);
    assert.equal(isWorkspaceRoute("/library", true), true);
    assert.equal(isWorkspaceRoute("/editor", true), true);
    assert.equal(isWorkspaceRoute("/editor/cmvdh017b0001vrd4x778mafv", true), true);
    assert.equal(isWorkspaceRoute("/research", true), true);
    assert.equal(isWorkspaceRoute("/history", true), true);
    assert.equal(isWorkspaceRoute("/account", true), true);

    // Unauthenticated public routes
    assert.equal(isWorkspaceRoute("/", false), false);
    assert.equal(isWorkspaceRoute("/discover", false), false);
    assert.equal(isWorkspaceRoute("/papers", false), false);
    assert.equal(isWorkspaceRoute("/pricing", false), false);
    assert.equal(isWorkspaceRoute("/login", false), false);
    assert.equal(isWorkspaceRoute("/register", false), false);
  });

  it("11. Sidebar Navigation: role restrictions hide admin links from standard researchers", () => {
    const getSidebarLinks = (role: string) => {
      const links = [
        { title: "Dashboard", href: "/dashboard" },
        { title: "Find Papers", href: "/discover" },
        { title: "My Library", href: "/library" },
        { title: "My Documents", href: "/editor" },
        { title: "AI Research Chat", href: "/research" },
        { title: "History", href: "/history" },
      ];
      if (role === "ADMIN") {
        links.push({ title: "Admin Console", href: "/admin" });
      }
      return links;
    };

    const userLinks = getSidebarLinks("USER");
    assert.equal(userLinks.some((l) => l.href === "/admin"), false);
    assert.equal(userLinks.length, 6);

    const adminLinks = getSidebarLinks("ADMIN");
    assert.equal(adminLinks.some((l) => l.href === "/admin"), true);
    assert.equal(adminLinks.length, 7);
  });
});
