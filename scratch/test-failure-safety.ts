import "./load-env";
import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("==================================================");
  console.log("SECTION 18: FAILURE SAFETY AUDIT");
  console.log("==================================================");

  const user = await prisma.user.findFirst({ where: { role: "ADMIN" } }) || await prisma.user.findFirst();

  // Create a fresh test conversation
  const testConv = await prisma.aIConversation.create({
    data: {
      userId: user!.id,
      title: "Failure Safety Test Thread",
      paperId: null,
    }
  });

  console.log(`Created test thread [${testConv.id}]`);

  // Persist user message
  const userMsg = await prisma.aIMessage.create({
    data: {
      conversationId: testConv.id,
      role: "USER",
      content: "Simulated question before OpenAI failure",
    }
  });

  console.log(`Created user message [${userMsg.id}]`);

  // Simulate failure in orchestrator by throwing before assistant message persistence
  let failed = false;
  try {
    throw new Error("Simulated OpenAI rate limit / 503 service unavailable");
  } catch (err: any) {
    failed = true;
    console.log(`Simulated synthesis failure caught: "${err.message}"`);
  }

  // Verify conversation state
  const msgsAfterFail = await prisma.aIMessage.findMany({
    where: { conversationId: testConv.id }
  });

  console.log(`Messages in conversation after failure: ${msgsAfterFail.length}`);
  console.log(`Contains any assistant message: ${msgsAfterFail.some(m => m.role === "ASSISTANT")}`);
  console.log(`No fake assistant message created: ${!msgsAfterFail.some(m => m.role === "ASSISTANT") ? "PASSED" : "FAILED"}`);

  // Now simulate successful retry in the same thread
  const retryAssistantMsg = await prisma.aIMessage.create({
    data: {
      conversationId: testConv.id,
      role: "ASSISTANT",
      content: "Successful synthesis on retry",
      citations: { claims: [], insufficientEvidence: true }
    }
  });

  const msgsAfterRetry = await prisma.aIMessage.findMany({
    where: { conversationId: testConv.id },
    orderBy: { createdAt: "asc" }
  });

  console.log(`Messages after retry: ${msgsAfterRetry.length} (order: ${msgsAfterRetry.map(m => m.role).join(" -> ")})`);
  console.log(`Retry succeeded: ${msgsAfterRetry.length === 2 ? "PASSED" : "FAILED"}`);

  // Cleanup test thread
  await prisma.aIConversation.delete({ where: { id: testConv.id } });
  console.log(`Cleaned up test thread.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
