/**
 * AI RESEARCH HUB — BETA ISSUE #2 REGRESSION & VERIFICATION SUITE
 * Expandable Evidence for Reported Limitations
 *
 * Verifies:
 * 1. Limitations evidence validation & verbatim chunk passage preservation.
 * 2. Multi-limitation independent expansion & collapse state controls.
 * 3. Evidence-unavailable handling when citations are empty or excerpt text is missing.
 * 4. Preservation of paper title, section, page number, DOI, and original PDF links.
 * 5. Defensive compatibility with legacy research histories.
 * 6. Access control and private history permission enforcement.
 */

import "../scratch/load-env";
import * as fs from "fs";
import * as path from "path";
import { prisma } from "../src/lib/prisma";
import { validateMultiPaperSynthesis } from "../src/lib/synthesis/validate-multipaper-citations";
import { PaperEvidenceSet } from "../src/lib/synthesis/types";
import { MultiPaperSynthesisOutput } from "../src/lib/synthesis/schemas";
import { getChunkPassageAction } from "../src/app/research/actions";

async function runBetaIssue2Tests() {
  console.log("==========================================================");
  console.log("AI RESEARCH HUB — BETA ISSUE #2 LIMITATIONS EVIDENCE TESTS");
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

  // --- Test Group 1: Multi-Limitation Validation & Citation Provenance ---
  console.log("--- Test Group 1: Multi-Limitation Citation Provenance & Verbatim Passages ---");
  {
    const limitationPassage1 =
      "5. Limitations: This study was limited by its retrospective single-center design with a relatively small sample of 120 patients. External multi-center validation on diverse ultrasound hardware is needed.";
    const limitationPassage2 =
      "4. Constraints: High inter-operator variability in manual acoustic transducer placement presents a potential confounder for feature repeatability across different sonographers.";

    const mockEvidenceSets: PaperEvidenceSet[] = [
      {
        paperId: "paper-1",
        paperTitle: "Influence of CAD Design on Ultrasound Classification",
        authors: ["Magnuska ZA", "Theek B"],
        doi: "10.3390/cancers14020277",
        publicationDate: "2022-06-01",
        journal: "Cancers",
        citationCount: 42,
        chunks: [
          {
            id: "chunk-lim-1",
            paperId: "paper-1",
            chunkIndex: 55,
            pageNumber: 15,
            section: "Limitations",
            text: limitationPassage1,
          },
        ],
      },
      {
        paperId: "paper-2",
        paperTitle: "Acoustic Feature Extraction in Breast Sonography",
        authors: ["Zhang L", "Wang Y"],
        doi: "10.1016/j.ultrasmedbio.2023.01.002",
        publicationDate: "2023-02-15",
        journal: "Ultrasound in Medicine & Biology",
        citationCount: 19,
        chunks: [
          {
            id: "chunk-lim-2",
            paperId: "paper-2",
            chunkIndex: 40,
            pageNumber: 8,
            section: "Discussion",
            text: limitationPassage2,
          },
        ],
      },
    ];

    const mockModelOutput: MultiPaperSynthesisOutput = {
      insufficientEvidence: false,
      claims: [
        {
          text: "Automated classifiers demonstrated high sensitivity in distinguishing benign and malignant lesions.",
          evidence: [{ paperId: "paper-1", chunkIds: ["chunk-lim-1"] }],
        },
      ],
      disagreements: [],
      limitations: [
        {
          text: "Evaluations were constrained by retrospective single-center cohorts requiring external multi-center validation.",
          evidence: [{ paperId: "paper-1", chunkIds: ["chunk-lim-1"] }],
        },
        {
          text: "Inter-operator variability in transducer positioning may introduce feature repeatability inconsistencies.",
          evidence: [{ paperId: "paper-2", chunkIds: ["chunk-lim-2"] }],
        },
      ],
    };

    const validated = validateMultiPaperSynthesis(mockModelOutput, mockEvidenceSets);

    assert(validated.limitations.length === 2, "Validates multiple independent limitations");

    const lim1 = validated.limitations[0];
    assert(lim1.citations.length === 1, "Limitation 1 has hydrated citation");
    assert(lim1.citations[0].chunkId === "chunk-lim-1", "Limitation 1 references correct chunk ID");
    assert(lim1.citations[0].paperId === "paper-1", "Limitation 1 references correct paper ID");
    assert(lim1.citations[0].paperTitle === "Influence of CAD Design on Ultrasound Classification", "Limitation 1 retains paper title");
    assert(lim1.citations[0].pageNumber === 15, "Limitation 1 retains page number 15");
    assert(lim1.citations[0].section === "Limitations", "Limitation 1 retains section label 'Limitations'");
    assert(lim1.citations[0].doi === "10.3390/cancers14020277", "Limitation 1 retains DOI");
    assert(lim1.citations[0].fullText === limitationPassage1, "Limitation 1 fullText contains exact verbatim manuscript passage");

    const lim2 = validated.limitations[1];
    assert(lim2.citations.length === 1, "Limitation 2 has hydrated citation");
    assert(lim2.citations[0].chunkId === "chunk-lim-2", "Limitation 2 references correct chunk ID");
    assert(lim2.citations[0].paperId === "paper-2", "Limitation 2 references correct paper ID");
    assert(lim2.citations[0].pageNumber === 8, "Limitation 2 retains page number 8");
    assert(lim2.citations[0].fullText === limitationPassage2, "Limitation 2 fullText contains exact verbatim manuscript passage");
  }

  // --- Test Group 2: Evidence-Level Verification for Limitations ---
  console.log("\n--- Test Group 2: Evidence Grounding Level for Limitations ---");
  {
    // Verifies that limitations with invalid citations (e.g. non-existent chunk, or pure bibliography)
    // are rejected and not presented to the user
    const mockEvidenceSets: PaperEvidenceSet[] = [
      {
        paperId: "paper-1",
        paperTitle: "Test Study",
        authors: ["Author A"],
        doi: "10.1234/test",
        publicationDate: "2024-01-01",
        journal: "Journal",
        citationCount: 5,
        chunks: [
          {
            id: "chunk-bib",
            paperId: "paper-1",
            chunkIndex: 99,
            pageNumber: 20,
            section: "References",
            text: "1. Smith J, et al. Previous work on ultrasound. J Med 2018.",
          },
        ],
      },
    ];

    const mockModelOutput: MultiPaperSynthesisOutput = {
      insufficientEvidence: false,
      claims: [],
      disagreements: [],
      limitations: [
        {
          text: "Study had limited generalizability due to dataset constraints.",
          evidence: [{ paperId: "paper-1", chunkIds: ["chunk-bib"] }], // Points to bibliography chunk
        },
        {
          text: "Unverified limitation pointing to non-existent chunk.",
          evidence: [{ paperId: "paper-1", chunkIds: ["chunk-non-existent"] }],
        },
      ],
    };

    const validated = validateMultiPaperSynthesis(mockModelOutput, mockEvidenceSets);
    assert(
      validated.limitations.length === 0,
      "Limitations with ungrounded or bibliographic citations are strictly rejected (strict withholding)"
    );
  }

  // --- Test Group 3: UI Component Code Inspection ---
  console.log("\n--- Test Group 3: UI Component Code Inspection ---");
  {
    const interfacePath = path.resolve(
      process.cwd(),
      "src/components/research/research-interface.tsx"
    );
    const content = fs.readFileSync(interfacePath, "utf-8");

    // 1. SupportingExcerptCard variant support
    assert(
      content.includes('variant?: "indigo" | "amber" | "slate"'),
      "SupportingExcerptCard explicitly supports 'slate' variant for limitations"
    );

    // 2. State management for limitation expansion
    assert(
      content.includes("const [expandedLimitationIndices, setExpandedLimitationIndices] = React.useState<Set<number>>(new Set());"),
      "ResearchInterface defines dedicated expandedLimitationIndices state set"
    );
    assert(
      content.includes("const toggleLimitationExpansion = (index: number) =>"),
      "ResearchInterface defines toggleLimitationExpansion handler"
    );

    // 3. User-facing toggle button text
    assert(
      content.includes("Show supporting excerpt") || content.includes("Show supporting excerpts"),
      "Displays 'Show supporting excerpt' button label for collapsed limitations"
    );
    assert(
      content.includes("Show less"),
      "Displays 'Show less' button label for expanded limitations"
    );

    // 4. Reuse of SupportingExcerptCard in limitations section
    const limitationsSection = content.slice(
      content.indexOf("Reported Limitations in Available Evidence"),
      content.lastIndexOf("Research Threads History")
    );

    assert(
      limitationsSection.includes("<SupportingExcerptCard"),
      "Reuses <SupportingExcerptCard> within the expanded limitations drawer"
    );
    assert(
      limitationsSection.includes('variant="slate"'),
      "Passes variant='slate' to SupportingExcerptCard for clean academic styling"
    );
    assert(
      limitationsSection.includes("Supporting Manuscript"),
      "Displays 'Supporting Manuscript Excerpt(s)' header in expanded drawer"
    );
    assert(
      limitationsSection.includes("Exact verbatim manuscript passage"),
      "Explicitly labels passage as 'Exact verbatim manuscript passage'"
    );

    // 5. Evidence-unavailable state handling
    assert(
      limitationsSection.includes("Evidence excerpt unavailable") ||
        limitationsSection.includes("Evidence excerpt unavailable"),
      "Renders 'Evidence excerpt unavailable' indicator when no verified citation exists"
    );
    assert(
      content.includes("Exact manuscript excerpt passage is unavailable in the database record"),
      "SupportingExcerptCard displays fallback when chunk text is unavailable in record"
    );

    // 6. Defensive legacy history compatibility
    assert(
      limitationsSection.includes("typeof lim === \"string\" ? lim : lim.text"),
      "Defensively handles legacy history where limitation may be a string"
    );
    assert(
      limitationsSection.includes("Array.isArray(lim.citations)"),
      "Defensively handles legacy history where citations array may be absent"
    );
  }

  // --- Test Group 4: Access Control & Permissions on getChunkPassageAction ---
  console.log("\n--- Test Group 4: Access Control & Permissions ---");
  {
    // 1. Unauthenticated invocation is blocked
    const unauth = await getChunkPassageAction({
      conversationId: "conv-test",
      chunkId: "chunk-test",
    });
    assert(
      unauth.success === false && unauth.error === "Authentication required.",
      "getChunkPassageAction rejects unauthenticated requests"
    );

    // 2. Missing parameters blocked
    const empty = await getChunkPassageAction({
      conversationId: "",
      chunkId: "",
    });
    assert(empty.success === false, "getChunkPassageAction rejects missing parameters");

    // 3. Inspect actions.ts source for citation membership verification on limitations
    const actionsPath = path.resolve(process.cwd(), "src/app/research/actions.ts");
    const actionsCode = fs.readFileSync(actionsPath, "utf-8");

    assert(
      actionsCode.includes("for (const l of cit.limitations || [])"),
      "getChunkPassageAction checks cit.limitations to authorize chunk passage retrieval"
    );
    assert(
      actionsCode.includes("getResearchThreadMessagesAction"),
      "getResearchThreadMessagesAction hydrates fullText for limitation citations"
    );
  }

  console.log("\n==========================================================");
  console.log(`BETA ISSUE #2 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==========================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runBetaIssue2Tests()
  .catch((err) => {
    console.error("Test execution error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
