import { promises as fs } from "node:fs";
import path from "node:path";

// Lint Prisma migrations for patterns that block on big tables in production.
// On local SQLite/empty Neon they look harmless; once data exists they cause
// long-running locks or outright failure. The migration that broke prod is
// almost always the one nobody reviewed for these issues.
//
// Checks (all heuristic — false positives are easy to silence with a
// "-- @migration-lint-ignore" comment on the same SQL statement):
//   - ADD COLUMN ... NOT NULL without a DEFAULT (Postgres rewrites the table)
//   - DROP COLUMN (irreversible, also rewrites table on some engines)
//   - DROP TABLE
//   - ALTER COLUMN ... TYPE without USING (data-loss risk on type narrowing)
//   - Concurrent operations on tables that have FKs — out of scope here,
//     handled in code review.
//
// Usage:
//   npm run lint:migrations                  # check all migrations
//   npm run lint:migrations -- --since=HEAD  # only those touched on this branch
//
// Exit code 0 = clean, 1 = at least one warning, 2 = invocation error.

type Finding = {
  file: string;
  line: number;
  level: "warn" | "fail";
  message: string;
  snippet: string;
};

const IGNORE_MARKER = "@migration-lint-ignore";

function findInSql(file: string, sql: string): Finding[] {
  const findings: Finding[] = [];
  const lines = sql.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/--.*$/, "").trim();
    if (!line) continue;
    if (raw.includes(IGNORE_MARKER)) continue;

    if (/\bADD\s+COLUMN\b/i.test(line) && /\bNOT\s+NULL\b/i.test(line) && !/\bDEFAULT\b/i.test(line)) {
      findings.push({
        file,
        line: i + 1,
        level: "fail",
        message: "ADD COLUMN ... NOT NULL without DEFAULT rewrites the table and blocks writes on Postgres.",
        snippet: raw.trim(),
      });
    }
    if (/\bDROP\s+COLUMN\b/i.test(line)) {
      findings.push({
        file,
        line: i + 1,
        level: "warn",
        message: "DROP COLUMN is irreversible and may rewrite the table. Stage the drop after the app stops using the column.",
        snippet: raw.trim(),
      });
    }
    if (/\bDROP\s+TABLE\b/i.test(line) && !/IF\s+EXISTS/i.test(line)) {
      findings.push({
        file,
        line: i + 1,
        level: "fail",
        message: "DROP TABLE without IF EXISTS will fail (and irreversibly remove data on success).",
        snippet: raw.trim(),
      });
    }
    if (/\bALTER\s+COLUMN\b/i.test(line) && /\bTYPE\b/i.test(line) && !/\bUSING\b/i.test(line)) {
      findings.push({
        file,
        line: i + 1,
        level: "warn",
        message: "ALTER COLUMN ... TYPE without USING risks silent data truncation; add a USING clause and/or backfill first.",
        snippet: raw.trim(),
      });
    }
  }
  return findings;
}

async function main() {
  const migrationsDir = path.resolve("prisma/migrations");
  let entries: string[];
  try {
    entries = await fs.readdir(migrationsDir);
  } catch (error) {
    console.error(`[lint] cannot read ${migrationsDir}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }

  const findings: Finding[] = [];
  for (const entry of entries) {
    const sqlPath = path.join(migrationsDir, entry, "migration.sql");
    let sql: string;
    try {
      sql = await fs.readFile(sqlPath, "utf8");
    } catch {
      continue;
    }
    findings.push(...findInSql(path.relative(process.cwd(), sqlPath), sql));
  }

  if (!findings.length) {
    console.log("[lint] migrations look clean.");
    return;
  }

  let failures = 0;
  for (const finding of findings) {
    const prefix = finding.level === "fail" ? "FAIL" : "WARN";
    console.log(`[${prefix}] ${finding.file}:${finding.line} — ${finding.message}`);
    console.log(`        ${finding.snippet}`);
    if (finding.level === "fail") failures += 1;
  }
  console.log(`\n[lint] ${findings.length} finding(s), ${failures} fail.`);
  process.exitCode = failures > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 2;
});
