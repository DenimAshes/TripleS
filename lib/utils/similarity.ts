import type { NormalizedTrack } from "@/lib/sync/syncTypes";
import { normalizeArtist, normalizeTitle } from "./normalizeTrack";

function dice(a: string, b: string) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const gram = a.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) || 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const gram = b.slice(i, i + 2);
    const count = grams.get(gram) || 0;
    if (count > 0) {
      grams.set(gram, count - 1);
      hits++;
    }
  }
  return (2 * hits) / (a.length + b.length - 2);
}

function tokenScore(a: string, b: string) {
  const left = new Set(a.split(/\s+/).filter(Boolean));
  const right = new Set(b.split(/\s+/).filter(Boolean));
  if (!left.size || !right.size) return 0;
  let hits = 0;
  for (const token of left) {
    if (right.has(token)) hits += 1;
  }
  return hits / Math.max(left.size, right.size);
}

export function calculateSimilarity(a: NormalizedTrack, b: NormalizedTrack) {
  if (a.isrc && b.isrc && a.isrc === b.isrc) return 1;

  const titleA = normalizeTitle(a.title);
  const titleB = normalizeTitle(b.title);
  const artistA = normalizeArtist(a.artists[0] || "");
  const artistB = normalizeArtist(b.artists[0] || "");
  const titleScore = Math.max(dice(titleA, titleB), tokenScore(titleA, titleB));
  const artistScore = Math.max(dice(artistA, artistB), tokenScore(artistA, artistB));
  const durationDiff = a.durationMs && b.durationMs ? Math.abs(a.durationMs - b.durationMs) : 999999;
  const durationScore = durationDiff <= 20_000 ? Math.max(0, 1 - durationDiff / 20_000) : 0;
  const albumScore = a.album && b.album ? dice(normalizeTitle(a.album), normalizeTitle(b.album)) : 0;
  const weighted = titleScore * 0.58 + artistScore * 0.24 + durationScore * 0.14 + albumScore * 0.04;
  return Math.max(0, Math.min(1, weighted));
}
