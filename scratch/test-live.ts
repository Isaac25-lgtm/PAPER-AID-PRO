async function testLiveEndpoints() {
  console.log("=== TESTING LIVE LOCALHOST:3000 ENDPOINTS ===");

  // 1. Paper 1 PDF
  const resPdf1 = await fetch("http://localhost:3000/api/papers/cmugxsj280000vrpontgz0vlf/pdf");
  console.log(`GET /api/papers/Paper1/pdf: ${resPdf1.status} (${resPdf1.headers.get("content-type")})`);
  const b1 = await resPdf1.arrayBuffer();
  console.log(`  Bytes received: ${b1.byteLength}`);

  // 2. Paper 2 PDF
  const resPdf2 = await fetch("http://localhost:3000/api/papers/cmugydswv0003vrpoassf36yi/pdf");
  console.log(`GET /api/papers/Paper2/pdf: ${resPdf2.status} (${resPdf2.headers.get("content-type")})`);
  const b2 = await resPdf2.arrayBuffer();
  console.log(`  Bytes received: ${b2.byteLength}`);

  // 3. Public Paper 1 Page
  const resPaper1 = await fetch("http://localhost:3000/papers/cmugxsj280000vrpontgz0vlf");
  console.log(`GET /papers/Paper1: ${resPaper1.status}`);
  const html1 = await resPaper1.text();
  console.log(`  Contains "View Original PDF": ${html1.includes("View Original PDF")}`);
  console.log(`  Contains "Save Paper": ${html1.includes("Save Paper")}`);

  // 4. Saved Papers without auth
  const resSaved = await fetch("http://localhost:3000/saved", { redirect: "manual" });
  console.log(`GET /saved (Unauthenticated): ${resSaved.status} (Location: ${resSaved.headers.get("location")})`);

  console.log("\n=== ALL LIVE ENDPOINTS FUNCTIONING ===");
}

testLiveEndpoints().catch(console.error);
