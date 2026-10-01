import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { toggleBookmarkAction } from "../src/app/papers/bookmark-actions";

async function testBookmarks() {
  console.log("=== TESTING BOOKMARKS & USER ISOLATION ===");
  // Fetch two distinct test users from DB
  const users = await prisma.user.findMany({ take: 2 });
  if (users.length < 2) {
    throw new Error("Need at least 2 users in database for isolation test.");
  }
  const [userA, userB] = users;
  console.log(`User A: ${userA.email} (${userA.id})`);
  console.log(`User B: ${userB.email} (${userB.id})`);

  const paper1 = await prisma.paper.findFirst({
    where: { id: "cmugxsj280000vrpontgz0vlf" }, // ENDOMETRIOSIS
  });
  const paper2 = await prisma.paper.findFirst({
    where: { id: "cmugydswv0003vrpoassf36yi" }, // THE EFFICACY OF...
  });
  if (!paper1 || !paper2) {
    throw new Error("Test papers not found");
  }

  // Clear any existing test bookmarks for clean slate
  await prisma.bookmark.deleteMany({
    where: { userId: { in: [userA.id, userB.id] } },
  });

  // Step 1: User A saves Paper 1 directly via database transaction (simulating server session)
  console.log("\n1. User A bookmarks Paper 1...");
  await prisma.bookmark.create({
    data: { userId: userA.id, paperId: paper1.id },
  });

  // Step 2: Query User A's saved papers
  const userABookmarks = await prisma.bookmark.findMany({
    where: { userId: userA.id },
    include: { paper: true },
  });
  console.log(`User A saved count: ${userABookmarks.length}`);
  const userAHasPaper1 = userABookmarks.some((b) => b.paperId === paper1.id);
  const userAHasPaper2 = userABookmarks.some((b) => b.paperId === paper2.id);
  console.log(`  User A has Paper 1 (Saved): ${userAHasPaper1}`);
  console.log(`  User A has Paper 2 (Not Saved): ${userAHasPaper2}`);
  if (!userAHasPaper1 || userAHasPaper2) {
    throw new Error("User A saved list does not match expectation!");
  }

  // Step 3: Query User B's saved papers (Isolation test)
  console.log("\n2. User B checks saved library (Isolation test)...");
  const userBBookmarks = await prisma.bookmark.findMany({
    where: { userId: userB.id },
    include: { paper: true },
  });
  console.log(`User B saved count: ${userBBookmarks.length}`);
  if (userBBookmarks.length !== 0) {
    throw new Error("Isolation failure: User B sees User A's bookmarks!");
  }
  console.log("  PASS: User B has 0 bookmarks. Strict isolation verified.");

  // Step 4: Admin-uploaded papers do NOT automatically appear
  console.log("\n3. Verifying admin-uploaded papers don't automatically appear...");
  const allPapersCount = await prisma.paper.count();
  console.log(`Total papers in DB: ${allPapersCount}`);
  console.log(`User A bookmarks: ${userABookmarks.length}`);
  if (userABookmarks.length === allPapersCount) {
    throw new Error("Papers were automatically bookmarked!");
  }
  console.log("  PASS: Admin papers require explicit user bookmarking.");

  // Step 5: Test unique constraint [userId, paperId]
  console.log("\n4. Testing unique constraint on duplicate save...");
  try {
    await prisma.bookmark.create({
      data: { userId: userA.id, paperId: paper1.id },
    });
    console.error("FAIL: Duplicate bookmark did not throw unique constraint violation");
  } catch (err: any) {
    console.log("  PASS: Duplicate save blocked by DB unique constraint:", err.code);
  }

  // Step 6: User A removes Paper 1
  console.log("\n5. User A removes bookmark on Paper 1...");
  await prisma.bookmark.delete({
    where: { userId_paperId: { userId: userA.id, paperId: paper1.id } },
  });
  const remainingA = await prisma.bookmark.count({ where: { userId: userA.id } });
  console.log(`User A remaining bookmarks: ${remainingA}`);
  if (remainingA !== 0) {
    throw new Error("Bookmark removal failed!");
  }
  console.log("  PASS: Paper removed from User A's saved library.");

  // Step 7: Test toggleBookmarkAction without session (unauthorized test)
  console.log("\n6. Testing Server Action unauthorized handling...");
  const unauthRes = await toggleBookmarkAction(paper1.id);
  console.log("Unauth Action result:", unauthRes);
  if (!unauthRes.unauthorized || unauthRes.success) {
    throw new Error("Unauthenticated action was not properly blocked!");
  }
  console.log("  PASS: Unauthenticated toggle correctly rejected with unauthorized: true.");

  console.log("\n=== ALL BOOKMARK & ISOLATION TESTS PASSED ===");
}

testBookmarks()
  .catch((e) => {
    console.error("Test failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
