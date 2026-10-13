import "server-only";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { authorizePaperAccess } from "@/lib/auth/paper-authorization";

export interface UserCollection {
  id: string;
  name: string;
  description?: string;
  color: string;
  paperCount: number;
  createdAt: string;
}

export interface BookmarkNotesData {
  collections: string[];
  userNote?: string;
}

export const DEFAULT_COLLECTION_COLORS = [
  "#4f46e5", // Indigo
  "#0ea5e9", // Sky
  "#059669", // Emerald
  "#d97706", // Amber
  "#7c3aed", // Violet
  "#e11d48", // Rose
];

/**
 * Parses user notes safely.
 * NOTE: Collections are stored relationally in Collection / CollectionPaper models,
 * NOT inside Bookmark.notes or AIConversation records.
 */
export function parseBookmarkNotes(notesStr: string | null | undefined): BookmarkNotesData {
  if (!notesStr || notesStr.trim().length === 0) {
    return { collections: [] };
  }

  try {
    const parsed = JSON.parse(notesStr);
    if (parsed && typeof parsed === "object") {
      return {
        collections: Array.isArray(parsed.collections)
          ? parsed.collections.map((c: any) => String(c).trim()).filter(Boolean)
          : [],
        userNote: typeof parsed.userNote === "string" ? parsed.userNote : undefined,
      };
    }
  } catch {
    return {
      collections: [],
      userNote: notesStr,
    };
  }

  return { collections: [] };
}

/**
 * Serializes optional user note without polluting it with collections.
 */
export function serializeBookmarkNotes(data: BookmarkNotesData): string {
  return JSON.stringify({
    userNote: data.userNote || undefined,
  });
}

/**
 * Retrieves all relational collections created by the user along with active paper counts.
 * Uses dedicated Collection and CollectionPaper tables.
 */
