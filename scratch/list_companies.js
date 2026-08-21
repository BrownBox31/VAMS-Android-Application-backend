const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== COMPANIES ===');
  const companies = await prisma.company.findMany({
    include: {
      settings: true,
    }
  });
  console.dir(companies, { depth: null });

  console.log('\n=== USERS ===');
  const users = await prisma.user.findMany();
  console.dir(users, { depth: null });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
