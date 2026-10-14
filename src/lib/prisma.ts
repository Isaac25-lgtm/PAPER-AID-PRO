import "server-only";
import { PrismaClient } from "@prisma/client";

// Prevent multiple instances of Prisma Client in development
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Fail-closed guard: ensure development environment connects ONLY to authorized local loopback PostgreSQL
if (process.env.NODE_ENV === "development") {
  const dbUrl = process.env.DATABASE_URL || "";
  const directUrl = process.env.DIRECT_URL || "";

  const ALLOWED_LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1", "[::1]"];
  const FORBIDDEN_KEYWORDS = [
    "supabase",
    "pooler",
    "aws-",
    "gcp-",
    "azure-",
    "render",
    "neon",
    "railway",
    "cockroach",
    ".supabase.co",
    ".pooler.supabase.com",
  ];

  const extractHost = (urlStr: string): string | null => {
    try {
      if (!urlStr) return null;
      const parsed = new URL(urlStr);
      return parsed.hostname.toLowerCase();
    } catch {
      return null;
    }
  };

  const dbHost = extractHost(dbUrl);
  const directHost = directUrl ? extractHost(directUrl) : dbHost;

  const isDbLoopback = Boolean(dbHost && ALLOWED_LOOPBACK_HOSTS.includes(dbHost));
  const isDirectLoopback = Boolean(directHost && ALLOWED_LOOPBACK_HOSTS.includes(directHost));

  const hasForbiddenKeyword =
    FORBIDDEN_KEYWORDS.some((kw) => dbUrl.toLowerCase().includes(kw)) ||
    (directUrl ? FORBIDDEN_KEYWORDS.some((kw) => directUrl.toLowerCase().includes(kw)) : false);

  if (!isDbLoopback || !isDirectLoopback || hasForbiddenKeyword) {
    const errorMsg =
      "\n====================================================================\n" +
      "[CRITICAL SAFETY BLOCK] ACCIDENTAL REMOTE DATABASE CONNECTION PREVENTED!\n" +
      "The Next.js development server attempted to connect to an unauthorized database.\n" +
      `DATABASE_URL Host: ${dbHost || "unknown"} (authorized loopback: ${isDbLoopback})\n` +
      `DIRECT_URL Host:   ${directHost || "unknown"} (authorized loopback: ${isDirectLoopback})\n` +
      "To protect production data, local development MUST use local Docker PostgreSQL (127.0.0.1:5432).\n" +
      "Launch using 'npm run dev' to activate the isolated local environment.\n" +
      "====================================================================\n";
    console.error(errorMsg);
    throw new Error(
      "[CRITICAL SAFETY BLOCK] Local development against remote databases is strictly prohibited. Both DATABASE_URL and DIRECT_URL must be authorized loopback databases."
    );
  }
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
