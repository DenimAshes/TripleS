import { launch } from "cloakbrowser";

type TestResult = { name: string; status: "PASS" | "FAIL" | "ERROR"; verdict: string };

async function main() {
  const results: TestResult[] = [];
  const browser = await launch({ headless: true, humanize: false });
  const page = await browser.newPage();

  async function run(name: string, fn: () => Promise<{ pass: boolean; verdict: string }>) {
    try {
      const { pass, verdict } = await fn();
      results.push({ name, status: pass ? "PASS" : "FAIL", verdict });
      console.log(`[${pass ? "PASS" : "FAIL"}] ${name}: ${verdict}`);
    } catch (err) {
      const verdict = err instanceof Error ? err.message : String(err);
      results.push({ name, status: "ERROR", verdict });
      console.log(`[ERROR] ${name}: ${verdict}`);
    }
  }

  await run("bot.sannysoft.com", async () => {
    await page.goto("https://bot.sannysoft.com", { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(3000);
    const r = await page.evaluate(() => {
      const rows = document.querySelectorAll("table tr");
      let passed = 0, total = 0;
      const failed: string[] = [];
      rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 2) {
          total += 1;
          const cls = (cells[1] as HTMLElement).className || "";
          if (cls.includes("failed")) failed.push((cells[0] as HTMLElement).innerText.trim());
          else passed += 1;
        }
      });
      return { passed, total, failed };
    });
    return {
      pass: r.failed.length === 0,
      verdict: r.failed.length === 0 ? `${r.passed}/${r.total} all green` : `${r.passed}/${r.total} (failed: ${r.failed.join(", ")})`,
    };
  });

  await run("deviceandbrowserinfo.com", async () => {
    await page.goto("https://deviceandbrowserinfo.com/are_you_a_bot", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(8000);
    const r = await page.evaluate(() => {
      const text = document.body.innerText;
      const m = text.match(/"isBot":\s*(true|false)/);
      return { isBot: m ? m[1] === "true" : null };
    });
    return { pass: r.isBot === false, verdict: `isBot: ${r.isBot}` };
  });

  await run("browserscan.net/bot-detection", async () => {
    await page.goto("https://www.browserscan.net/bot-detection", { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(5000);
    const r = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        normal: (text.match(/Normal/g) || []).length,
        abnormal: (text.match(/Abnormal/g) || []).length,
      };
    });
    return { pass: r.abnormal === 0, verdict: `Normal: ${r.normal}, Abnormal: ${r.abnormal}` };
  });

  await browser.close();

  const passed = results.filter((r) => r.status === "PASS").length;
  console.log(`\n${passed}/${results.length} tests passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
