import "dotenv/config";
import { GET } from "../src/app/api/papers/[id]/pdf/route";
import { NextRequest } from "next/server";

async function testPdfRoute() {
  console.log("=== TESTING PDF API ROUTE FOR BOTH PAPERS ===");
  const paper1Id = "cmugxsj280000vrpontgz0vlf"; // ENDOMETRIOSIS
  const req1 = new NextRequest(`http://localhost:3000/api/papers/${paper1Id}/pdf`);
  const res1 = await GET(req1, { params: { id: paper1Id } });
  console.log(`Paper 1 PDF Route Status: ${res1.status}`);
  console.log(`  Content-Type: ${res1.headers.get("content-type")}`);
  console.log(`  Content-Disposition: ${res1.headers.get("content-disposition")}`);
  const buf1 = await res1.arrayBuffer();
  console.log(`  Streamed Buffer size: ${buf1.byteLength} bytes`);

  const paper2Id = "cmugydswv0003vrpoassf36yi"; // THE EFFICACY OF...
  const req2 = new NextRequest(`http://localhost:3000/api/papers/${paper2Id}/pdf`);
  const res2 = await GET(req2, { params: { id: paper2Id } });
  console.log(`\nPaper 2 PDF Route Status: ${res2.status}`);
  console.log(`  Content-Type: ${res2.headers.get("content-type")}`);
  console.log(`  Content-Disposition: ${res2.headers.get("content-disposition")}`);
  const buf2 = await res2.arrayBuffer();
  console.log(`  Streamed Buffer size: ${buf2.byteLength} bytes`);

  // Test external fallback paper (e.g. Attention Is All You Need)
  const paper3Id = "cmugpa81i000cvrlgzxz7lir2";
  const req3 = new NextRequest(`http://localhost:3000/api/papers/${paper3Id}/pdf`);
  const res3 = await GET(req3, { params: { id: paper3Id } });
  console.log(`\nPaper 3 (External arXiv fallback) Status: ${res3.status}`);
  console.log(`  Location header (Redirect): ${res3.headers.get("location")}`);
}

testPdfRoute().catch(console.error);
