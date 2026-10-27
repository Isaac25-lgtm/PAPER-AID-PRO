import { ExtractedPage } from "./extractor";
import { detectSectionHeading } from "./section-detector";

export interface ChunkPayload {
  paperId: string;
  chunkIndex: number;
  text: string;
  section: string | null;
  pageNumber: number;
  tokenCount: number;
  metadata: {
    pageNumber: number;
    section: string | null;
    charLength: number;
    wordCount: number;
    chunkIndex: number;
    isTable?: boolean;
    tableIndex?: number;
    caption?: string | null;
    extractionProvider?: string;
  };
}

export interface StructuredTableChunkInput {
  tableIndex: number;
  pageNumber: number;
  caption?: string;
  markdown: string;
  structuredText?: string;
  numRows?: number;
  numCols?: number;
  headers?: string[];
  rows?: string[][];
}

export interface ChunkingOptions {
  targetChunkChars?: number;
  overlapChars?: number;
  minChunkChars?: number;
  maxChunkChars?: number;
}

const DEFAULT_OPTIONS: Required<ChunkingOptions> = {
  targetChunkChars: 1000,
  overlapChars: 150,
  minChunkChars: 100,
  maxChunkChars: 1800,
};

/**
 * Deterministically splits extracted manuscript pages into section- and page-aware chunks,
 * with first-class support for structured scientific tables.
 */
