import { prisma } from "@/lib/db/prisma";
import { runSync } from "@/lib/sync/syncEngine";

async function main() {
  const dueRules = await prisma.syncRule.findMany({
    where: {
      isEnabled: true,
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: new Date() } }],
    },
  });

  for (const rule of dueRules) {
    console.log(`Running sync rule ${rule.name} (${rule.id})`);
    await runSync(rule.id);
  }

  console.log(`Processed ${dueRules.length} sync rule(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
