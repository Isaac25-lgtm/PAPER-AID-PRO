import "./load-env";
import { GET, HEAD } from "../src/app/api/papers/[id]/pdf/route";
import { NextRequest } from "next/server";

async function testHeadAndGet() {
  const paperId = "cmumgtiix0000vr445cn8ry7o";
  console.log("Testing HEAD request directly...");
  const headReq = new NextRequest(`http://localhost:3000/api/papers/${paperId}/pdf`, { method: "HEAD" });
  const headRes = await HEAD(headReq, { params: { id: paperId } });
  console.log("HEAD Status:", headRes.status);
  console.log("HEAD Content-Type:", headRes.headers.get("content-type"));
  console.log("HEAD Content-Disposition:", headRes.headers.get("content-disposition"));
  const headText = await headRes.text();
  console.log("HEAD Body length (should be 0):", headText.length);

  console.log("\nTesting GET request directly...");
  const getReq = new NextRequest(`http://localhost:3000/api/papers/${paperId}/pdf`, { method: "GET" });
  const getRes = await GET(getReq, { params: { id: paperId } });
  console.log("GET Status:", getRes.status);
  const getBuf = await getRes.arrayBuffer();
  console.log("GET Body size:", getBuf.byteLength, "bytes");
}

testHeadAndGet().catch(console.error);