export function chunkManuscriptPages(
  paperId: string,
  pages: ExtractedPage[],
  userOptions?: ChunkingOptions,
  tables?: StructuredTableChunkInput[]
): ChunkPayload[] {
  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  const chunks: ChunkPayload[] = [];
  let globalChunkIndex = 0;
  let activeSection: string | null = null;
  const minMeaningfulChars = 20;

  function pushChunk(text: string, section: string | null, pageNumber: number): boolean {
    const trimmed = text.trim();
    if (trimmed.length < minMeaningfulChars) {
      return false;
    }
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    const tokenCount = Math.max(1, Math.round(trimmed.length / 4));

    chunks.push({
      paperId,
      chunkIndex: globalChunkIndex,
      text: trimmed,
      section,
      pageNumber,
      tokenCount,
      metadata: {
        pageNumber,
        section,
        charLength: trimmed.length,
        wordCount,
        chunkIndex: globalChunkIndex,
      },
    });
    globalChunkIndex++;
    return true;
  }

  for (const page of pages) {
    const lines = page.text.split(/\r?\n/);
    let currentPageParagraphs: Array<{ text: string; section: string | null }> = [];
    let currentParagraphLines: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        if (currentParagraphLines.length > 0) {
          currentPageParagraphs.push({
            text: currentParagraphLines.join(" "),
            section: activeSection,
          });
          currentParagraphLines = [];
        }
        continue;
      }

      // Check for section heading
      const headingMatch = detectSectionHeading(line);
      if (headingMatch) {
        // Flush existing paragraph under previous section
        if (currentParagraphLines.length > 0) {
          currentPageParagraphs.push({
            text: currentParagraphLines.join(" "),
            section: activeSection,
          });
          currentParagraphLines = [];
        }
        activeSection = headingMatch.canonicalName;
        continue;
      }

      currentParagraphLines.push(line);
    }

    if (currentParagraphLines.length > 0) {
      currentPageParagraphs.push({
        text: currentParagraphLines.join(" "),
        section: activeSection,
      });
    }

    // Now chunk the paragraphs on this page
    let pageBuffer = "";
    let currentSectionInChunk: string | null = null;

    for (let pIndex = 0; pIndex < currentPageParagraphs.length; pIndex++) {
      const p = currentPageParagraphs[pIndex];
      const pText = p.text.trim();
      if (!pText) continue;

      const pSection = p.section;

      // If pageBuffer has content and the incoming paragraph belongs to a different section:
      // Flush buffered text belonging to the previous section before changing section!
      if (pageBuffer.trim().length > 0 && currentSectionInChunk !== pSection) {
        pushChunk(pageBuffer, currentSectionInChunk, page.pageNumber);
        pageBuffer = "";
        currentSectionInChunk = null;
      }

      if (!currentSectionInChunk) {
        currentSectionInChunk = pSection;
      }

      // If adding this paragraph exceeds target size and we already have sufficient text, flush chunk
      if (
        pageBuffer.length > 0 &&
        pageBuffer.length + pText.length > options.targetChunkChars
      ) {
        const trimmedChunk = pageBuffer.trim();
        if (trimmedChunk.length >= options.minChunkChars) {
          pushChunk(trimmedChunk, currentSectionInChunk, page.pageNumber);

          // Compute overlap for sliding window within the SAME section
          const overlap = trimmedChunk.slice(-options.overlapChars);
          const lastSpaceIdx = overlap.lastIndexOf(" ");
          const cleanOverlap = lastSpaceIdx !== -1 ? overlap.slice(lastSpaceIdx + 1) : overlap;
          pageBuffer = cleanOverlap ? cleanOverlap + " " : "";
        }
      }

      // If a single paragraph is larger than maxChunkChars, break it down by sentences
      if (pText.length > options.maxChunkChars) {
        const sentences = pText.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [pText];
        for (const sentence of sentences) {
          if (pageBuffer.length + sentence.length > options.targetChunkChars) {
            const trimmed = pageBuffer.trim();
            if (trimmed.length >= options.minChunkChars) {
              pushChunk(trimmed, currentSectionInChunk, page.pageNumber);
              pageBuffer = "";
            }
          }
          pageBuffer += (pageBuffer ? " " : "") + sentence.trim();
        }
      } else {
        pageBuffer += (pageBuffer ? "\n\n" : "") + pText;
      }
    }

    // Flush any leftover buffer for this page
    if (pageBuffer.trim().length > 0) {
      const trimmed = pageBuffer.trim();
      if (trimmed.length >= options.minChunkChars) {
        pushChunk(trimmed, currentSectionInChunk, page.pageNumber);
      } else if (
        chunks.length > 0 &&
        chunks[chunks.length - 1].pageNumber === page.pageNumber &&
        chunks[chunks.length - 1].section === currentSectionInChunk
      ) {
        // Only append to previous chunk if they are on the SAME page AND have the SAME section
        const prev = chunks[chunks.length - 1];
        prev.text = `${prev.text}\n\n${trimmed}`;
        prev.metadata.charLength = prev.text.length;
        prev.metadata.wordCount = prev.text.split(/\s+/).filter(Boolean).length;
        prev.tokenCount = Math.max(1, Math.round(prev.text.length / 4));
      } else if (trimmed.length >= minMeaningfulChars) {
        // Standalone short section on this page (e.g., short Results, Limitations, Conclusion):
        // Flush safely as its own chunk rather than dropping or corrupting provenance
        pushChunk(trimmed, currentSectionInChunk, page.pageNumber);
      }
      pageBuffer = "";
      currentSectionInChunk = null;
    }

    // Flush structured tables for this page if provided
    if (tables && tables.length > 0) {
      const pageTables = tables.filter((t) => t.pageNumber === page.pageNumber);
      for (const table of pageTables) {
        const parts: string[] = [];
        const tableNum = table.tableIndex;
        const rawCaption = (table.caption || "").trim();
        const isGenericCaption = !rawCaption || rawCaption.toLowerCase() === "table";
        if (isGenericCaption) {
          parts.push(`Table ${tableNum}`);
        } else if (rawCaption.toLowerCase().startsWith(`table ${tableNum}`)) {
          parts.push(rawCaption);
        } else {
          parts.push(`Table ${tableNum}: ${rawCaption}`);
        }
        if (table.markdown) {
          parts.push(table.markdown);
        }
        if (table.structuredText) {
          parts.push(`\nStructured Cell Data:\n${table.structuredText}`);
        }
        const tableText = parts.join("\n\n").trim();
        if (tableText.length >= minMeaningfulChars) {
          const wordCount = tableText.split(/\s+/).filter(Boolean).length;
          const tokenCount = Math.max(1, Math.round(tableText.length / 4));
          const tableSection = activeSection || "Results";

          chunks.push({
            paperId,
            chunkIndex: globalChunkIndex,
            text: tableText,
            section: tableSection,
            pageNumber: page.pageNumber,
            tokenCount,
            metadata: {
              pageNumber: page.pageNumber,
              section: tableSection,
              charLength: tableText.length,
              wordCount,
              chunkIndex: globalChunkIndex,
              isTable: true,
              tableIndex: table.tableIndex,
              caption: table.caption || null,
              extractionProvider: "docling",
            },
          });
          globalChunkIndex++;
        }
      }
    }
  }

  // Flush any tables not matched to a page (or pageNumber outside range)
  if (tables && tables.length > 0) {
    const processedPageNumbers = new Set(pages.map((p) => p.pageNumber));
    const unassignedTables = tables.filter(
      (t) => !processedPageNumbers.has(t.pageNumber)
    );
    for (const table of unassignedTables) {
      const fallbackPageNum =
        table.pageNumber || (pages.length > 0 ? pages[pages.length - 1].pageNumber : 1);
      const parts: string[] = [];
      if (table.caption) {
        parts.push(`Table ${table.tableIndex + 1}: ${table.caption}`);
      } else {
        parts.push(`Table ${table.tableIndex + 1}`);
      }
      if (table.markdown) {
        parts.push(table.markdown);
      }
      if (table.structuredText) {
        parts.push(`\nStructured Cell Data:\n${table.structuredText}`);
      }
      const tableText = parts.join("\n\n").trim();
      if (tableText.length >= minMeaningfulChars) {
        const wordCount = tableText.split(/\s+/).filter(Boolean).length;
        const tokenCount = Math.max(1, Math.round(tableText.length / 4));
        const tableSection = activeSection || "Results";

        chunks.push({
          paperId,
          chunkIndex: globalChunkIndex,
          text: tableText,
          section: tableSection,
          pageNumber: fallbackPageNum,
          tokenCount,
          metadata: {
            pageNumber: fallbackPageNum,
            section: tableSection,
            charLength: tableText.length,
            wordCount,
            chunkIndex: globalChunkIndex,
            isTable: true,
            tableIndex: table.tableIndex,
            caption: table.caption || null,
            extractionProvider: "docling",
          },
        });
        globalChunkIndex++;
      }
    }
  }

  return chunks;
}

