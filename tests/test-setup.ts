/**
 * Global test setup for AI Research Hub test suite.
 * Mocks server-only and configures the isolated test environment.
 */

try {
  const serverOnlyPath = require.resolve("server-only");
  (require.cache as any)[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
  };
} catch {
  // server-only not installed or already handled
}

import fs from "fs";
import path from "path";

// In isolated test runs, prevent Prisma Client runtime from auto-reading root .env
// which would otherwise leak remote production Supabase credentials into the test environment.
const origReadFileSync = fs.readFileSync;
fs.readFileSync = function (this: any, ...args: any[]) {
  const filePath = typeof args[0] === "string" ? args[0] : "";
  if (filePath && path.basename(filePath) === ".env" && !filePath.includes(".env.test")) {
    return "";
  }
  return origReadFileSync.apply(this, args as any);
} as any;

import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
} from "../src/lib/test-guard";

loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

export {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
};
