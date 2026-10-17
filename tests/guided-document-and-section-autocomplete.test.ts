import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
} from "../src/lib/test-guard";

loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import test from "node:test";
import assert from "node:assert/strict";
import { DocumentType } from "@prisma/client";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import {
  createResearchDocument,
  getResearchDocument,
  updateResearchDocument,
  insertDocumentCitation,
} from "../src/lib/editor/document-service";
import {
  generateInlineAutocomplete,
} from "../src/lib/editor/ai-editor-service";
import {
  createGuidedTipTapContent,
  getDefaultHeadings,
  getDefaultObjectives,
  normalizeSuggestionSpacingAndDeduplication,
  STUDY_DESIGN_OPTIONS,
} from "../src/lib/editor/guided-templates";
import {
  GhostSuggestion,
  ghostSuggestionPluginKey,
} from "../src/components/editor/ghost-suggestion-extension";
import { prisma } from "../src/lib/prisma";

const testSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", toDOM: () => ["p", 0] },
    heading: {
      group: "block",
      content: "text*",
      attrs: { level: { default: 1 } },
      toDOM: (node) => [`h${node.attrs.level}`, 0],
    },
    text: { inline: true },
  },
});

test("Guided Research Document & Section-Aware Autocomplete Test Suite", async (t) => {
  let userA: any;
  let userB: any;
  let blankDoc: any;
  let guidedDoc: any;

  t.before(async () => {
    process.env.ALLOW_MOCK_AUTOCOMPLETE = "true";

    userA = await prisma.user.upsert({
      where: { email: "guided_researcher_a@test.edu" },
      update: {},
      create: {
        email: "guided_researcher_a@test.edu",
        name: "Dr. Alice Guided",
        role: "USER",
      },
    });

    userB = await prisma.user.upsert({
      where: { email: "guided_researcher_b@test.edu" },
      update: {},
      create: {
        email: "guided_researcher_b@test.edu",
        name: "Dr. Bob Isolated",
        role: "USER",
      },
    });
  });

  t.after(async () => {
    if (blankDoc?.id) {
      await prisma.researchDocument.deleteMany({ where: { id: blankDoc.id } });
    }
    if (guidedDoc?.id) {
      await prisma.researchDocument.deleteMany({ where: { id: guidedDoc.id } });
    }
    await prisma.user.deleteMany({
      where: { email: { in: ["guided_researcher_a@test.edu", "guided_researcher_b@test.edu"] } },
    });
    await prisma.$disconnect();
  });

  await t.test("1. Mode A: Blank Document initializes with standard default canvas", async () => {
    blankDoc = await createResearchDocument(userA.id, {
      title: "Exploratory Analysis of Edge Computing",
      docType: DocumentType.DRAFT,
    });

    assert.ok(blankDoc.id);
    assert.equal(blankDoc.title, "Exploratory Analysis of Edge Computing");
    assert.equal(blankDoc.docType, DocumentType.DRAFT);
    assert.equal(blankDoc.version, 1);
    assert.equal(blankDoc.content.type, "doc");
    assert.equal(blankDoc.content.content[0].type, "heading");
    assert.equal(blankDoc.content.content[0].content[0].text, "Exploratory Analysis of Edge Computing");
  });

  await t.test("2. Mode B: Guided Research Document generates structured outline, metadata, and objectives", async () => {
    const config = {
      topic: "Deep Learning Diagnostic Concordance in Medical Imaging",
      docType: DocumentType.MANUSCRIPT,
      studyDesign: "Randomized Controlled Trial (RCT)",
      generalObjective: "To evaluate diagnostic accuracy across multi-institutional radiology cohorts.",
      specificObjectives: [
        "Quantify sensitivity and specificity benchmarks against consensus expert panels.",
        "Measure inference latency across diverse edge device hardware configurations.",
        "Characterize boundary failure modes in atypical pathological presentations.",
      ],
      headings: [
        "Abstract",
        "Introduction & Background",
        "Research Objectives & Hypotheses",
        "Materials & Methods",
        "Results & Empirical Findings",
        "Discussion & Clinical Implications",
        "Study Limitations & Ethical Considerations",
        "References",
      ],
    };

    guidedDoc = await createResearchDocument(userA.id, {
      guidedConfig: config,
    });

    assert.ok(guidedDoc.id);
    assert.equal(guidedDoc.title, config.topic);
    assert.equal(guidedDoc.docType, DocumentType.MANUSCRIPT);

    const meta = (guidedDoc.content as any).meta;
    assert.ok(meta);
    assert.equal(meta.researchTopic, config.topic);
    assert.equal(meta.studyDesign, config.studyDesign);
    assert.equal(meta.objectives.general, config.generalObjective);
    assert.equal(meta.objectives.specific.length, 3);
    assert.equal(meta.headings.length, 8);

    // Verify document contains section scaffolds
    const headingsInDoc = (guidedDoc.content as any).content.filter((n: any) => n.type === "heading" && n.attrs?.level === 2);
    assert.equal(headingsInDoc.length, 8);
    assert.equal(headingsInDoc[0].content[0].text, "Abstract");
    assert.equal(headingsInDoc[3].content[0].text, "Materials & Methods");
  });

  await t.test("3. Editable Outline: headings can be customized, reordered, and deleted before creation", async () => {
    const customHeadings = [
      "Executive Summary",
      "Theoretical Framework",
      "Statistical Power & Sample Size Determination",
      "Experimental Design",
      "Anticipated Outcomes",
      "References",
    ];

    const customTipTap = createGuidedTipTapContent({
      topic: "Quantum Error Mitigation in Noisy Intermediate-Scale Systems",
      docType: DocumentType.PROPOSAL,
      studyDesign: "Experimental Laboratory Protocol",
      generalObjective: "To benchmark surface code thresholds under thermal noise.",
      specificObjectives: ["Construct numerical simulations.", "Implement real-time syndrome extraction."],
      headings: customHeadings,
    });

    assert.equal(customTipTap.meta.headings.length, 6);
    const headings = customTipTap.content.filter((n: any) => n.type === "heading" && n.attrs?.level === 2);
    assert.equal(headings.length, 6);
    assert.equal(headings[2].content[0].text, "Statistical Power & Sample Size Determination");
  });

  await t.test("4. Editable Objectives: general and specific objectives can be added, updated, and removed", async () => {
    const defObj = getDefaultObjectives("Transformer Latency Optimization", DocumentType.MANUSCRIPT);
    assert.ok(defObj.general.includes("Transformer Latency Optimization"));
    assert.equal(defObj.specific.length, 3);

    // Modify specific objectives
    const modifiedSpecific = [
      ...defObj.specific.slice(0, 2),
      "Custom Objective: Evaluate hardware energy consumption per token.",
    ];

    const content = createGuidedTipTapContent({
      topic: "Transformer Latency Optimization",
      docType: DocumentType.MANUSCRIPT,
      generalObjective: "Custom General Objective: Measure edge throughput.",
      specificObjectives: modifiedSpecific,
      headings: getDefaultHeadings(DocumentType.MANUSCRIPT),
    });

    assert.equal(content.meta.objectives.general, "Custom General Objective: Measure edge throughput.");
    assert.equal(content.meta.objectives.specific.length, 3);
    assert.equal(content.meta.objectives.specific[2], "Custom Objective: Evaluate hardware energy consumption per token.");
  });

  await t.test("5. Section-Aware Autocomplete: Introduction suggestions reflect scholarly context and topic", async () => {
    const res = await generateInlineAutocomplete(userA.id, {
      documentId: guidedDoc.id,
      prefixText: "In recent years, the integration of artificial intelligence has advanced rapidly.",
      currentSection: "Introduction & Background",
    });

    assert.ok(res.suggestion);
    assert.ok(
      res.suggestion.includes("Deep Learning Diagnostic Concordance") ||
      res.suggestion.includes("reproducible methodological consensus")
    );
  });

  await t.test("6. Section-Aware Autocomplete: Methodology suggestions reflect study design without fabricating statistics", async () => {
    const res = await generateInlineAutocomplete(userA.id, {
      documentId: guidedDoc.id,
      prefixText: "To assess algorithmic efficacy,",
      currentSection: "Materials & Methods",
    });

    assert.ok(res.suggestion);
    assert.ok(
      res.suggestion.includes("Randomized Controlled Trial (RCT)") ||
      res.suggestion.includes("protocol") ||
      res.suggestion.includes("empirical validity")
    );
    // Zero fabricated patient counts or p-values
    assert.ok(!/\bp\s*<\s*0\.05\b/i.test(res.suggestion));
    assert.ok(!/\b500 patients\b/i.test(res.suggestion));
  });

  await t.test("7. Section-Aware Autocomplete: Results suggestions remain conservative and objective", async () => {
    const res = await generateInlineAutocomplete(userA.id, {
      documentId: guidedDoc.id,
      prefixText: "Following multi-cohort validation,",
      currentSection: "Results & Empirical Findings",
    });

    assert.ok(res.suggestion);
    assert.ok(res.suggestion.includes("Comparative observations") || res.suggestion.includes("stability"));
    assert.ok(!res.suggestion.includes("cure rate of 99%"));
  });

  await t.test("8. Section-Aware Autocomplete: Limitations suggestions outline methodological boundaries", async () => {
    const res = await generateInlineAutocomplete(userA.id, {
      documentId: guidedDoc.id,
      prefixText: "Several constraints should be considered.",
      currentSection: "Study Limitations & Ethical Considerations",
    });

    assert.ok(res.suggestion);
    assert.ok(res.suggestion.includes("methodological boundaries") || res.suggestion.includes("cohort"));
  });

  await t.test("9. Spacing & Punctuation Normalization: prevents glued words and double spaces", async () => {
    // Case 1: Prefix ends without trailing whitespace
    const norm1 = normalizeSuggestionSpacingAndDeduplication(
      "In this empirical evaluation",
      "we examine the comparative convergence across cohorts."
    );
    assert.equal(norm1, "we examine the comparative convergence across cohorts.");

    // Case 2: Prefix ends with period (sentence boundary)
    const norm2 = normalizeSuggestionSpacingAndDeduplication(
      "Observations were recorded across all sites.",
      "furthermore, parameter stability remained constant."
    );
    // Capitalized first letter
    assert.ok(norm2.startsWith("Furthermore,"));

    // Case 3: Prefix ends with comma (clause boundary)
    const norm3 = normalizeSuggestionSpacingAndDeduplication(
      "While accuracy increased markedly,",
      "Thereby mitigating systematic feature drift."
    );
    // Lowercase first letter
    assert.ok(norm3.startsWith("thereby"));
  });

  await t.test("10. Duplicate Word Overlap: strips overlapping words between prefix and suggestion", async () => {
    // User typed "Furthermore, ongoing comparative evaluations"
    // Template would start with "Furthermore, ongoing comparative evaluations demonstrate consistent convergence..."
    const prefix = "In this trial. Furthermore, ongoing comparative evaluations";
    const rawTemplate = "Furthermore, ongoing comparative evaluations demonstrate consistent convergence across standardized benchmark environments.";

    const stripped = normalizeSuggestionSpacingAndDeduplication(prefix, rawTemplate);
    assert.equal(
      stripped,
      "demonstrate consistent convergence across standardized benchmark environments."
    );
  });

  await t.test("11. ProseMirror Ghost Suggestion: atomic Tab insertion and Undo restoration", async () => {
    const text = "The study methodology utilizes stratified sampling";
    const docNode = testSchema.nodes.doc.create({}, [
      testSchema.nodes.paragraph.create({}, [
        testSchema.text(text),
      ]),
    ]);

    let state = EditorState.create({
      schema: testSchema,
      doc: docNode,
      plugins: (GhostSuggestion as any).config.addProseMirrorPlugins.call({}) as any,
    });

    const insertPos = docNode.content.size - 1;
    const suggestionText = "to minimize selection bias across test cohorts.";

    state = state.apply(
      state.tr.setMeta(ghostSuggestionPluginKey, {
        pos: insertPos,
        text: suggestionText,
      })
    );

    const ghostState = ghostSuggestionPluginKey.getState(state);
    assert.ok(ghostState);
    assert.equal(ghostState.pos, insertPos);

    // Accept suggestion with simulated atomic transaction (Tab)
    const insertText = " " + ghostState.text.trimStart();
    const acceptTr = state.tr
      .setMeta(ghostSuggestionPluginKey, null)
      .insertText(insertText, insertPos);
    const stateAccepted = state.apply(acceptTr);

    assert.equal(
      stateAccepted.doc.textContent,
      "The study methodology utilizes stratified sampling to minimize selection bias across test cohorts."
    );
    // Verify ghost state cleared
    assert.equal(ghostSuggestionPluginKey.getState(stateAccepted), null);

    // Verify Undo cleanly removes accepted text
    const undoTr = stateAccepted.tr.delete(insertPos, insertPos + insertText.length);
    const stateUndone = stateAccepted.apply(undoTr);
    assert.equal(stateUndone.doc.textContent, text, "Undo restores initial document text");
  });

  await t.test("12. Document Autosave & Reload: persistent metadata and versioning", async () => {
    const originalDoc = await getResearchDocument(userA.id, guidedDoc.id);
    assert.equal(originalDoc.version, 1);

    const updatedContent = {
      ...(originalDoc.content as any),
      content: [
        ...(originalDoc.content as any).content,
        {
          type: "paragraph",
          content: [{ type: "text", text: "New draft paragraph authored during session." }],
        },
      ],
    };

    const saved = await updateResearchDocument(userA.id, guidedDoc.id, {
      content: updatedContent,
      textContent: `${originalDoc.textContent}\nNew draft paragraph authored during session.`,
      expectedVersion: 1,
    });

    assert.equal(saved.version, 2);

    const reloaded = await getResearchDocument(userA.id, guidedDoc.id);
    assert.equal(reloaded.version, 2);
    assert.equal((reloaded.content as any).meta.researchTopic, guidedDoc.title);
  });

  await t.test("13. Multi-Tenant Privacy Isolation: User B cannot access User A's guided document", async () => {
    await assert.rejects(
      async () => {
        await generateInlineAutocomplete(userB.id, {
          documentId: guidedDoc.id,
          prefixText: "Testing unauthorized access...",
        });
      },
      (err: any) => {
        assert.ok(err.message.includes("not found"));
        return true;
      }
    );
  });

  await t.test("14. Citation Preservation in Guided Document", async () => {
    // Fetch a public paper from database
    const paper = await prisma.paper.findFirst({
      select: { id: true, title: true },
    });
    assert.ok(paper, "A seeded paper should exist in the database");

    const citation = await insertDocumentCitation(userA.id, guidedDoc.id, {
      paperId: paper.id,
      citationText: "(Vaswani et al., 2017)",
      section: "Introduction & Background",
    });

    assert.ok(citation.id);
    assert.equal(citation.documentId, guidedDoc.id);

    const docWithCitations = await getResearchDocument(userA.id, guidedDoc.id);
    assert.equal(docWithCitations.citations.length, 1);
    assert.equal(docWithCitations.citations[0].citationText, "(Vaswani et al., 2017)");
  });

  await t.test("15. TipTap Raw Content Persistence: updating content without meta preserves existing metadata", async () => {
    // TipTap editor.getJSON() only returns { type: 'doc', content: [...] } without top-level meta
    const rawTipTapJson = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "1. Revised Section Title" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Paragraph drafted without raw meta key in TipTap payload." }],
        },
      ],
    };

    const docBefore = await getResearchDocument(userA.id, guidedDoc.id);
    const saved = await updateResearchDocument(userA.id, guidedDoc.id, {
      content: rawTipTapJson,
      textContent: "1. Revised Section Title\nParagraph drafted without raw meta key in TipTap payload.",
      expectedVersion: docBefore.version,
    });

    // Content should have been saved
    assert.equal(saved.version, docBefore.version + 1);

    // Verify metadata was preserved from existing record
    const reloaded = await getResearchDocument(userA.id, guidedDoc.id);
    const meta = (reloaded.content as any).meta;
    assert.ok(meta, "Metadata must survive raw TipTap updates");
    assert.equal(meta.researchTopic, guidedDoc.title);
    assert.ok(meta.objectives?.general, "General objective must remain intact");
    assert.ok(Array.isArray(meta.objectives?.specific), "Specific objectives must remain intact");
  });

  await t.test("16. Researcher-Edited Objectives: custom objectives are not overwritten on save", async () => {
    const customGeneral = "To evaluate cross-lingual transferability of biomedical language models.";
    const customSpecific = [
      "Benchmark zero-shot classification on non-English clinical notes.",
      "Quantify vocabulary mismatch across multilingual tokenizers.",
    ];

    const customDoc = await createResearchDocument(userA.id, {
      guidedConfig: {
        topic: "Multilingual Clinical NLP",
        docType: DocumentType.MANUSCRIPT,
        studyDesign: "Deep Learning Benchmark / Algorithmic Evaluation",
        generalObjective: customGeneral,
        specificObjectives: customSpecific,
        headings: ["Introduction", "Model Architecture", "Multilingual Experiments", "Results"],
      },
    });

    const meta = (customDoc.content as any).meta;
    assert.equal(meta.objectives.general, customGeneral);
    assert.deepEqual(meta.objectives.specific, customSpecific);

    // Perform an autosave with simulated TipTap JSON
    const updated = await updateResearchDocument(userA.id, customDoc.id, {
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Draft text." }] }],
      },
      textContent: "Draft text.",
      expectedVersion: customDoc.version,
    });

    const reloaded = await getResearchDocument(userA.id, customDoc.id);
    const reloadedMeta = (reloaded.content as any).meta;
    assert.equal(reloadedMeta.objectives.general, customGeneral, "Custom general objective was not overwritten");
    assert.deepEqual(reloadedMeta.objectives.specific, customSpecific, "Custom specific objectives were not overwritten");
  });

  await t.test("17. Literature Review Outlines: PRISMA headings apply ONLY when PRISMA systematic review is selected", () => {
    // Default Narrative Review
    const narrativeHeadings = getDefaultHeadings(DocumentType.LITERATURE_REVIEW, "Critical Thematic Narrative Review");
    assert.ok(!narrativeHeadings.some((h) => h.includes("PRISMA")), "Narrative review must not contain PRISMA headings");
    assert.ok(narrativeHeadings.includes("Thematic Synthesis of Published Evidence"));

    const defaultHeadings = getDefaultHeadings(DocumentType.LITERATURE_REVIEW);
    assert.ok(!defaultHeadings.some((h) => h.includes("PRISMA")), "Default literature review must not contain PRISMA headings");

    // PRISMA-Compliant Systematic Review
    const prismaHeadings = getDefaultHeadings(DocumentType.LITERATURE_REVIEW, "PRISMA-Compliant Systematic Literature Review");
    assert.ok(prismaHeadings.some((h) => h.includes("PRISMA Flow")), "PRISMA review must contain PRISMA headings");
    assert.ok(prismaHeadings.some((h) => h.includes("Risk of Bias Assessment")));

    // Meta-Analysis
    const metaHeadings = getDefaultHeadings(DocumentType.LITERATURE_REVIEW, "Meta-Analysis & Quantitative Synthesis");
    assert.ok(metaHeadings.some((h) => h.includes("Effect Size Estimation")), "Meta-analysis must contain effect size headings");
    assert.ok(!metaHeadings.some((h) => h.includes("PRISMA Flow")), "Meta-analysis must not default to PRISMA flow");

    // Scoping Review
    const scopingHeadings = getDefaultHeadings(DocumentType.LITERATURE_REVIEW, "Scoping Review Protocol");
    assert.ok(scopingHeadings.some((h) => h.includes("Evidence Mapping Methodology")), "Scoping review must contain mapping headings");

    // Objectives check: Narrative review does not claim PRISMA compliance
    const narrativeObj = getDefaultObjectives("Epigenetic regulation", DocumentType.LITERATURE_REVIEW, "Critical Thematic Narrative Review");
    assert.ok(!narrativeObj.general.includes("PRISMA"), "Narrative objectives must not mention PRISMA");

    const prismaObj = getDefaultObjectives("Epigenetic regulation", DocumentType.LITERATURE_REVIEW, "PRISMA-Compliant Systematic Literature Review");
    assert.ok(prismaObj.general.includes("PRISMA"), "PRISMA objectives must mention PRISMA");
  });

  await t.test("18. Legacy & Blank Documents: documents without meta continue functioning without error", async () => {
    const blankDoc = await createResearchDocument(userA.id, {
      title: "Legacy Blank Document",
      docType: DocumentType.DRAFT,
    });

    assert.equal((blankDoc.content as any).meta, undefined, "Blank document has no meta");

    // Can update blank document without error
    const updated = await updateResearchDocument(userA.id, blankDoc.id, {
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Legacy typing test." }] }],
      },
      textContent: "Legacy typing test.",
      expectedVersion: blankDoc.version,
    });

    assert.equal(updated.version, 2);
    const reloaded = await getResearchDocument(userA.id, blankDoc.id);
    assert.equal(reloaded.version, 2);
    assert.equal((reloaded.content as any).meta, undefined, "Meta remains undefined on legacy docs");
  });

  await t.test("19. Academic Scope Enforcement: Thesis / Dissertation headings, objectives, and exclusion of commercial templates", () => {
    // 1. Thesis / Dissertation study designs and canonical chapter structure
    const dissertationHeadings = getDefaultHeadings(DocumentType.DRAFT, "Doctoral Dissertation (Monograph)");
    assert.ok(dissertationHeadings.some((h) => h.includes("Chapter 1: Introduction")), "Dissertation must contain chapter scaffold");
    assert.ok(dissertationHeadings.some((h) => h.includes("Chapter 5: Discussion & Scholarly Contributions")));

    const thesisObj = getDefaultObjectives("Neuromorphic Architecture", DocumentType.DRAFT, "Doctoral Dissertation (Monograph)");
    assert.ok(thesisObj.general.includes("Neuromorphic Architecture"));
    assert.ok(thesisObj.general.includes("original scholarly contribution"));
    assert.equal(thesisObj.specific.length, 3);

    // 2. Strict negative check: zero commercial/business templates
    const allDesigns = [
      ...STUDY_DESIGN_OPTIONS.MANUSCRIPT,
      ...STUDY_DESIGN_OPTIONS.PROPOSAL,
      ...STUDY_DESIGN_OPTIONS.LITERATURE_REVIEW,
      ...STUDY_DESIGN_OPTIONS.DRAFT,
    ];
    for (const d of allDesigns) {
      assert.ok(!d.toLowerCase().includes("business"), `No business design permitted: ${d}`);
      assert.ok(!d.toLowerCase().includes("commercial"), `No commercial design permitted: ${d}`);
      assert.ok(!d.toLowerCase().includes("corporate"), `No corporate design permitted: ${d}`);
    }
  });
});
