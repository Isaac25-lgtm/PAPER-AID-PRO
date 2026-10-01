import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("=== CHECKING STORAGE SCHEMAS IN POSTGRESQL ===");
  try {
    const buckets = await prisma.$queryRawUnsafe(`SELECT id, name, public, created_at FROM storage.buckets;`);
    console.log("Buckets in DB:", buckets);
  } catch (err: any) {
    console.error("Error reading storage.buckets:", err.message);
  }

  try {
    const objects = await prisma.$queryRawUnsafe(`SELECT id, bucket_id, name, created_at FROM storage.objects;`);
    console.log("Objects in DB:", objects);
  } catch (err: any) {
    console.error("Error reading storage.objects:", err.message);
  }

  try {
    const policies = await prisma.$queryRawUnsafe(`
      SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check 
      FROM pg_policies 
      WHERE schemaname = 'storage';
    `);
    console.log("Policies on storage:", policies);
  } catch (err: any) {
    console.error("Error reading pg_policies:", err.message);
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
