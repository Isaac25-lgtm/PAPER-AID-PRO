import "server-only";

export interface DoclingTableCell {
  text: string;
  rowSpan?: number;
  colSpan?: number;
}

export interface DoclingTable {
  tableIndex: number;
  caption?: string;
  pageNumber: number;
  headers: string[];
  rows: string[][];
  numRows: number;
  numCols: number;
  markdown: string;
  structuredText: string;
}

export interface DoclingSection {
  title: string;
  level: number;
  pageNumber: number;
}

export interface DoclingPage {
  pageNumber: number;
  text: string;
}

export interface DoclingExtractionResult {
  provider: "docling" | "unpdf";
  totalPages: number;
  totalCharacters: number;
  markdown: string;
  pages: DoclingPage[];
  tables: DoclingTable[];
  sections: DoclingSection[];
  rawDoclingJson?: any;
}

export interface DoclingConvertOptions {
  doOcr?: boolean;
  doTableStructure?: boolean;
  timeoutMs?: number;
}

/**
 * Returns the configured base URL for the Docling document-processing service.
 * Defaults to the local Docker Compose instance on port 5001.
 */
export function getDoclingServiceUrl(): string {
  return (
    process.env.DOCLING_SERVICE_URL ||
    process.env.DOCLING_URL ||
    "http://127.0.0.1:5001"
  ).replace(/\/+$/, "");
}

/**
 * Checks whether the local Docling processing service is online and healthy.
 * Times out quickly (2 seconds) to avoid blocking request lifecycles.
 */
export async function isDoclingAvailable(): Promise<boolean> {
  const baseUrl = getDoclingServiceUrl();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    // Try /health or fallback probe to root
    const res = await fetch(`${baseUrl}/health`, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    }).catch(async () => {
      return await fetch(`${baseUrl}/`, {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      });
    });

    clearTimeout(timeoutId);
    return res.ok || res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Converts a raw table grid / cell structure from Docling into a clean markdown table
 * and an evidence-grounded key-value structured text representation.
 */
export function formatTableRepresentations(
  headers: string[],
  rows: string[][],
  caption?: string
): { markdown: string; structuredText: string } {
  // 1. Build Markdown Table
  const cleanHeaders = headers.map((h) => h.replace(/\|/g, "\\|").trim() || "-");
  const colCount = Math.max(cleanHeaders.length, ...rows.map((r) => r.length), 1);
  while (cleanHeaders.length < colCount) {
    cleanHeaders.push(`Column ${cleanHeaders.length + 1}`);
  }

  const headerLine = `| ${cleanHeaders.join(" | ")} |`;
  const separatorLine = `| ${cleanHeaders.map(() => "---").join(" | ")} |`;
  const rowLines = rows.map((r) => {
    const cleanCells = r.map((c) => (c || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim());
    while (cleanCells.length < colCount) {
      cleanCells.push("");
    }
    return `| ${cleanCells.join(" | ")} |`;
  });

  const mdParts: string[] = [];
  if (caption) {
    mdParts.push(`**${caption.trim()}**\n`);
  }
  mdParts.push(headerLine, separatorLine, ...rowLines);
  const markdown = mdParts.join("\n");

  // 2. Build Structured Text (Associates each numeric/text cell with its column header)
  // Highly effective for lexical & hybrid retrieval in scientific RAG
  const structParts: string[] = [];
  if (caption) {
    structParts.push(`[${caption.trim()}]`);
  }

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const row = rows[rIdx];
    const rowTitle = row[0] ? row[0].trim() : `Row ${rIdx + 1}`;
    const pairs: string[] = [];

    for (let cIdx = 0; cIdx < colCount; cIdx++) {
      const colHeader = cleanHeaders[cIdx] || `Col ${cIdx + 1}`;
      const cellVal = (row[cIdx] || "").trim();
      if (cellVal) {
        pairs.push(`${colHeader}: ${cellVal}`);
      }
    }

    if (pairs.length > 0) {
      structParts.push(`Item: ${rowTitle} -> ${pairs.join(" | ")}`);
    }
  }

  const structuredText = structParts.join("\n");

  return { markdown, structuredText };
}

/**
 * Parses raw JSON output from Docling into structured tables, sections, and pages.
 */
