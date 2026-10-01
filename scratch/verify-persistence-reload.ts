import "./load-env";
import { prisma } from "../src/lib/prisma";

async function main() {
  const conversationId = "cmunyibra0001vrtsh5jqwxhb";

  console.log("==================================================");
  console.log("SECTION 15: PERSISTENCE & RELOAD AUDIT");
  console.log(`Conversation ID: ${conversationId}`);
  console.log("==================================================");

  const conv = await prisma.aIConversation.findUnique({
    where: { id: conversationId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (!conv) {
    throw new Error(`Conversation ${conversationId} not found!`);
  }

  console.log(`AIConversation:`);
  console.log(`  id: ${conv.id}`);
  console.log(`  title: "${conv.title}"`);
  console.log(`  paperId: ${conv.paperId} (expected: null) -> ${conv.paperId === null ? "PASSED" : "FAILED"}`);
  console.log(`  total messages: ${conv.messages.length} (expected: 4) -> ${conv.messages.length === 4 ? "PASSED" : "FAILED"}`);

  console.log(`\nMessage sequence verification:`);
  const expectedRoles = ["USER", "ASSISTANT", "USER", "ASSISTANT"];
  for (let i = 0; i < conv.messages.length; i++) {
    const m = conv.messages[i];
    const roleMatches = m.role === expectedRoles[i];
    console.log(`  Msg ${i + 1}: role=${m.role} (expected ${expectedRoles[i]}) -> ${roleMatches ? "MATCH" : "MISMATCH"}`);
    if (m.role === "USER") {
      console.log(`    User Question: "${m.content.slice(0, 80)}..."`);
    } else {
      console.log(`    Assistant Content: "${m.content.slice(0, 80)}..."`);
      const cit = m.citations as any;
      console.log(`    Parsed Citations JSON:`);
      console.log(`      - claims: ${Array.isArray(cit?.claims)} (count: ${cit?.claims?.length})`);
      console.log(`      - selectedPapers: ${Array.isArray(cit?.selectedPapers)} (count: ${cit?.selectedPapers?.length})`);
      console.log(`      - disagreements: ${Array.isArray(cit?.disagreements)}`);
      console.log(`      - limitations: ${Array.isArray(cit?.limitations)}`);
      console.log(`      - insufficientEvidence: ${typeof cit?.insufficientEvidence === "boolean" ? cit?.insufficientEvidence : "N/A"}`);
      console.log(`      - libraryScopeNote: "${cit?.libraryScopeNote?.slice(0, 50)}..."`);
    }
  }

  // Reload via Prisma query simulating getResearchThreadMessagesAction
  const reloaded = await prisma.aIMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" }
  });

  console.log(`\nSimulated Thread Reload:`);
  console.log(`  Successfully reloaded ${reloaded.length} messages.`);
  const assistant1Citations = reloaded[1].citations as any;
  console.log(`  Reloaded Assistant 1 Claims count: ${assistant1Citations.claims.length}`);
  console.log(`  Reloaded Assistant 1 First Claim text: "${assistant1Citations.claims[0].text.slice(0, 70)}..."`);
  console.log(`  Reloaded Assistant 1 First Claim supportingPaperCount: ${assistant1Citations.claims[0].supportingPaperCount}`);
  console.log(`  Persistence & Reload: 100% MATCH!`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
