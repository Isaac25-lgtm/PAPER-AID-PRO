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
  };
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
 * Deterministically splits extracted manuscript pages into section- and page-aware chunks.
 */
export function chunkManuscriptPages(
  paperId: string,
  pages: ExtractedPage[],
  userOptions?: ChunkingOptions
): ChunkPayload[] {
  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  const chunks: ChunkPayload[] = [];
  let globalChunkIndex = 0;
  let activeSection: string | null = null;

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
    let currentSectionInChunk: string | null = activeSection;

    for (let pIndex = 0; pIndex < currentPageParagraphs.length; pIndex++) {
      const p = currentPageParagraphs[pIndex];
      const pText = p.text;

      // If this paragraph switched section, record section
      if (p.section) {
        currentSectionInChunk = p.section;
      }

      // If adding this paragraph exceeds target size and we already have sufficient text, flush chunk
      if (
        pageBuffer.length > 0 &&
        pageBuffer.length + pText.length > options.targetChunkChars
      ) {
        const trimmedChunk = pageBuffer.trim();
        if (trimmedChunk.length >= options.minChunkChars) {
          const wordCount = trimmedChunk.split(/\s+/).filter(Boolean).length;
          const tokenCount = Math.max(1, Math.round(trimmedChunk.length / 4));

          chunks.push({
            paperId,
            chunkIndex: globalChunkIndex,
            text: trimmedChunk,
            section: currentSectionInChunk,
            pageNumber: page.pageNumber,
            tokenCount,
            metadata: {
              pageNumber: page.pageNumber,
              section: currentSectionInChunk,
              charLength: trimmedChunk.length,
              wordCount,
              chunkIndex: globalChunkIndex,
            },
          });
          globalChunkIndex++;

          // Compute overlap for sliding window
          const overlap = trimmedChunk.slice(-options.overlapChars);
          // Find last space in overlap to avoid cut words
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
              const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
              const tokenCount = Math.max(1, Math.round(trimmed.length / 4));

              chunks.push({
                paperId,
                chunkIndex: globalChunkIndex,
                text: trimmed,
                section: currentSectionInChunk,
                pageNumber: page.pageNumber,
                tokenCount,
                metadata: {
                  pageNumber: page.pageNumber,
                  section: currentSectionInChunk,
                  charLength: trimmed.length,
                  wordCount,
                  chunkIndex: globalChunkIndex,
                },
              });
              globalChunkIndex++;
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
    if (pageBuffer.trim().length >= options.minChunkChars) {
      const trimmed = pageBuffer.trim();
      const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
      const tokenCount = Math.max(1, Math.round(trimmed.length / 4));

      chunks.push({
        paperId,
        chunkIndex: globalChunkIndex,
        text: trimmed,
        section: currentSectionInChunk,
        pageNumber: page.pageNumber,
        tokenCount,
        metadata: {
          pageNumber: page.pageNumber,
          section: currentSectionInChunk,
          charLength: trimmed.length,
          wordCount,
          chunkIndex: globalChunkIndex,
        },
      });
      globalChunkIndex++;
    } else if (pageBuffer.trim().length > 0 && chunks.length > 0) {
      // If trailing snippet is small, append to previous chunk on the same page
      const prev = chunks[chunks.length - 1];
      if (prev.pageNumber === page.pageNumber) {
        prev.text = `${prev.text}\n\n${pageBuffer.trim()}`;
        prev.metadata.charLength = prev.text.length;
        prev.metadata.wordCount = prev.text.split(/\s+/).filter(Boolean).length;
        prev.tokenCount = Math.max(1, Math.round(prev.text.length / 4));
      } else {
        // Different page, keep as chunk
        const trimmed = pageBuffer.trim();
        chunks.push({
          paperId,
          chunkIndex: globalChunkIndex,
          text: trimmed,
          section: currentSectionInChunk,
          pageNumber: page.pageNumber,
          tokenCount: Math.max(1, Math.round(trimmed.length / 4)),
          metadata: {
            pageNumber: page.pageNumber,
            section: currentSectionInChunk,
            charLength: trimmed.length,
            wordCount: trimmed.split(/\s+/).filter(Boolean).length,
            chunkIndex: globalChunkIndex,
          },
        });
        globalChunkIndex++;
      }
    }
  }

  return chunks;
}
