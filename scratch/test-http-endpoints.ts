async function testHttp() {
  console.log("=== 1. TESTING LIGHTWEIGHT ENDPOINT (http://localhost:3000/api/auth/providers) ===");
  const t0 = Date.now();
  try {
    const resLight = await fetch("http://localhost:3000/api/auth/providers", {
      signal: AbortSignal.timeout(8000),
    });
    console.log(`Lightweight Status: ${resLight.status} (took ${Date.now() - t0}ms)`);
    const data = await resLight.json();
    console.log("Providers received:", Object.keys(data));
  } catch (err: any) {
    console.error("Lightweight request failed:", err.message);
    process.exit(1);
  }

  console.log("\n=== 2. TESTING PDF ENDPOINT VIA HTTP HEAD (explicit 15s timeout) ===");
  const t1 = Date.now();
  try {
    const resHead = await fetch("http://localhost:3000/api/papers/cmumgtiix0000vr445cn8ry7o/pdf", {
      method: "HEAD",
      signal: AbortSignal.timeout(15000),
    });
    console.log(`PDF HEAD Status: ${resHead.status} (took ${Date.now() - t1}ms)`);
    console.log(`Content-Type: ${resHead.headers.get("content-type")}`);
    console.log(`Content-Disposition: ${resHead.headers.get("content-disposition")}`);
    console.log(`Cache-Control: ${resHead.headers.get("cache-control")}`);
  } catch (err: any) {
    console.error("PDF HEAD request failed:", err.message);
    process.exit(1);
  }

  console.log("\n=== 3. TESTING PDF ENDPOINT VIA HTTP GET (explicit 20s timeout) ===");
  const t2 = Date.now();
  try {
    const resGet = await fetch("http://localhost:3000/api/papers/cmumgtiix0000vr445cn8ry7o/pdf", {
      method: "GET",
      signal: AbortSignal.timeout(20000),
    });
    console.log(`PDF GET Status: ${resGet.status} (took ${Date.now() - t2}ms)`);
    const buf = await resGet.arrayBuffer();
    console.log(`PDF bytes received: ${buf.byteLength} bytes (took ${Date.now() - t2}ms)`);
    const magic = Buffer.from(buf.slice(0, 5)).toString("utf-8");
    console.log(`PDF Header: "${magic}"`);
    if (resGet.status === 200 && magic === "%PDF-") {
      console.log("✅ PDF HTTP VERIFICATION FULLY PASSED!");
    } else {
      console.error("❌ PDF HTTP verification failed: invalid status or body.");
      process.exit(1);
    }
  } catch (err: any) {
    console.error("PDF GET request failed:", err.message);
    process.exit(1);
  }
}

testHttp().catch(console.error);
