/**
 * AI RESEARCH HUB — AUTOMATED TEST RUNNER
 *
 * Discovers and executes all verification suites under tests/
 * Preloads tests/test-setup.ts for server-only mocking, isolated database, and mock storage.
 */

import "./test-setup";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { seedDevFixtures } from "./seed-test-fixtures";

interface TestFileResult {
  file: string;
  passed: boolean;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export const INTEGRATION_TEST_SUITES = new Set([
  "citation-generator-workflow.test.ts",
  "citation-validator.test.ts",
  "cited-evidence.test.ts",
  "deep-research-integrity-audit.test.ts",
  "phase10-agent.test.ts",
  "phase11.1-launch-gate.test.ts",
  "open-access-doi-importer.test.ts",
]);

async function runSingleTest(filePath: string): Promise<TestFileResult> {
  const start = Date.now();
  const relPath = path.relative(process.cwd(), filePath);

  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";
    const npxCmd = isWindows ? "npx.cmd" : "npx";

    const quotedFilePath = isWindows ? `"${filePath}"` : filePath;
    const child = spawn(
      npxCmd,
      ["tsx", "--import", "./tests/test-setup.ts", quotedFilePath],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: "test",
        },
        shell: isWindows,
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      const str = data.toString();
      stdout += str;
      process.stdout.write(str);
    });

    child.stderr.on("data", (data) => {
      const str = data.toString();
      stderr += str;
      process.stderr.write(str);
    });

    child.on("close", (code) => {
      const durationMs = Date.now() - start;
      resolve({
        file: relPath,
        passed: code === 0,
        exitCode: code ?? 1,
        durationMs,
        stdout,
        stderr,
      });
    });

    child.on("error", (err) => {
      const durationMs = Date.now() - start;
      resolve({
        file: relPath,
        passed: false,
        exitCode: 1,
        durationMs,
        stdout,
        stderr: err.message,
      });
    });
  });
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const isIntegration = rawArgs.includes("--integration");
  const isProposal = rawArgs.includes("--proposal");
  const filterArg = rawArgs.find((a) => !a.startsWith("--")) || "";

  // 1. Idempotently ensure dev fixtures are seeded in isolated test database
  try {
    await seedDevFixtures();
    console.log("✔ Isolated dev fixtures ready.\n");
  } catch (err: any) {
    console.error("Warning: Fixture seeding failed:", err.message);
  }

  let testFiles: Array<{ name: string; fullPath: string }> = [];

  if (isProposal) {
    const proposalDir = path.resolve(process.cwd(), "tests", "table-proposal");
    if (fs.existsSync(proposalDir)) {
      testFiles = fs
        .readdirSync(proposalDir)
        .filter((f) => f.endsWith(".test.ts") || f.endsWith(".test.tsx"))
        .filter((f) => !filterArg || f.includes(filterArg))
        .map((f) => ({ name: f, fullPath: path.join(proposalDir, f) }));
    }
  } else {
    const testsDir = path.resolve(process.cwd(), "tests");
    testFiles = fs
      .readdirSync(testsDir)
      .filter((f) => f.endsWith(".test.ts") || f.endsWith(".test.tsx"))
      .filter((f) => {
        if (isIntegration) {
          return INTEGRATION_TEST_SUITES.has(f);
        } else {
          return !INTEGRATION_TEST_SUITES.has(f);
        }
      })
      .filter((f) => !filterArg || f.includes(filterArg))
      .map((f) => ({ name: f, fullPath: path.join(testsDir, f) }));
  }

  testFiles.sort((a, b) => a.name.localeCompare(b.name));

  const suiteMode = isIntegration
    ? "INTEGRATION (LIVE APIS & KEYS)"
    : isProposal
    ? "TABLE PROPOSAL (PRISMA SCHEMA EXTENSION)"
    : "UNIT & REGRESSION (ISOLATED DETERMINISTIC)";

  console.log("================================================================================");
  console.log(` AI RESEARCH HUB — RUNNING ${testFiles.length} TEST SUITE(S) [${suiteMode}]`);
  console.log(" Environment: Isolated Local DB & Storage (tests/test-setup.ts)");
  console.log("================================================================================\n");

  const results: TestFileResult[] = [];
  const startTime = Date.now();

  for (const { name, fullPath } of testFiles) {
    console.log(`\n▶ RUNNING: ${name}...`);
    const result = await runSingleTest(fullPath);
    results.push(result);
    if (result.passed) {
      console.log(`✔ FINISHED: ${name} in ${(result.durationMs / 1000).toFixed(2)}s\n`);
    } else {
      console.error(`✖ FAILED: ${name} (exit code ${result.exitCode}) in ${(result.durationMs / 1000).toFixed(2)}s\n`);
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  console.log("\n================================================================================");
  console.log(" TEST RUNNER SUMMARY REPORT");
  console.log("================================================================================");
  console.log(`Mode:          ${suiteMode}`);
  console.log(`Total Suites:  ${results.length}`);
  console.log(`Passed:        ${passedCount}`);
  console.log(`Failed:        ${failedCount}`);
  console.log(`Total Time:    ${totalDuration}s\n`);

  if (failedCount > 0) {
    console.error("Failed Suites:");
    for (const r of results.filter((r) => !r.passed)) {
      console.error(` - ${r.file} (exit code: ${r.exitCode})`);
    }
    process.exit(1);
  } else {
    console.log("ALL TEST SUITES PASSED SUCCESSFULLY.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
