import { Prisma } from "@prisma/client";
import { ADMIN_TEST_FIXTURE_IDS } from "./paper-authorization";

export interface PaperVisibilityOptions {
  role?: string | null;
  allowAdmin?: boolean;
  isAdminRoute?: boolean;
  allowFixturesForAuth?: boolean;
}

/**
 * Generates a Prisma where filter that guarantees:
 * 1. Admin test fixtures are strictly restricted to ADMIN role.
 * 2. Private manuscripts (isPrivate: true or ownerId/uploadedByUserId/attachedByUserId set)
 *    are visible ONLY to the owning user.
 * 3. Administrative bypass (returning {}) applies ONLY when explicitly requested for
 *    /admin routes or admin maintenance actions (isAdminRoute: true or allowAdmin: true).
 *    In user-facing search and research tools, admins receive the same multi-tenant isolation as normal users.
 * 4. Public papers (not private and no owner) are visible to all users (and anonymous).
 */
export function paperVisibilityFilter(
  userId?: string | null,
  options?: PaperVisibilityOptions
): Prisma.PaperWhereInput {
  const isAdminBypass =
    (options?.isAdminRoute === true || options?.allowAdmin === true) &&
    options?.role === "ADMIN";

  // Admin bypass applies ONLY to /admin routes and administrative maintenance actions
  if (isAdminBypass) {
    return {};
  }

  const baseNonFixture: Prisma.PaperWhereInput = options?.allowFixturesForAuth
    ? {}
    : { id: { notIn: Array.from(ADMIN_TEST_FIXTURE_IDS) } };

  const publicPaperProvenanceFilter: Prisma.PaperWhereInput = {
    AND: [
      {
        OR: [
          { sourceProvenance: { path: ["isPrivate"], equals: Prisma.AnyNull } },
          { sourceProvenance: { path: ["isPrivate"], equals: false } },
        ],
      },
      { sourceProvenance: { path: ["ownerId"], equals: Prisma.AnyNull } },
      { sourceProvenance: { path: ["ownerUserId"], equals: Prisma.AnyNull } },
      { sourceProvenance: { path: ["uploadedByUserId"], equals: Prisma.AnyNull } },
      { sourceProvenance: { path: ["attachedByUserId"], equals: Prisma.AnyNull } },
      { sourceProvenance: { path: ["userId"], equals: Prisma.AnyNull } },
    ],
  };

  if (!userId) {
    // Anonymous visitors can only see strictly public papers (never private, never owned)
    return {
      AND: [
        baseNonFixture,
        publicPaperProvenanceFilter,
      ],
    };
  }

  // Authenticated user: can see public papers OR papers they own
  return {
    AND: [
      baseNonFixture,
      {
        OR: [
          // Public papers (no isPrivate: true and no private ownership)
          publicPaperProvenanceFilter,
          // User's own papers
          { sourceProvenance: { path: ["ownerId"], equals: userId } },
          { sourceProvenance: { path: ["ownerUserId"], equals: userId } },
          { sourceProvenance: { path: ["uploadedByUserId"], equals: userId } },
          { sourceProvenance: { path: ["attachedByUserId"], equals: userId } },
          { sourceProvenance: { path: ["userId"], equals: userId } },
        ],
      },
    ],
  };
}

/**
 * Generates a raw SQL Prisma.Sql fragment to enforce the identical visibility policy
 * in $queryRaw queries:
 * (p.id NOT IN (...) AND (
 *    (p."sourceProvenance"->>'isPrivate' IS DISTINCT FROM 'true'
 *     AND p."sourceProvenance"->>'ownerId' IS NULL
 *     AND p."sourceProvenance"->>'uploadedByUserId' IS NULL
 *     AND p."sourceProvenance"->>'attachedByUserId' IS NULL)
 *    OR p."sourceProvenance"->>'ownerId' = ${userId}
 *    OR p."sourceProvenance"->>'uploadedByUserId' = ${userId}
 *    OR p."sourceProvenance"->>'attachedByUserId' = ${userId}
 * ))
 */
export function paperVisibilitySql(
  userId?: string | null,
  tableAlias: string = "p",
  options?: PaperVisibilityOptions
): Prisma.Sql {
  const isAdminBypass =
    (options?.isAdminRoute === true || options?.allowAdmin === true) &&
    options?.role === "ADMIN";

  if (isAdminBypass) {
    return Prisma.sql`1=1`;
  }

  const fixtureIds = Array.from(ADMIN_TEST_FIXTURE_IDS);
  const alias = Prisma.raw(tableAlias);

  const fixtureExclusion = fixtureIds.length > 0
    ? Prisma.sql`${alias}."id" NOT IN (${Prisma.join(fixtureIds)})`
    : Prisma.sql`1=1`;

  if (!userId) {
    return Prisma.sql`(${fixtureExclusion} AND (
      (${alias}."sourceProvenance"->>'isPrivate' IS NULL OR ${alias}."sourceProvenance"->>'isPrivate' != 'true')
      AND ${alias}."sourceProvenance"->>'ownerId' IS NULL
      AND ${alias}."sourceProvenance"->>'ownerUserId' IS NULL
      AND ${alias}."sourceProvenance"->>'uploadedByUserId' IS NULL
      AND ${alias}."sourceProvenance"->>'attachedByUserId' IS NULL
      AND ${alias}."sourceProvenance"->>'userId' IS NULL
    ))`;
  }

  return Prisma.sql`(${fixtureExclusion} AND (
    (
      (${alias}."sourceProvenance"->>'isPrivate' IS NULL OR ${alias}."sourceProvenance"->>'isPrivate' != 'true')
      AND ${alias}."sourceProvenance"->>'ownerId' IS NULL
      AND ${alias}."sourceProvenance"->>'ownerUserId' IS NULL
      AND ${alias}."sourceProvenance"->>'uploadedByUserId' IS NULL
      AND ${alias}."sourceProvenance"->>'attachedByUserId' IS NULL
      AND ${alias}."sourceProvenance"->>'userId' IS NULL
    )
    OR ${alias}."sourceProvenance"->>'ownerId' = ${userId}
    OR ${alias}."sourceProvenance"->>'ownerUserId' = ${userId}
    OR ${alias}."sourceProvenance"->>'uploadedByUserId' = ${userId}
    OR ${alias}."sourceProvenance"->>'attachedByUserId' = ${userId}
    OR ${alias}."sourceProvenance"->>'userId' = ${userId}
  ))`;
}
