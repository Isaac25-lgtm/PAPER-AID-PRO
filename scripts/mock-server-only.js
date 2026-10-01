// Mock server-only for standalone script execution outside Next.js runtime
try {
  const resolved = require.resolve("server-only");
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: {},
  };
} catch {
  // If not found, ignore
}
