const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf-8');
let dbUrl = '';
for (const line of env.split('\n')) {
  const m = line.match(/^DATABASE_URL=(.*)$/);
  if (m) {
    dbUrl = m[1].trim().replace(/^['"]|['"]$/g, '');
  }
}

// Test with current URL
async function test() {
  console.log('Testing current DATABASE_URL...');
  const prismaCurrent = new PrismaClient();
  try {
    const res = await prismaCurrent.$queryRaw`SELECT 1 as val`;
    console.log('Current URL query success:', res);
  } catch (e) {
    console.error('Current URL query error:', e.message);
  } finally {
    await prismaCurrent.$disconnect();
  }

  // Test with port 6543 and pgbouncer=true
  try {
    const u = new URL(dbUrl);
    u.port = '6543';
    u.searchParams.set('pgbouncer', 'true');
    u.searchParams.set('connection_limit', '1');
    const pooledUrl = u.toString();

    console.log('Testing 6543 Transaction Pooler URL...');
    const prismaPooled = new PrismaClient({
      datasources: { db: { url: pooledUrl } }
    });
    const resPooled = await prismaPooled.$queryRaw`SELECT 1 as val`;
    console.log('6543 Pooler query success:', resPooled);
    await prismaPooled.$disconnect();
  } catch (e) {
    console.error('6543 Pooler query error:', e.message);
  }
}

test();
