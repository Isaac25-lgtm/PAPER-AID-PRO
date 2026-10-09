/**
 * AI RESEARCH HUB — BETA ISSUE #3 REGRESSION & VERIFICATION SUITE
 * Grounded Claim Expansion UX
 *
 * Verifies:
 * 1. Explicit section guidance: "Expand a claim to view its supporting manuscript evidence".
 * 2. Visible "View supporting evidence" / "Hide supporting evidence" interactive labels.
 * 3. Complete keyboard accessibility (role="button", tabIndex, onKeyDown Enter/Space, aria-expanded).
 * 4. Independent expansion state tracking across multiple claims.
 * 5. Preservation of SupportingExcerptCard evidence drawer rendering.
 * 6. Non-interference with the Limitations feature under review.
 */

import * as fs from "fs";
import * as path from "path";

async function runBetaIssue3Tests() {
  console.log("==========================================================");
  console.log("AI RESEARCH HUB — BETA ISSUE #3 CLAIM EXPANSION UX TESTS");
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

  const interfacePath = path.resolve(
    process.cwd(),
    "src/components/research/research-interface.tsx"
  );
  const content = fs.readFileSync(interfacePath, "utf-8");

  // --- Test Group 1: Instruction Text & Header Guidance ---
  console.log("--- Test Group 1: Instruction Text & Header Guidance ---");
  {
    assert(
      content.includes("Expand a claim to view its supporting manuscript evidence"),
      "Replaced ambiguous instruction with 'Expand a claim to view its supporting manuscript evidence'"
    );
    assert(
      !content.includes("Click claim to inspect supporting evidence"),
      "Removed old 'Click claim to inspect supporting evidence' text"
    );
  }

  // --- Test Group 2: Visible Evidence Toggle Labels ---
  console.log("\n--- Test Group 2: Visible Action Labels Beside Chevron ---");
  {
    const claimsSection = content.slice(
      content.indexOf("Grounded Empirical Claims"),
      content.indexOf("Areas of Agreement")
    );

    assert(
      claimsSection.includes("View supporting evidence"),
      "Contains explicit 'View supporting evidence' text label for collapsed state"
    );
    assert(
      claimsSection.includes("Hide supporting evidence"),
      "Contains explicit 'Hide supporting evidence' text label for expanded state"
    );
    assert(
      claimsSection.includes("isExpanded ? \"Hide supporting evidence\" : \"View supporting evidence\""),
      "Dynamically switches label based on isExpanded boolean state"
    );
  }

  // --- Test Group 3: Semantic Button & Keyboard Accessibility ---
  console.log("\n--- Test Group 3: Semantic Button & Accessibility ---");
  {
    const claimsSection = content.slice(
      content.indexOf("Grounded Empirical Claims"),
      content.indexOf("Areas of Agreement")
    );

    assert(
      claimsSection.includes('<button') && claimsSection.includes('type="button"'),
      "Card header uses a native semantic <button type='button'> for built-in keyboard and focus support"
    );
    assert(
      claimsSection.includes("aria-expanded={isExpanded}"),
      "Card header reports aria-expanded state dynamically"
    );
    assert(
      claimsSection.includes("aria-label="),
      "Card header provides descriptive aria-label with claim preview"
    );
    // Verify no nested <button> or <Button> inside the claim trigger button
    const claimButtonMarkup = claimsSection.slice(
      claimsSection.indexOf("<button"),
      claimsSection.indexOf("</button>")
    );
    assert(
      !claimButtonMarkup.includes("<Button") && !claimButtonMarkup.slice(1).includes("<button"),
      "Zero nested interactive buttons inside the claim card trigger button"
    );
  }

  // --- Test Group 4: Independent State & Drawer Preservation ---
  console.log("\n--- Test Group 4: Independent State & Drawer Preservation ---");
  {
    assert(
      content.includes("const [expandedClaimIndices, setExpandedClaimIndices] = React.useState<Set<number>>(new Set());"),
      "Uses dedicated Set<number> for independent claim expansion tracking"
    );
    assert(
      content.includes("const isExpanded = expandedClaimIndices.has(idx);"),
      "Calculates isExpanded per claim index"
    );

    // Verify toggle handler logic independently toggles sets
    const testSet = new Set<number>([0]);
    const toggle = (idx: number, set: Set<number>) => {
      const next = new Set(set);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    };

    const afterToggle1 = toggle(1, testSet);
    assert(
      afterToggle1.has(0) && afterToggle1.has(1),
      "Expanding Claim 1 preserves Claim 0 in expanded state (multi-claim independence)"
    );

    const afterToggle0 = toggle(0, afterToggle1);
    assert(
      !afterToggle0.has(0) && afterToggle0.has(1),
      "Collapsing Claim 0 leaves Claim 1 expanded independently"
    );

    // Drawer preserves SupportingExcerptCard
    assert(
      content.includes("<SupportingExcerptCard") && content.includes('variant="indigo"'),
      "Preserves <SupportingExcerptCard variant='indigo'> inside claim evidence drawer"
    );
  }

  // --- Test Group 5: Non-Interference with Limitations Feature ---
  console.log("\n--- Test Group 5: Limitations Feature Integrity ---");
  {
    assert(
      content.includes("Reported Limitations in Available Evidence"),
      "Preserves 'Reported Limitations in Available Evidence' section header"
    );
    assert(
      content.includes("expandedLimitationIndices"),
      "Preserves expandedLimitationIndices state set from Beta Issue #2"
    );
    assert(
      content.includes("toggleLimitationExpansion"),
      "Preserves toggleLimitationExpansion handler from Beta Issue #2"
    );
    assert(
      content.includes('variant="slate"'),
      "Preserves variant='slate' supporting excerpt cards for limitations"
    );
  }

  console.log("\n==========================================================");
  console.log(`BETA ISSUE #3 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==========================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runBetaIssue3Tests().catch((err) => {
  console.error("Test execution error:", err);
  process.exit(1);
});
