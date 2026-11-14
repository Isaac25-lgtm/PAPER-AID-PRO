// pdf.js wrapper, loaded only when the PDF panel opens (its own chunk). The worker is a same-origin asset, so the
// Content-Security-Policy needs no new sources; XFA and WebAssembly are not used.
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDocument = PDFDocumentProxy;

export function openPdf(data: ArrayBuffer): { promise: Promise<PdfDocument>; destroy: () => void } {
  const task = getDocument({ data, enableXfa: false, useWasm: false });
  return { promise: task.promise, destroy: () => void task.destroy() };
}

/** Render one page into `canvas` with a selectable text layer in `textLayer`, fitted to `width` CSS pixels. */
export async function renderPage(
  pdf: PdfDocument,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  textLayer: HTMLDivElement,
  width: number,
  signal: AbortSignal,
): Promise<void> {
  const page = await pdf.getPage(pageNumber);
  if (signal.aborted) return;
  const scale = width / page.getViewport({ scale: 1 }).width;
  const viewport = page.getViewport({ scale });
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const render = page.render({ canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
  textLayer.replaceChildren();
  textLayer.style.setProperty("--total-scale-factor", String(scale));
  textLayer.style.setProperty("--scale-factor", String(scale));
  textLayer.style.setProperty("--scale-round-x", "1px");
  textLayer.style.setProperty("--scale-round-y", "1px");
  const text = new TextLayer({ textContentSource: page.streamTextContent(), container: textLayer, viewport });
  const stop = () => {
    render.cancel();
    text.cancel();
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    await Promise.all([render.promise, text.render()]);
  } catch (error) {
    if (!signal.aborted) throw error;
  } finally {
    signal.removeEventListener("abort", stop);
  }
}
