import { prisma } from "@/lib/db/prisma";
import { markServiceSuccess } from "@/lib/sync/serviceCooldown";

const SERVICES = ["youtube", "spotify", "soundcloud"] as const;
type Service = (typeof SERVICES)[number];

function usage(): never {
  console.error(
    [
      "Usage: npm run cooldown:clear -- <youtube|spotify|soundcloud>... [--all] [--list]",
      "",
      "A hard-block failure parks a service for 6-72 hours. Once the underlying",
      "problem is fixed there is nothing else that clears the row, so the worker",
      "keeps skipping every rule that touches the service until it expires.",
      "--list prints the current rows without changing anything.",
    ].join("\n"),
  );
  process.exit(1);
}

function parseArgs(argv: string[]): { services: Service[]; listOnly: boolean } {
  const listOnly = argv.includes("--list");
  const rest = argv.filter((arg) => !arg.startsWith("--"));
  if (argv.includes("--all")) return { services: [...SERVICES], listOnly };
  if (listOnly && !rest.length) return { services: [], listOnly };
  if (!rest.length) usage();

  const services: Service[] = [];
  for (const arg of rest) {
    const match = SERVICES.find((service) => service === arg.toLowerCase());
    if (!match) {
      console.error(`Unknown service "${arg}". Expected one of: ${SERVICES.join(", ")}.`);
      process.exit(1);
    }
    if (!services.includes(match)) services.push(match);
  }
  return { services, listOnly };
}

async function printRows(label: string): Promise<void> {
  const rows = await prisma.serviceCooldown.findMany({ orderBy: { service: "asc" } });
  if (!rows.length) {
    console.log(`[cooldown] ${label}: no rows.`);
    return;
  }
  const now = new Date();
  for (const row of rows) {
    const active = row.until > now;
    console.log(
      `[cooldown] ${label}: ${row.service} ${active ? `active until ${row.until.toISOString()}` : "expired"}` +
        ` failures=${row.failureCount}${row.reason ? ` reason=${row.reason.slice(0, 80)}` : ""}`,
    );
  }
}

async function main() {
  const { services, listOnly } = parseArgs(process.argv.slice(2));
  await printRows("before");
  if (listOnly) return;

  for (const service of services) {
    await markServiceSuccess(service);
    console.log(`[cooldown] cleared ${service}.`);
  }
  await printRows("after");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
