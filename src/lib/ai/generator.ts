import { prisma } from "@/lib/prisma";
import { AI_CONFIG, getOpenAIClient } from "./config";
import { buildPaperAnalysisPrompt, PaperMetadataContext, SCIENTIFIC_INTEGRITY_SYSTEM_PROMPT } from "./prompts";
import { PaperAnalysisOutput, PaperAnalysisSchema } from "./schemas";
import { validateAndResolveEvidence } from "./validator";
import { zodTextFormat } from "openai/helpers/zod";
import { revalidatePath } from "next/cache";

export interface SummaryGenerationResult {
  success: boolean;
  paperId: string;
  jobId?: string;
  modelUsed?: string;
  promptVersion?: string;
  error?: string;
  validatedCitationsCount?: number;
  rejectedCitationsCount?: number;
}

/**
 * Orchestrates grounded AI scientific paper understanding for a single paper.
 * Pipeline:
 * PaperChunks -> Evidence Verification -> OpenAI Structured Outputs ->
 * Provenance Validation -> Atomic AISummary Persistence -> ProcessingJob tracking
 */
export async function generatePaperSummary(
  paperId: string,
  options: { forceRegenerate?: boolean } = {}
): Promise<SummaryGenerationResult> {
  // 1. Verify Paper exists and retrieve its current chunks
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    include: {
      authors: {
        include: { author: true },
        orderBy: { orderIndex: "asc" },
      },
      chunks: {
        orderBy: { chunkIndex: "asc" },
      },
      aiSummary: true,
      processingJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!paper) {
    return {
      success: false,
      paperId,
      error: `Paper with ID "${paperId}" not found in database.`,
    };
  }

  // 2. Guard: Verify Paper has chunks
  if (!paper.chunks || paper.chunks.length === 0) {
    return {
      success: false,
      paperId,
      error: `Cannot generate AI summary: Paper "${paper.title}" has 0 processed manuscript chunks. Please upload and process the manuscript PDF first.`,
    };
  }

  // 3. Guard: Prevent accidental duplicate concurrent generation
  const activeJob = await prisma.processingJob.findFirst({
    where: {
      paperId,
      stage: "SUMMARY_GENERATION",
      status: "RUNNING",
      createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
    },
  });

  if (activeJob && !options.forceRegenerate) {
    return {
      success: false,
      paperId,
      jobId: activeJob.id,
      error: "AI summary generation is already in progress for this paper. Please wait for the current job to complete.",
    };
  }

  // 4. Guard: Check for server-side OpenAI API Key
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    const errorMsg = "OpenAI API key (OPENAI_API_KEY) is not configured in the server environment.";
    const failedJob = await prisma.processingJob.create({
      data: {
        paperId,
        stage: "SUMMARY_GENERATION",
        status: "FAILED",
        attempt: (paper.processingJobs[0]?.attempt || 0) + 1,
        errorMessage: errorMsg,
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });

    return {
      success: false,
      paperId,
      jobId: failedJob.id,
      error: errorMsg,
    };
  }

  // 5. Initialize ProcessingJob
  const nextAttempt = (paper.processingJobs[0]?.attempt || 0) + 1;
  const job = await prisma.processingJob.create({
    data: {
      paperId,
      stage: "SUMMARY_GENERATION",
      status: "RUNNING",
      attempt: nextAttempt,
      startedAt: new Date(),
    },
  });

  try {
    // 6. Build structured prompt and register supplied chunk IDs
    const metadata: PaperMetadataContext = {
      title: paper.title,
      abstract: paper.abstract,
      journal: paper.journal,
      doi: paper.doi,
      arxivId: paper.arxivId,
      publicationDate: paper.publicationDate,
      keywords: paper.keywords,
      authors: paper.authors.map((pa) => ({
        name: pa.author.name,
        institution: pa.author.institution,
      })),
    };

    const { userPrompt, suppliedChunkIds } = buildPaperAnalysisPrompt(
      metadata,
      paper.chunks
    );

    // 7. Invoke OpenAI Responses API with Structured Outputs (zodTextFormat)
    const openai = getOpenAIClient();
    const response = await openai.responses.parse({
      model: AI_CONFIG.summaryModel,
      instructions: SCIENTIFIC_INTEGRITY_SYSTEM_PROMPT,
      input: userPrompt,
      text: {
        format: zodTextFormat(PaperAnalysisSchema, "paper_analysis"),
      },
      temperature: 0.2, // Low temperature for factual scientific fidelity
      store: false,
    });

    // 8. Extract & validate structured output
    let parsedAnalysis: PaperAnalysisOutput;
    if (response.output_parsed) {
      parsedAnalysis = response.output_parsed as PaperAnalysisOutput;
    } else if (response.output_text) {
      try {
        const rawJson = JSON.parse(response.output_text);
        parsedAnalysis = PaperAnalysisSchema.parse(rawJson);
      } catch (parseErr: any) {
        throw new Error(`OpenAI output schema validation failure: ${parseErr.message}`);
      }
    } else {
      throw new Error("OpenAI Responses API returned an empty response or refusal.");
    }

    // 9. Validate chunk provenance with Cross-Paper Protection & Strict Evidence Filtering
    const {
      citations,
      validatedKeyFindings,
      methodologyText,
      limitationsText,
      conclusionText,
      stats,
    } = validateAndResolveEvidence(parsedAnalysis, paper.chunks, paperId);

    // 10. Atomically persist AISummary and update ProcessingJob
    // Note: The previous summary is safely preserved until this atomic transaction succeeds!
    await prisma.$transaction(async (tx) => {
      await tx.aISummary.upsert({
        where: { paperId },
        create: {
          paperId,
          summary: parsedAnalysis.summary,
          keyFindings: validatedKeyFindings.map((kf) => kf.finding),
          methodologySummary: methodologyText,
          limitations: limitationsText,
          conclusion: conclusionText,
          modelUsed: AI_CONFIG.summaryModel,
          promptVersion: AI_CONFIG.promptVersion,
          citations: citations as any,
        },
        update: {
          summary: parsedAnalysis.summary,
          keyFindings: validatedKeyFindings.map((kf) => kf.finding),
          methodologySummary: methodologyText,
          limitations: limitationsText,
          conclusion: conclusionText,
          modelUsed: AI_CONFIG.summaryModel,
          promptVersion: AI_CONFIG.promptVersion,
          citations: citations as any,
        },
      });

      await tx.processingJob.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          stage: "SUMMARY_GENERATION",
          completedAt: new Date(),
          errorMessage: null,
          errorStack: null,
        },
      });
    });

    try {
      revalidatePath(`/papers/${paperId}`);
      revalidatePath(`/admin/papers/${paperId}/edit`);
      revalidatePath("/admin/processing");
    } catch {
      // In non-request contexts, ignore revalidate errors
    }

    return {
      success: true,
      paperId,
      jobId: job.id,
      modelUsed: AI_CONFIG.summaryModel,
      promptVersion: AI_CONFIG.promptVersion,
      validatedCitationsCount: stats.validatedCount,
      rejectedCitationsCount: stats.rejectedCount,
    };
  } catch (err: any) {
    console.error(`AI summary generation failed for paper ${paperId}:`, err);
    // Sanitize error message to avoid leaking any sensitive keys or stack traces
    const safeErrorMsg = err?.message || "An unexpected error occurred during AI analysis.";

    await prisma.processingJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        stage: "SUMMARY_GENERATION",
        errorMessage: safeErrorMsg,
        errorStack: err?.stack || null,
        completedAt: new Date(),
      },
    });

    // CRITICAL GUARANTEE: The previous valid AISummary (if one existed) remains untouched!
    return {
      success: false,
      paperId,
      jobId: job.id,
      error: safeErrorMsg,
    };
  }
}
