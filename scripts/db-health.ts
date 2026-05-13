import { prisma } from "@/lib/db/prisma";

async function main() {
  const [users, playlists, syncRules] = await Promise.all([
    prisma.user.count(),
    prisma.playlist.count(),
    prisma.syncRule.count(),
  ]);

  console.log(JSON.stringify({ ok: true, users, playlists, syncRules }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
