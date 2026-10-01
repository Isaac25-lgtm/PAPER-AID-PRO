import "./load-env";
import { prisma } from "../src/lib/prisma";

async function getUsers() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, role: true },
  });
  console.log("Users:", users);
}

getUsers().finally(async () => {
  await prisma.$disconnect();
});
