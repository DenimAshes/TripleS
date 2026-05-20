import { prisma } from "@/lib/db/prisma";
import { serviceKey } from "@/lib/services/adapterFactory";
import type { NormalizedTrack } from "@/lib/sync/syncTypes";
import { calculateSimilarityWithBreakdown } from "@/lib/utils/similarity";
import { parseArtistsJson } from "@/lib/utils/parseArtists";
import type { ServiceTrack } from "@prisma/client";

const thresholds = [0.65, 0.7, 0.72, 0.75, 0.78, 0.8, 0.82, 0.85, 0.88, 0.9, 0.93, 0.95];

function toTrack(track: ServiceTrack): NormalizedTrack {
  return {
    title: track.title,
    artists: parseArtistsJson(track.artistsJson),
    album: track.album || undefined,
    durationMs: track.durationMs || undefined,
    isrc: track.isrc || undefined,
    sourceService: serviceKey(track.service),
    sourceTrackId: track.serviceTrackId,
    url: track.url || undefined,
    imageUrl: track.imageUrl || undefined,
  };
}

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

async function main() {
  const rows = await prisma.manualMatchCandidate.findMany({
    where: { status: { in: ["ACCEPTED", "REJECTED"] } },
    orderBy: { updatedAt: "desc" },
  });
  const sourceIds = Array.from(new Set(rows.map((row) => row.sourceServiceTrackId)));
  const candidateIds = Array.from(new Set(rows.map((row) => row.candidateServiceTrackId)));
  const tracks = await prisma.serviceTrack.findMany({
    where: { id: { in: Array.from(new Set([...sourceIds, ...candidateIds])) } },
  });
  const trackById = new Map(tracks.map((track) => [track.id, track]));

  const examples = rows.flatMap((row) => {
    const source = trackById.get(row.sourceServiceTrackId);
    const candidate = trackById.get(row.candidateServiceTrackId);
    if (!source || !candidate) return [];
    const breakdown = calculateSimilarityWithBreakdown(toTrack(source), toTrack(candidate));
    return [{
      id: row.id,
      label: row.status === "ACCEPTED",
      status: row.status,
      score: breakdown.score,
      source: `${source.title} - ${parseArtistsJson(source.artistsJson).join(", ")}`,
      candidate: `${candidate.title} - ${parseArtistsJson(candidate.artistsJson).join(", ")}`,
      targetService: row.targetService,
      breakdown,
    }];
  });

  if (!examples.length) {
    console.log("No accepted/rejected manual match candidates found.");
    return;
  }

  console.log(`Loaded ${examples.length} labeled examples (${examples.filter((item) => item.label).length} accepted, ${examples.filter((item) => !item.label).length} rejected).`);
  console.log("");
  console.log("threshold  precision  recall   f1      tp  fp  fn  tn");
  for (const threshold of thresholds) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;
    for (const item of examples) {
      const predicted = item.score >= threshold;
      if (predicted && item.label) tp += 1;
      else if (predicted && !item.label) fp += 1;
      else if (!predicted && item.label) fn += 1;
      else tn += 1;
    }
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    console.log(
      `${threshold.toFixed(2).padEnd(9)}  ${pct(precision).padEnd(9)}  ${pct(recall).padEnd(7)}  ${pct(f1).padEnd(6)}  ${String(tp).padStart(2)}  ${String(fp).padStart(2)}  ${String(fn).padStart(2)}  ${String(tn).padStart(2)}`,
    );
  }

  const defaultThreshold = Number(process.env.WORKER_AUTO_MATCH_THRESHOLD ?? 0.82);
  const falsePositives = examples
    .filter((item) => !item.label && item.score >= defaultThreshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  const falseNegatives = examples
    .filter((item) => item.label && item.score < defaultThreshold)
    .sort((a, b) => a.score - b.score)
    .slice(0, 10);

  console.log("");
  console.log(`Top false positives at threshold ${defaultThreshold.toFixed(2)}:`);
  for (const item of falsePositives) {
    console.log(`- ${item.score.toFixed(3)} ${item.source} => ${item.candidate}`);
    console.log(`  title=${item.breakdown.titleScore.toFixed(2)} artist=${item.breakdown.artistScore.toFixed(2)} durationPenalty=${item.breakdown.durationPenalty.toFixed(2)} variantPenalty=${item.breakdown.variantPenalty.toFixed(2)}`);
  }

  console.log("");
  console.log(`Top false negatives at threshold ${defaultThreshold.toFixed(2)}:`);
  for (const item of falseNegatives) {
    console.log(`- ${item.score.toFixed(3)} ${item.source} => ${item.candidate}`);
    console.log(`  title=${item.breakdown.titleScore.toFixed(2)} artist=${item.breakdown.artistScore.toFixed(2)} durationPenalty=${item.breakdown.durationPenalty.toFixed(2)} variantPenalty=${item.breakdown.variantPenalty.toFixed(2)}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
