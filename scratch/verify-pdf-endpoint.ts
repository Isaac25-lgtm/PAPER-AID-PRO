import "./load-env";
import { GET } from "../src/app/api/papers/[id]/pdf/route";
import { NextRequest } from "next/server";

async function verifyPdfEndpoint() {
  console.log("==========================================================");
  console.log("VERIFYING PDF ENDPOINT: DIRECT ROUTE HANDLER INVOCATION");
  console.log("==========================================================");

  const paperId = "cmumgtiix0000vr445cn8ry7o";
  const start = Date.now();

  const req = new NextRequest(`http://localhost:3000/api/papers/${paperId}/pdf`);
  const response = await GET(req, { params: { id: paperId } });

  const durationMs = Date.now() - start;

  console.log(`Response Status: ${response.status} ${response.statusText || ""}`);
  console.log(`Duration: ${durationMs}ms`);
  console.log(`Content-Type: ${response.headers.get("content-type")}`);
  console.log(`Content-Disposition: ${response.headers.get("content-disposition")}`);
  console.log(`Cache-Control: ${response.headers.get("cache-control")}`);

  const buffer = await response.arrayBuffer();
  console.log(`Received PDF buffer size: ${buffer.byteLength} bytes (${(buffer.byteLength / (1024 * 1024)).toFixed(2)} MB)`);

  // Verify PDF magic bytes (%PDF-)
  const magicBytes = Buffer.from(buffer.slice(0, 5)).toString("utf-8");
  console.log(`Magic bytes header: "${magicBytes}"`);

  if (response.status === 200 && magicBytes === "%PDF-") {
    console.log("✅ PDF ENDPOINT VERIFICATION SUCCESSFUL: Valid PDF binary stream received.");
  } else {
    console.error("❌ PDF ENDPOINT VERIFICATION FAILED: Unexpected response or invalid PDF header.");
    process.exit(1);
  }
}

verifyPdfEndpoint().catch((e) => {
  console.error("Error during PDF route verification:", e);
  process.exit(1);
});
