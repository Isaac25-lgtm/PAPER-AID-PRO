import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface AdminAuthResult {
  authorized: boolean;
  user: { id: string; email: string | null; role: string } | null;
  error?: string;
}

/**
 * Server-side direct database role re-check.
 * Never relies solely on JWT claim (session.user.role) because JWTs do not reflect
 * instant role revocation or user demotion in PostgreSQL.
 */
export async function verifyAdminSession(): Promise<AdminAuthResult> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return {
      authorized: false,
      user: null,
      error: "Authentication required. Admin privileges required.",
    };
  }

  // Fast-fail if session token doesn't even claim ADMIN
  if (session.user.role !== "ADMIN") {
    return {
      authorized: false,
      user: null,
      error: "Unauthorized. Admin privileges required.",
    };
  }

  // Authoritative database re-check: verify current role in PostgreSQL
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, role: true },
  });

  if (!dbUser || dbUser.role !== "ADMIN") {
    return {
      authorized: false,
      user: null,
      error: "Unauthorized. Admin privileges revoked or insufficient.",
    };
  }

  return {
    authorized: true,
    user: dbUser,
  };
}

