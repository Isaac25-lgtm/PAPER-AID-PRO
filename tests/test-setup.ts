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

const {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
} = require("../src/lib/test-guard");

loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

module.exports = {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
};
