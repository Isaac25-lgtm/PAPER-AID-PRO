/**
 * AI RESEARCH HUB — PHASE 11.3 EXCERPT EXPANSION VERIFICATION SUITE
 * Tests the expandable "Show full excerpt / Show less" control,
 * complete stored passage preservation, and multi-citation independence.
 */

import "../scratch/load-env";
import * as fs from "fs";
import * as path from "path";
import { prisma } from "../src/lib/prisma";
import { validateMultiPaperSynthesis } from "../src/lib/synthesis/validate-multipaper-citations";
import { PaperEvidenceSet } from "../src/lib/synthesis/types";
import { MultiPaperSynthesisOutput } from "../src/lib/synthesis/schemas";
import { getChunkPassageAction, getResearchThreadMessagesAction } from "../src/app/research/actions";

async function runExcerptExpansionTests() {
  console.log("==========================================================");
  console.log("AI RESEARCH HUB — PHASE 11.3 EXCERPT EXPANSION TESTS");
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

  // --- Test Group 1: Complete Stored Citation Passage Hydration in validateMultiPaperSynthesis ---
  console.log("--- Test Group 1: Hydration of Complete Stored Citation Passage ---");
  {
    const longPassage =
      "Cancers 2022, 14, 277 14 of 21 3.4. Breast Lesion Classification Using Image-Based Features " +
      "The three best-performing breast lesion classification models, with the highest accuracy, sensitivity, " +
      "specificity and AUROC for every training dataset, are presented in Table 4. For manual segmentation, " +
      "the highest accuracy (0.916 ± 0.046), sensitivity (0.866 ± 0.088), and specificity (0.957 ± 0.051) " +
      "were achieved with the Weighted KNN classifier.";

    const mockEvidenceSets: PaperEvidenceSet[] = [
      {
        paperId: "paper-1",
        paperTitle: "Influence of CAD Design on Ultrasound Classification",
        authors: ["Magnuska ZA", "Theek B", "Kießling F"],
        doi: "10.3390/cancers14020277",
        publicationDate: "2022-06-01",
        journal: "Cancers (MDPI)",
        citationCount: 42,
        chunks: [
          {
            id: "chunk-101",
            paperId: "paper-1",
            chunkIndex: 52,
            pageNumber: 14,
            section: "Methods",
            text: longPassage,
          },
        ],
      },
    ];

    const mockModelOutput: MultiPaperSynthesisOutput = {
      insufficientEvidence: false,
      claims: [
        {
          text: "The best-performing model achieved high accuracy using a Weighted KNN classifier evaluated on a Manual Segmentation dataset.",
          evidence: [{ paperId: "paper-1", chunkIds: ["chunk-101"] }],
        },
      ],
      disagreements: [],
      limitations: [],
    };

    const validated = validateMultiPaperSynthesis(mockModelOutput, mockEvidenceSets);

    assert(validated.claims.length === 1, "Claim is successfully validated");
    assert(validated.claims[0].citations.length === 1, "Citation is hydrated");

    const citation = validated.claims[0].citations[0];
    assert(!!citation.snippet, "Snippet exists");
    assert(citation.snippet.length <= 250, "Snippet is cleanly truncated for compact preview");
    assert(citation.fullText === longPassage, "fullText contains the complete stored citation passage");
    assert(
      citation.fullText!.includes("highest accuracy (0.916 ± 0.046)"),
      "fullText contains the empirical sentence substantiating the claim that was truncated in the snippet"
    );
    assert(
      citation.paperTitle === "Influence of CAD Design on Ultrasound Classification",
      "Retains manuscript title"
    );
    assert(citation.pageNumber === 14, "Retains page number");
    assert(citation.section === "Methods", "Retains section label");
    assert(citation.doi === "10.3390/cancers14020277", "Retains DOI");
  }

  // --- Test Group 2: Access Control & getChunkPassageAction Verification ---
  console.log("\n--- Test Group 2: Access Control & getChunkPassageAction Verification ---");
  {
    // 1. Unauthenticated request must be rejected
    const unauthRes = await getChunkPassageAction({
      conversationId: "conv-123",
      chunkId: "chunk-456",
    });
    assert(
      unauthRes.success === false && unauthRes.error === "Authentication required.",
      "getChunkPassageAction strictly enforces authentication (rejects without session)"
    );

    // 2. Missing params rejected
    const emptyParamsRes = await getChunkPassageAction({
      conversationId: "",
      chunkId: "",
    });
    assert(
      emptyParamsRes.success === false,
      "getChunkPassageAction rejects empty conversation or chunk parameters"
    );

    // 3. Inspect actions.ts source for strict conversation ownership and citation check
    const actionsPath = path.resolve(process.cwd(), "src/app/research/actions.ts");
    const actionsCode = fs.readFileSync(actionsPath, "utf-8");

    assert(
      actionsCode.includes("conversation.userId !== session.user.id"),
      "getResearchThreadMessagesAction and getChunkPassageAction enforce conversation ownership"
    );
    assert(
      actionsCode.includes("isCitedInConversation"),
      "getChunkPassageAction enforces that requested chunk must be legitimately cited in the user's conversation"
    );
    assert(
      actionsCode.includes("Unauthorized passage access: requested chunk is not cited in this research thread"),
      "Arbitrary chunk ID submissions are blocked with unauthorized passage access error"
    );
  }

  // --- Test Group 3: Component Source Inspection (Desktop & Mobile Responsiveness) ---
  console.log("\n--- Test Group 3: Research Interface Component Inspection ---");
  {
    const interfacePath = path.resolve(
      process.cwd(),
      "src/components/research/research-interface.tsx"
    );
    const content = fs.readFileSync(interfacePath, "utf-8");

    assert(
      content.includes("function SupportingExcerptCard"),
      "SupportingExcerptCard component is defined"
    );
    assert(
      content.includes("Show full excerpt"),
      "Contains 'Show full excerpt' expandable button label"
    );
    assert(
      content.includes("Show less"),
      "Contains 'Show less' collapsible button label"
    );
    assert(
      content.includes("setIsExpanded((prev) => !prev)") || content.includes("setIsExpanded("),
      "Manages independent local expanded state per excerpt card"
    );
    assert(
      content.includes("whitespace-pre-wrap break-words"),
      "Applies whitespace-pre-wrap and break-words for clean excerpt rendering"
    );
    assert(
      content.includes("href={`https://doi.org/${citation.doi}`}"),
      "Preserves DOI link"
    );
    assert(
      content.includes("href={`/papers/${citation.paperId}`}"),
      "Preserves View Paper link"
    );
    assert(
      content.includes("href={`/api/papers/${citation.paperId}/pdf`}"),
      "Preserves Original PDF link"
    );
    assert(
      content.includes("Authors: {citation.authors.slice(0, 2).join(\", \")}"),
      "Preserves authors metadata"
    );
    assert(
      content.includes("Page ${citation.pageNumber}"),
      "Preserves page number"
    );
    assert(
      content.includes("§${citation.section}"),
      "Preserves section label"
    );
    assert(
      content.includes("flex flex-wrap") && content.includes("truncate"),
      "Employs responsive wrapping classes for mobile support"
    );
  }

  // --- Test Group 4: Multiple Citations Independence Control ---
  console.log("\n--- Test Group 4: Independent Control Across Multiple Citations ---");
  {
    // Verify that SupportingExcerptCard uses React component state encapsulation
    // rather than shared parent state, guaranteeing that Citation 1 and Citation 2
    // toggle without affecting each other.
    const interfacePath = path.resolve(
      process.cwd(),
      "src/components/research/research-interface.tsx"
    );
    const content = fs.readFileSync(interfacePath, "utf-8");

    // SupportingExcerptCard must define its own local isExpanded state
    const cardDef = content.slice(
      content.indexOf("function SupportingExcerptCard"),
      content.indexOf("interface ResearchInterfaceProps")
    );

    assert(
      cardDef.includes("const [isExpanded, setIsExpanded] = React.useState(false);"),
      "SupportingExcerptCard encapsulates its own useState(false) instance"
    );
    assert(
      !cardDef.includes("expandedExcerptIndex"),
      "Does not use a global index that causes state collision across multiple citations"
    );
  }

  console.log("\n==========================================================");
  console.log(`PHASE 11.3 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==========================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runExcerptExpansionTests()
  .catch((err) => {
    console.error("Test execution error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