export function parseDoclingDocumentJson(
  doclingJson: any,
  fallbackMarkdown: string = ""
): {
  pages: DoclingPage[];
  tables: DoclingTable[];
  sections: DoclingSection[];
} {
  const pages: DoclingPage[] = [];
  const tables: DoclingTable[] = [];
  const sections: DoclingSection[] = [];

  if (!doclingJson || typeof doclingJson !== "object") {
    // If no structured JSON, parse from fallback markdown
    return parseFallbackMarkdown(fallbackMarkdown);
  }

  // 1. Extract Tables from docling document
  const rawTables = Array.isArray(doclingJson.tables)
    ? doclingJson.tables
    : Array.isArray(doclingJson.document?.tables)
    ? doclingJson.document.tables
    : [];

  let tableCounter = 1;
  for (const t of rawTables) {
    const pageNo = t.prov?.[0]?.page_no || t.page_number || 1;
    const caption = t.caption?.text || t.caption || t.label || `Table ${tableCounter}`;
    
    // Extract grid cells
    const grid: string[][] = [];
    if (Array.isArray(t.data?.grid)) {
      for (const row of t.data.grid) {
        if (Array.isArray(row)) {
          grid.push(row.map((cell: any) => (cell?.text ?? cell ?? "").toString().trim()));
        }
      }
    } else if (Array.isArray(t.data?.table_cells)) {
      // Map coordinate cells to 2D grid
      const maxRow = Math.max(0, ...t.data.table_cells.map((c: any) => c.row_index || 0));
      const maxCol = Math.max(0, ...t.data.table_cells.map((c: any) => c.col_index || 0));
      const matrix: string[][] = Array.from({ length: maxRow + 1 }, () =>
        Array.from({ length: maxCol + 1 }, () => "")
      );
      for (const cell of t.data.table_cells) {
        const r = cell.row_index || 0;
        const c = cell.col_index || 0;
        matrix[r][c] = (cell.text || "").trim();
      }
      grid.push(...matrix);
    }

    if (grid.length > 0) {
      const headers = grid[0] || [];
      const dataRows = grid.slice(1);
      const { markdown, structuredText } = formatTableRepresentations(headers, dataRows, caption);

      tables.push({
        tableIndex: tableCounter++,
        caption,
        pageNumber: pageNo,
        headers,
        rows: dataRows,
        numRows: dataRows.length,
        numCols: headers.length,
        markdown,
        structuredText,
      });
    }
  }

  // 2. Extract Pages
  if (doclingJson.pages && typeof doclingJson.pages === "object") {
    const pageKeys = Object.keys(doclingJson.pages).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    for (const key of pageKeys) {
      const pageObj = doclingJson.pages[key];
      const pageNum = parseInt(key, 10) || 1;
      const text = pageObj.text || pageObj.content || "";
      if (text) {
        pages.push({ pageNumber: pageNum, text: text.trim() });
      }
    }
  }

  // If pages were not populated directly, reconstruct from doclingJson.texts or body items
  if (pages.length === 0) {
    const pageTextMap = new Map<number, string[]>();
    const textItems = Array.isArray(doclingJson.texts)
      ? doclingJson.texts
      : Array.isArray(doclingJson.body?.children)
      ? doclingJson.body.children
      : [];

    for (const item of textItems) {
      const pageNo = item.prov?.[0]?.page_no || item.page_no || 1;
      const text = item.text?.trim() || "";
      if (text) {
        if (!pageTextMap.has(pageNo)) {
          pageTextMap.set(pageNo, []);
        }
        pageTextMap.get(pageNo)!.push(text);
      }
    }

    if (pageTextMap.size > 0) {
      const sortedPageNos = Array.from(pageTextMap.keys()).sort((a, b) => a - b);
      for (const pNo of sortedPageNos) {
        pages.push({
          pageNumber: pNo,
          text: pageTextMap.get(pNo)!.join("\n\n"),
        });
      }
    }
  }

  // 3. Extract Section Headings
  const bodyItems = doclingJson.body?.children || doclingJson.children || [];
  for (const item of bodyItems) {
    if (item.label === "section_header" || item.type === "heading" || item.label === "title") {
      const title = item.text?.trim() || "";
      const level = item.level || 1;
      const pageNumber = item.prov?.[0]?.page_no || 1;
      if (title) {
        sections.push({ title, level, pageNumber });
      }
    }
  }

  // If pages were not populated directly in JSON, construct them from markdown or body
  if (pages.length === 0 && fallbackMarkdown) {
    const fallbackParsed = parseFallbackMarkdown(fallbackMarkdown);
    return {
      pages: fallbackParsed.pages,
      tables: tables.length > 0 ? tables : fallbackParsed.tables,
      sections: sections.length > 0 ? sections : fallbackParsed.sections,
    };
  }

  return { pages, tables, sections };
}

/**
 * Fallback parser when Docling returns Markdown output or when reconstructing pages.
 */
