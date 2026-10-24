import { extractText } from "unpdf";
import {
  isDoclingAvailable,
  convertPdfWithDocling,
  DoclingTable,
  DoclingSection,
} from "./docling-service";

export class ScannedPdfError extends Error {
  constructor(
    message: string = "No extractable text found in PDF. Document appears to be image-only or scanned; OCR required."
  ) {
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

export interface StructuredExtractionResult extends ExtractionResult {
  provider: "docling" | "unpdf";
  tables: DoclingTable[];
  sections?: DoclingSection[];
  markdown?: string;
  rawDoclingJson?: any;
}

/**
 * Deterministically extracts text from a PDF buffer while preserving page boundaries using unpdf.
 * Does NOT invoke any LLM or AI agents.
 */
export async function extractPdfText(
  pdfBuffer: Buffer | Uint8Array
): Promise<ExtractionResult> {
  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new Error("Invalid or empty PDF buffer supplied for extraction.");
  }

  // Validate PDF magic number (%PDF-)
  const header = Buffer.from(pdfBuffer.slice(0, 5)).toString("utf-8");
  if (!header.startsWith("%PDF-")) {
    throw new Error(
      "Invalid file format: Document does not contain valid PDF magic signature (%PDF-)."
    );
  }

  const uint8Data = new Uint8Array(pdfBuffer);

  let extractionData: { totalPages: number; text: string[] | string };
  try {
    extractionData = await extractText(uint8Data, { mergePages: false });
  } catch (err: any) {
    throw new Error(
      `PDF parsing failed: ${err.message || "Corrupted or unreadable PDF document structure"}`
    );
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
  if (totalPages === 0 || totalCharacters < 20) {
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

/**
 * Structured PDF Extraction Provider:
 * 1. Checks if the local Docling processing service is available.
 * 2. If available, uses Docling to extract reading-order text, layout hierarchy, and scientific tables.
 * 3. If unavailable or fails, gracefully falls back to deterministic unpdf extraction.
 * 4. Strictly validates PDF magic header and preserves page boundaries.
 */
export async function extractPdfStructured(
  pdfBuffer: Buffer | Uint8Array,
  options: {
    preferDocling?: boolean;
    doOcr?: boolean;
    doTableStructure?: boolean;
    timeoutMs?: number;
  } = {}
): Promise<StructuredExtractionResult> {
  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new Error("Invalid or empty PDF buffer supplied for extraction.");
  }

  // Validate PDF magic header
  const header = Buffer.from(pdfBuffer.slice(0, 5)).toString("utf-8");
  if (!header.startsWith("%PDF-")) {
    throw new Error(
      "Invalid file format: Document does not contain valid PDF magic signature (%PDF-)."
    );
  }

  // Check if Docling is preferred and online
  const useDocling = options.preferDocling !== false;
  if (useDocling) {
    const doclingAvailable = await isDoclingAvailable();
    if (doclingAvailable) {
      try {
        const doclingRes = await convertPdfWithDocling(pdfBuffer, {
          doOcr: options.doOcr ?? false,
          doTableStructure: options.doTableStructure ?? true,
          timeoutMs: options.timeoutMs,
        });

        if (doclingRes.totalCharacters >= 20 || doclingRes.tables.length > 0) {
          return {
            provider: "docling",
            totalPages: doclingRes.totalPages,
            totalCharacters: doclingRes.totalCharacters,
            pages: doclingRes.pages,
            tables: doclingRes.tables,
            sections: doclingRes.sections,
            markdown: doclingRes.markdown,
            rawDoclingJson: doclingRes.rawDoclingJson,
          };
        }
      } catch (err: any) {
        console.warn(
          `[PDF Extraction] Docling conversion failed (${err.message}). Falling back to unpdf engine.`
        );
      }
    }
  }

  // Graceful fallback to deterministic unpdf extraction
  const unpdfRes = await extractPdfText(pdfBuffer);
  return {
    provider: "unpdf",
    totalPages: unpdfRes.totalPages,
    totalCharacters: unpdfRes.totalCharacters,
    pages: unpdfRes.pages,
    tables: [],
    sections: [],
  };
}
