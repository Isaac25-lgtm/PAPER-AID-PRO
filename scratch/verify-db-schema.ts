import { prisma } from "../src/lib/prisma";

async function main() {
  const columns: any[] = await prisma.$queryRaw`
    SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_name = 'paper_chunks'
    ORDER BY ordinal_position;
  `;
  console.log("Columns on paper_chunks:", columns);

  const indexes: any[] = await prisma.$queryRaw`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'paper_chunks';
  `;
  console.log("Indexes on paper_chunks:", indexes);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error("Error inspecting paper_chunks table:", err);
  process.exit(1);
});
