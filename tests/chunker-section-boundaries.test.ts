import { chunkManuscriptPages } from "../src/lib/pdf/chunker";
import { ExtractedPage } from "../src/lib/pdf/extractor";

async function runChunkerSectionTests() {
  console.log("==========================================================");
  console.log("TEST SUITE: SECTION-AWARE MANUSCRIPT CHUNKING REGRESSION");
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

  // =========================================================================
  // TEST GROUP 1: MENGO REPRODUCTION (6 short sections on 1 page < 1000 chars)
  // =========================================================================
  console.log("--- TEST GROUP 1: MENGO MANUSCRIPT REPRODUCTION ---");

  const mengoPageText = `
Abstract
This clinical study assesses deep learning classification of B-mode ultrasound liver images in clinical care.

Introduction
Hepatic ultrasonography represents the first-line diagnostic modality for screening diffuse and focal liver abnormalities.

Methods
A retrospective dataset of 200 validated abdominal examinations from Mengo Hospital was evaluated using ResNet architectures.

Results
The ResNet classifier achieved 94.9 percent overall accuracy, 92.2 percent sensitivity, and 97.0 percent specificity for focal lesions.

Limitations
Retrospective retrieval introduced operator variability across ultrasound machines and acoustic shadow artifacts.

Conclusion
Deep neural models exhibit clinical utility for assisting sonographers in identifying focal hepatic pathologies.
`.trim();

  const totalChars = mengoPageText.length;
  assert(
    totalChars < 1000,
    "Mengo input verification: total text is strictly below 1000-character target",
    `actual length: ${totalChars}`
  );

  const mengoPages: ExtractedPage[] = [
    {
      pageNumber: 1,
      text: mengoPageText,
    },
  ];

  const mengoChunks = chunkManuscriptPages("mengo-test-paper", mengoPages);

  // Assertion 1: Must produce 6 separate chunks, one per major section
  assert(
    mengoChunks.length === 6,
    "Mengo failure resolved: generates 6 distinct chunks instead of lumping into 1",
    `expected 6, got ${mengoChunks.length}`
  );

  // Assertion 2: Chunk order and section identities
  const expectedSections = [
    "Abstract",
    "Introduction",
    "Methods",
    "Results",
    "Limitations",
    "Conclusion",
  ];

  for (let i = 0; i < expectedSections.length; i++) {
    const chunk = mengoChunks[i];
    const expSec = expectedSections[i];
    assert(
      chunk && chunk.section === expSec,
      `Chunk #${i} is correctly labeled section '${expSec}'`,
      `got ${chunk?.section}`
    );
  }

  // Assertion 3: Results must remain Results
  const resultsChunk = mengoChunks.find((c) => c.section === "Results");
  assert(
    !!resultsChunk &&
      resultsChunk.text.includes("94.9 percent overall accuracy") &&
      resultsChunk.text.includes("97.0 percent specificity"),
    "Results section remains 'Results' and retains accurate empirical metrics"
  );

  // Assertion 4: Limitations must remain Limitations (NOT swallowed into Conclusion)
  const limitationsChunk = mengoChunks.find((c) => c.section === "Limitations");
  assert(
    !!limitationsChunk &&
      limitationsChunk.section === "Limitations" &&
      limitationsChunk.text.includes("operator variability across ultrasound machines"),
    "Limitations section remains 'Limitations' and retains verbatim limitation prose"
  );

  // Assertion 5: Conclusion must remain Conclusion
  const conclusionChunk = mengoChunks.find((c) => c.section === "Conclusion");
  assert(
    !!conclusionChunk &&
      conclusionChunk.section === "Conclusion" &&
      conclusionChunk.text.includes("clinical utility for assisting sonographers"),
    "Conclusion section remains 'Conclusion' and retains conclusion prose"
  );

  // Assertion 6: No section inherits another section's label
  const resultsContainsLimitation =
    resultsChunk?.text.includes("Retrospective retrieval") || false;
  const conclusionContainsResults =
    conclusionChunk?.text.includes("94.9 percent") || false;
  const limitationsContainsConclusion =
    limitationsChunk?.text.includes("Deep neural models") || false;

  assert(
    !resultsContainsLimitation &&
      !conclusionContainsResults &&
      !limitationsContainsConclusion,
    "No section contamination: chunks do not contain text from adjacent sections"
  );

  // Assertion 7: Page number provenance
  const allPage1 = mengoChunks.every((c) => c.pageNumber === 1);
  assert(allPage1, "All Mengo chunks strictly preserve pageNumber: 1");

  // =========================================================================
  // TEST GROUP 2: SHORT SECTIONS AND MEANINGLESS CHUNK FILTERING
  // =========================================================================
  console.log("\n--- TEST GROUP 2: SHORT SECTIONS AND MEANINGLESS CHUNKS ---");

  const tinySectionPage: ExtractedPage = {
    pageNumber: 2,
    text: `
Results
The model achieved high accuracy on validation data.

Limitations
Single site study.

Conclusion
Effective tool.

References
1
.
`.trim(),
  };

  const tinyChunks = chunkManuscriptPages("tiny-test-paper", [tinySectionPage]);

  // Results: "The model achieved high accuracy on validation data." (52 chars) -> valid chunk
  // Limitations: "Single site study." (18 chars -> < 20 chars, check if filtered or handled)
  // Conclusion: "Effective tool." (15 chars -> < 20 chars)
  // References: "1\n." (3 chars -> meaningless, must NOT create a chunk)

  const referencesChunk = tinyChunks.find((c) => c.section === "References");
  assert(
    !referencesChunk,
    "Meaningless chunk rejection: 3-character stray reference does not create an empty/garbage chunk"
  );

  const resultsTiny = tinyChunks.find((c) => c.section === "Results");
  assert(
    !!resultsTiny && resultsTiny.section === "Results",
    "Short 50-character Results section is safely preserved as a dedicated chunk"
  );

  // =========================================================================
  // TEST GROUP 3: MULTI-PAGE REALISTIC MANUSCRIPT (No Regression)
  // =========================================================================
  console.log("\n--- TEST GROUP 3: MULTI-PAGE REALISTIC MANUSCRIPT ---");

  const p1Text = `
Abstract
This paper introduces an advanced neural architecture for high-resolution medical ultrasound analysis.

Introduction
Medical ultrasound imaging is non-invasive and widely deployed across global hospitals.
However, acoustic speckle noise and operator variation frequently introduce diagnostic ambiguity.
Previous methods have applied standard convolutional neural networks with limited success.
Our work proposes a novel spatial attention mechanism specifically tailored to speckle reduction.
`.trim();

  const p2Text = `
Methods
We collected 1200 B-mode ultrasound scans from three participating academic clinical centers.
Each scan was annotated by two board-certified radiologists with over ten years of experience.
The network backbone utilizes residual connections with dual-attention blocks.
Training was conducted over 100 epochs using AdamW optimization with cosine learning rate decay.
Data augmentation included random affine rotations, gamma adjustment, and elastic deformation.
`.trim();

  const p3Text = `
Results
On the independent test cohort of 300 scans, the model attained an area under the curve of 0.962.
Sensitivity reached 93.4 percent and specificity was measured at 95.1 percent.
Comparison with baseline ResNet-50 demonstrated a statistically significant improvement of p < 0.001.

Discussion
These findings demonstrate that spatial attention mechanisms are capable of filtering speckle noise.
Sonographers reported faster diagnosis times when using model predictions as a second opinion.

Limitations
The dataset was collected exclusively on high-end cart-based ultrasound machines.
Performance on portable point-of-care ultrasound devices was not evaluated.
`.trim();

  const multiPages: ExtractedPage[] = [
    { pageNumber: 1, text: p1Text },
    { pageNumber: 2, text: p2Text },
    { pageNumber: 3, text: p3Text },
  ];

  const multiChunks = chunkManuscriptPages("multi-test-paper", multiPages);

  assert(
    multiChunks.length >= 6,
    "Multi-page manuscript correctly partitioned across sections and pages",
    `chunk count: ${multiChunks.length}`
  );

  const page1Chunks = multiChunks.filter((c) => c.pageNumber === 1);
  const page2Chunks = multiChunks.filter((c) => c.pageNumber === 2);
  const page3Chunks = multiChunks.filter((c) => c.pageNumber === 3);

  assert(
    page1Chunks.length >= 2,
    "Page 1 contains Abstract and Introduction chunks",
    `count: ${page1Chunks.length}`
  );
  assert(
    page2Chunks.every((c) => c.section === "Methods"),
    "Page 2 chunks all strictly inherit 'Methods' section"
  );
  assert(
    page3Chunks.some((c) => c.section === "Results") &&
      page3Chunks.some((c) => c.section === "Discussion") &&
      page3Chunks.some((c) => c.section === "Limitations"),
    "Page 3 preserves Results, Discussion, and Limitations independently"
  );

  // Check section identities across page 3
  const p3Results = page3Chunks.find((c) => c.section === "Results");
  const p3Limits = page3Chunks.find((c) => c.section === "Limitations");
  assert(
    !!p3Results && !p3Results.text.includes("portable point-of-care"),
    "Page 3 Results chunk does not leak into Limitations"
  );
  assert(
    !!p3Limits && p3Limits.text.includes("portable point-of-care"),
    "Page 3 Limitations chunk preserves dedicated limitations statement"
  );

  // Summary
  console.log("\n==========================================================");
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log("==========================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runChunkerSectionTests().catch((err) => {
  console.error("Test execution threw error:", err);
  process.exit(1);
});