function parseFallbackMarkdown(markdown: string): {
  pages: DoclingPage[];
  tables: DoclingTable[];
  sections: DoclingSection[];
} {
  const pages: DoclingPage[] = [];
  const tables: DoclingTable[] = [];
  const sections: DoclingSection[] = [];

  // Check for page break markers (e.g. <!-- page_break --> or \f)
  const rawPages = markdown.split(/(?:<!--\s*page_break\s*-->|\f)/gi);
  if (rawPages.length > 1) {
    rawPages.forEach((pText, idx) => {
      pages.push({ pageNumber: idx + 1, text: pText.trim() });
    });
  } else {
    pages.push({ pageNumber: 1, text: markdown.trim() });
  }

  // Extract Markdown headings
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(markdown)) !== null) {
    sections.push({
      title: match[2].trim(),
      level: match[1].length,
      pageNumber: 1,
    });
  }

  // Extract Markdown tables
  const tableRegex = /((?:\|[^\n]+\|\r?\n)+)/g;
  let tMatch: RegExpExecArray | null;
  let tIdx = 1;
  while ((tMatch = tableRegex.exec(markdown)) !== null) {
    const rawTable = tMatch[1].trim();
    const lines = rawTable.split(/\r?\n/).filter(Boolean);
    if (lines.length >= 2) {
      const parseCells = (line: string) =>
        line
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());

      const headers = parseCells(lines[0]);
      const dataRows = lines
        .slice(2)
        .map(parseCells)
        .filter((r) => r.some((c) => c.length > 0));

      if (dataRows.length > 0) {
        const { markdown: md, structuredText: st } = formatTableRepresentations(
          headers,
          dataRows,
          `Table ${tIdx}`
        );
        tables.push({
          tableIndex: tIdx++,
          caption: `Table ${tIdx - 1}`,
          pageNumber: 1,
          headers,
          rows: dataRows,
          numRows: dataRows.length,
          numCols: headers.length,
          markdown: md,
          structuredText: st,
        });
      }
    }
  }

  return { pages, tables, sections };
}

/**
 * Converts a PDF buffer using the local Docling Serve container.
 * Sends the document as a base64 source to `/v1/convert/source` or multipart `/v1/convert/file`.
 * Extracts markdown, pages, headings, and structured scientific tables.
 */
export async function convertPdfWithDocling(
  pdfBuffer: Buffer | Uint8Array,
  options: DoclingConvertOptions = {}
): Promise<DoclingExtractionResult> {
  const baseUrl = getDoclingServiceUrl();
  const timeoutMs = options.timeoutMs || 120_000; // 2 minutes default timeout for document conversion
  const uint8Buffer = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);

  const base64Data = uint8Buffer.toString("base64");

  const convertPayload = {
    options: {
      to_formats: ["md", "json"],
      do_table_structure: options.doTableStructure ?? true,
      do_ocr: options.doOcr ?? false,
      table_mode: "accurate",
      abort_on_error: false,
    },
    sources: [
      {
        kind: "file",
        base64_string: base64Data,
        filename: "manuscript.pdf",
      },
    ],
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let responseData: any;
  try {
    let res = await fetch(`${baseUrl}/v1/convert/source`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(convertPayload),
      signal: controller.signal,
    });

    if (res.status === 404) {
      // Fallback to /v1alpha/convert/source
      res = await fetch(`${baseUrl}/v1alpha/convert/source`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(convertPayload),
        signal: controller.signal,
      });
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Docling Serve returned HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }

    responseData = await res.json();
  } finally {
    clearTimeout(timeoutId);
  }

  // Parse result from Docling response
  // Docling Serve response shape: { document: { markdown: string, json: any }, status: string }
  // or { results: [ { document: { markdown: ..., json: ... } } ] }
  const docResult =
    responseData?.document ||
    responseData?.results?.[0]?.document ||
    responseData?.items?.[0] ||
    responseData;

  const markdown: string =
    docResult?.markdown ||
    docResult?.md_content ||
    docResult?.text_content ||
    docResult?.text ||
    "";
  const rawJson =
    docResult?.json ||
    docResult?.json_content ||
    docResult;

  const { pages, tables, sections } = parseDoclingDocumentJson(rawJson, markdown);

  let totalChars = 0;
  for (const p of pages) {
    totalChars += p.text.length;
  }
  if (totalChars === 0) {
    totalChars = markdown.length;
  }

  return {
    provider: "docling",
    totalPages: pages.length || 1,
    totalCharacters: totalChars,
    markdown,
    pages,
    tables,
    sections,
    rawDoclingJson: rawJson,
  };
}
