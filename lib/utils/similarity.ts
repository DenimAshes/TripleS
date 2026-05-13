import type { NormalizedTrack } from "@/lib/sync/syncTypes";
import { normalizeArtist, normalizeTitle, transliterateCyrillic } from "./normalizeTrack";

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

function containmentTokenScore(a: string, b: string) {
  const left = new Set(a.split(/\s+/).filter((word) => word.length > 1));
  const right = new Set(b.split(/\s+/).filter((word) => word.length > 1));
  const smaller = left.size <= right.size ? left : right;
  const larger = left.size <= right.size ? right : left;
  if (!smaller.size || !larger.size) return 0;
  let hits = 0;
  for (const token of smaller) {
    if (larger.has(token)) hits += 1;
  }
  return hits / smaller.size;
}

function textScore(a: string, b: string) {
  return Math.max(
    dice(a, b),
    tokenScore(a, b),
    dice(transliterateCyrillic(a), transliterateCyrillic(b)),
    tokenScore(transliterateCyrillic(a), transliterateCyrillic(b)),
  );
}

function artistOverlapScore(a: string, b: string) {
  const translitA = transliterateCyrillic(a);
  const translitB = transliterateCyrillic(b);
  return Math.max(
    tokenScore(a, b),
    containmentTokenScore(a, b),
    tokenScore(translitA, translitB),
    containmentTokenScore(translitA, translitB),
  );
}

export function calculateSimilarity(a: NormalizedTrack, b: NormalizedTrack) {
  if (a.isrc && b.isrc && a.isrc === b.isrc) return 1;

  const titleA = normalizeTitle(a.title);
  const titleB = normalizeTitle(b.title);
  const artistA = normalizeArtist(a.artists[0] || "");
  const artistB = normalizeArtist(b.artists[0] || "");
  const titleScore = textScore(titleA, titleB);
  const artistScore = textScore(artistA, artistB);
  const artistOverlap = artistOverlapScore(artistA, artistB);
  const durationDiff = a.durationMs && b.durationMs ? Math.abs(a.durationMs - b.durationMs) : 999999;
  const durationScore = durationDiff <= 20_000 ? Math.max(0, 1 - durationDiff / 20_000) : 0;
  const albumScore = a.album && b.album ? dice(normalizeTitle(a.album), normalizeTitle(b.album)) : 0;
  const weighted = titleScore * 0.58 + artistScore * 0.24 + durationScore * 0.14 + albumScore * 0.04;
  const exactTitleArtistContained = titleA === titleB && titleA.length > 2 && artistOverlap >= 0.6 ? 0.93 : 0;
  const strongTitleArtistContained = titleScore >= 0.92 && artistOverlap >= 0.75 ? 0.9 : 0;
  return Math.max(0, Math.min(1, Math.max(weighted, exactTitleArtistContained, strongTitleArtistContained)));
}