export async function getUserCollections(userId: string): Promise<UserCollection[]> {
  const collections = await prisma.collection.findMany({
    where: { userId },
    include: {
      _count: {
        select: { papers: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return collections.map((col, idx) => ({
    id: col.id,
    name: col.name,
    description: col.description || undefined,
    color: col.color || DEFAULT_COLLECTION_COLORS[idx % DEFAULT_COLLECTION_COLORS.length],
    paperCount: col._count.papers,
    createdAt: col.createdAt.toISOString(),
  }));
}

/**
 * Creates a new personal collection for the user in the relational database.
 */
export async function createCollection(
  userId: string,
  name: string,
  options?: { description?: string; color?: string }
): Promise<UserCollection> {
  const cleanName = name.trim();
  if (!cleanName || cleanName.length < 2) {
    throw new Error("Collection name must contain at least 2 characters.");
  }
  if (cleanName.length > 50) {
    throw new Error("Collection name cannot exceed 50 characters.");
  }

  const existing = await prisma.collection.findUnique({
    where: {
      userId_name: {
        userId,
        name: cleanName,
      },
    },
  });

  if (existing) {
    throw new Error(`A collection named "${cleanName}" already exists.`);
  }

  const userCollectionsCount = await prisma.collection.count({ where: { userId } });
  const color =
    options?.color ||
    DEFAULT_COLLECTION_COLORS[userCollectionsCount % DEFAULT_COLLECTION_COLORS.length];

  const col = await prisma.collection.create({
    data: {
      userId,
      name: cleanName,
      description: options?.description?.trim() || null,
      color,
    },
    include: {
      _count: {
        select: { papers: true },
      },
    },
  });

  try {
    revalidatePath("/library");
  } catch {}

  return {
    id: col.id,
    name: col.name,
    description: col.description || undefined,
    color: col.color || color,
    paperCount: col._count.papers,
    createdAt: col.createdAt.toISOString(),
  };
}

/**
 * Renames a collection belonging to the user.
 */
export async function renameCollection(
  userId: string,
  oldName: string,
  newName: string
): Promise<void> {
  const cleanOld = oldName.trim();
  const cleanNew = newName.trim();

  if (!cleanNew || cleanNew.length < 2) {
    throw new Error("New collection name must contain at least 2 characters.");
  }
  if (cleanOld.toLowerCase() === cleanNew.toLowerCase()) {
    return;
  }

  const existingTarget = await prisma.collection.findUnique({
    where: { userId_name: { userId, name: cleanNew } },
  });
  if (existingTarget) {
    throw new Error(`A collection named "${cleanNew}" already exists.`);
  }

  const col = await prisma.collection.findUnique({
    where: { userId_name: { userId, name: cleanOld } },
  });
  if (!col) {
    throw new Error(`Collection "${cleanOld}" not found.`);
  }

  await prisma.collection.update({
    where: { id: col.id },
    data: { name: cleanNew },
  });

  try {
    revalidatePath("/library");
  } catch {}
}

/**
 * Deletes a collection from the user's workspace.
 * Cascades ONLY to collection_papers junction records.
 * NEVER deletes any Paper records, user-uploaded PDFs, or bookmarks.
 */
export async function deleteCollection(
  userId: string,
  collectionName: string
): Promise<void> {
  const cleanName = collectionName.trim();

  const col = await prisma.collection.findUnique({
    where: { userId_name: { userId, name: cleanName } },
  });

  if (!col) return;

  await prisma.collection.delete({
    where: { id: col.id },
  });

  try {
    revalidatePath("/library");
  } catch {}
}

/**
 * Adds a paper to a personal collection after verifying authorization.
 * Both public saved papers and privately owned documents are supported.
 * Unauthorized papers (e.g. other users' private documents or admin fixtures) are rejected.
 */
export async function addPaperToCollection(
  userId: string,
  paperId: string,
  collectionName: string
): Promise<void> {
  const cleanName = collectionName.trim();
  if (!cleanName) throw new Error("Collection name is required.");

  // 1. Verify paper existence and authorization
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    select: {
      id: true,
      title: true,
      doi: true,
      arxivId: true,
      pmid: true,
      pmcid: true,
      semanticScholarId: true,
      sourceProvenance: true,
      status: true,
      isOpenAccess: true,
      storagePath: true,
      pdfUrl: true,
    },
  });

  if (!paper) {
    throw new Error(`Document "${paperId}" not found.`);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  const auth = await authorizePaperAccess(paper, user, "VIEW_METADATA");
  if (!auth.allowed) {
    throw new Error("Unauthorized: You do not have permission to add this document to a collection.");
  }

  // 2. Ensure collection exists for user (create if absent)
  let col = await prisma.collection.findUnique({
    where: { userId_name: { userId, name: cleanName } },
  });

  if (!col) {
    const userCollectionsCount = await prisma.collection.count({ where: { userId } });
    col = await prisma.collection.create({
      data: {
        userId,
        name: cleanName,
        color: DEFAULT_COLLECTION_COLORS[userCollectionsCount % DEFAULT_COLLECTION_COLORS.length],
      },
    });
  }

  // 3. Upsert CollectionPaper junction
  await prisma.collectionPaper.upsert({
    where: {
      collectionId_paperId: {
        collectionId: col.id,
        paperId,
      },
    },
    create: {
      collectionId: col.id,
      paperId,
    },
    update: {},
  });

  // 4. Ensure paper is also bookmarked by this user
  await prisma.bookmark.upsert({
    where: { userId_paperId: { userId, paperId } },
    create: { userId, paperId },
    update: {},
  });

  try {
    revalidatePath("/library");
  } catch {}
}

/**
 * Removes a paper from a personal collection.
 * Leaves the underlying research paper and bookmark completely intact.
 */
export async function removePaperFromCollection(
  userId: string,
  paperId: string,
  collectionName: string
): Promise<void> {
  const cleanName = collectionName.trim();

  const col = await prisma.collection.findUnique({
    where: { userId_name: { userId, name: cleanName } },
  });

  if (!col) return;

  await prisma.collectionPaper.deleteMany({
    where: {
      collectionId: col.id,
      paperId,
    },
  });

  try {
    revalidatePath("/library");
  } catch {}
}

/**
 * Sets the complete list of collections for a paper in one operation.
 * Authorizes access, ensures collections exist, and synchronizes CollectionPaper junction rows.
 */
export async function setPaperCollections(
  userId: string,
  paperId: string,
  collectionNames: string[]
): Promise<void> {
  const cleanNames = Array.from(
    new Set(collectionNames.map((c) => c.trim()).filter(Boolean))
  );

  // 1. Authorize paper access
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    select: {
      id: true,
      title: true,
      doi: true,
      arxivId: true,
      pmid: true,
      pmcid: true,
      semanticScholarId: true,
      sourceProvenance: true,
      status: true,
      isOpenAccess: true,
      storagePath: true,
      pdfUrl: true,
    },
  });

  if (!paper) {
    throw new Error(`Document "${paperId}" not found.`);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  const auth = await authorizePaperAccess(paper, user, "VIEW_METADATA");
  if (!auth.allowed) {
    throw new Error("Unauthorized: You do not have permission to manage collections for this document.");
  }

  // 2. Fetch or create all named collections for this user
  const userCollections = await prisma.collection.findMany({
    where: { userId },
  });

  const colMap = new Map(userCollections.map((c) => [c.name, c]));

  for (const name of cleanNames) {
    if (!colMap.has(name)) {
      const created = await prisma.collection.create({
        data: {
          userId,
          name,
          color: DEFAULT_COLLECTION_COLORS[colMap.size % DEFAULT_COLLECTION_COLORS.length],
        },
      });
      colMap.set(name, created);
    }
  }

  const targetCollectionIds = new Set(
    cleanNames.map((name) => colMap.get(name)!.id)
  );

  // 3. Atomically sync collection memberships for this paper under this user
  const currentMemberships = await prisma.collectionPaper.findMany({
    where: {
      paperId,
      collection: { userId },
    },
  });

  const currentCollectionIds = new Set(currentMemberships.map((m) => m.collectionId));

  // Add missing
  for (const colId of Array.from(targetCollectionIds)) {
    if (!currentCollectionIds.has(colId)) {
      await prisma.collectionPaper.create({
        data: {
          collectionId: colId,
          paperId,
        },
      }).catch(() => {});
    }
  }

  // Remove unselected
  for (const m of currentMemberships) {
    if (!targetCollectionIds.has(m.collectionId)) {
      await prisma.collectionPaper.delete({
        where: { id: m.id },
      }).catch(() => {});
    }
  }

  // Ensure bookmark exists if paper has at least 1 collection
  if (targetCollectionIds.size > 0) {
    await prisma.bookmark.upsert({
      where: { userId_paperId: { userId, paperId } },
      create: { userId, paperId },
      update: {},
    });
  }

  try {
    revalidatePath("/library");
  } catch {}
}
