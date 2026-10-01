import { extractText } from "unpdf";

export class ScannedPdfError extends Error {
  constructor(message: string = "No extractable text found in PDF. Document appears to be image-only or scanned; OCR required.") {
    super(message);
    this.name = "ScannedPdfError";
  }
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface ExtractionResult {
  totalPages: number;
  pages: ExtractedPage[];
  totalCharacters: number;
}

/**
 * Deterministically extracts text from a PDF buffer while preserving page boundaries.
 * Does NOT invoke any LLM or AI agents.
 */
export async function extractPdfText(pdfBuffer: Buffer | Uint8Array): Promise<ExtractionResult> {
  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new Error("Invalid or empty PDF buffer supplied for extraction.");
  }

  // Validate PDF magic number (%PDF-)
  const header = Buffer.from(pdfBuffer.slice(0, 5)).toString("utf-8");
  if (!header.startsWith("%PDF-")) {
    throw new Error("Invalid file format: Document does not contain valid PDF magic signature (%PDF-).");
  }

  const uint8Data = new Uint8Array(pdfBuffer);

  let extractionData: { totalPages: number; text: string[] | string };
  try {
    extractionData = await extractText(uint8Data, { mergePages: false });
  } catch (err: any) {
    throw new Error(`PDF parsing failed: ${err.message || "Corrupted or unreadable PDF document structure"}`);
  }

  const totalPages = extractionData.totalPages || 0;
  const rawPages: string[] = Array.isArray(extractionData.text)
    ? extractionData.text
    : [extractionData.text || ""];

  // Normalize pages and count characters
  let totalCharacters = 0;
  const pages: ExtractedPage[] = [];

  for (let i = 0; i < rawPages.length; i++) {
    const pageText = (rawPages[i] || "").trim();
    totalCharacters += pageText.length;
    pages.push({
      pageNumber: i + 1,
      text: pageText,
    });
  }

  // Check for scanned / image-only PDFs
  // If document has pages but total text across the entire PDF is negligible (< 20 characters),
  // it is an image-only / scanned document requiring OCR.
  if (totalPages > 0 && totalCharacters < 20) {
    throw new ScannedPdfError(
      `No extractable text found in PDF (${totalPages} pages detected). This manuscript appears to be image-only or scanned; OCR is required for processing.`
    );
  }

  return {
    totalPages,
    pages,
    totalCharacters,
  };
}
