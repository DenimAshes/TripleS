import type { NormalizedTrack } from "@/lib/sync/syncTypes";
import {
  extractVariantTag,
  normalizeArtist,
  normalizeTitle,
  normalizedArtistSet,
  stripLeadingArtist,
  transliterateCyrillic,
} from "./normalizeTrack";

function bigramCounts(value: string): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < value.length - 1; i++) {
    const gram = value.slice(i, i + 2);
    out.set(gram, (out.get(gram) || 0) + 1);
  }
  return out;
}

function diceFromCounts(a: string, b: string, gramsA: Map<string, number>) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map(gramsA);
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

function dice(a: string, b: string) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  return diceFromCounts(a, b, bigramCounts(a));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > 32) return Math.max(a.length, b.length);
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function levenshteinScore(a: string, b: string) {
  const max = Math.max(a.length, b.length);
  if (!max) return 0;
  return 1 - levenshtein(a, b) / max;
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

function textScore(a: string, b: string) {
  if (!a || !b) return 0;
  const translitA = transliterateCyrillic(a);
  const translitB = transliterateCyrillic(b);
  const diceScore = Math.max(dice(a, b), dice(translitA, translitB));
  const tokScore = Math.max(tokenScore(a, b), tokenScore(translitA, translitB));
  const levScore = Math.max(levenshteinScore(a, b), levenshteinScore(translitA, translitB));
  const levAllowed = diceScore >= 0.3 || tokScore >= 0.5;
  return Math.max(diceScore, tokScore, levAllowed ? levScore : 0);
}

function setOverlap(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let hits = 0;
  for (const token of a) if (b.has(token)) hits += 1;
  return hits / Math.min(a.size, b.size);
}

function fuzzyArtistOverlap(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  const largerArr = Array.from(larger);
  let hits = 0;
  for (const left of smaller) {
    if (larger.has(left)) {
      hits += 1;
      continue;
    }
    const leftGrams = left.length >= 2 ? bigramCounts(left) : null;
    let matched = false;
    for (const right of largerArr) {
      if (Math.abs(left.length - right.length) > Math.max(left.length, right.length) * 0.4) continue;
      const diceScore = leftGrams && right.length >= 2 ? diceFromCounts(left, right, leftGrams) : 0;
      if (diceScore >= 0.85 || levenshteinScore(left, right) >= 0.85) {
        matched = true;
        break;
      }
    }
    if (matched) hits += 1;
  }
  return hits / smaller.size;
}

export type SimilarityBreakdown = {
  score: number;
  titleScore: number;
  artistScore: number;
  primaryArtistScore: number;
  artistOverlap: number;
  durationScore: number;
  albumScore: number;
  variantPenalty: number;
  durationPenalty: number;
  exactTitleArtistBoost: number;
  strongTitleArtistBoost: number;
  titleA: string;
  titleB: string;
  artistA: string;
  artistB: string;
};

function durationScore(a?: number, b?: number) {
  if (!a || !b) return { score: 0, penalty: 0 };
  const rawDiff = b - a;
  const diff = Math.abs(rawDiff);
  const longerTarget = rawDiff > 0;
  if (diff <= 3_000) return { score: 1, penalty: 0 };
  const toleratedDiff = longerTarget ? diff * 0.65 : diff;
  if (toleratedDiff <= 20_000) return { score: 1 - (toleratedDiff - 3_000) / 17_000, penalty: 0 };
  if (toleratedDiff <= 45_000) return { score: 0, penalty: 0.18 };
  if (toleratedDiff <= 90_000) return { score: 0, penalty: 0.3 };
  return { score: 0, penalty: 0.45 };
}

function explicitness(title: string) {
  const lower = title.toLowerCase();
  if (/\bclean\b|\bradio\s+edit\b/.test(lower)) return "clean";
  if (/\bexplicit\b|\bdirty\b|\buncensored\b/.test(lower)) return "explicit";
  return undefined;
}

function variantPenalty(a: NormalizedTrack, b: NormalizedTrack) {
  const va = extractVariantTag(a.title);
  const vb = extractVariantTag(b.title);
  const ea = explicitness(a.title);
  const eb = explicitness(b.title);
  if (ea && eb && ea !== eb) return 0.12;
  if (!va && !vb) return 0;
  if (va === vb) return 0;
  if (!va || !vb) return 0.18;
  return 0.28;
}

export function calculateSimilarityWithBreakdown(a: NormalizedTrack, b: NormalizedTrack): SimilarityBreakdown {
  if (a.isrc && b.isrc && a.isrc === b.isrc) {
    return {
      score: 1,
      titleScore: 1,
      artistScore: 1,
      primaryArtistScore: 1,
      artistOverlap: 1,
      durationScore: 1,
      albumScore: 1,
      variantPenalty: 0,
      durationPenalty: 0,
      exactTitleArtistBoost: 1,
      strongTitleArtistBoost: 1,
      titleA: normalizeTitle(a.title),
      titleB: normalizeTitle(b.title),
      artistA: normalizeArtist(a.artists[0] || ""),
      artistB: normalizeArtist(b.artists[0] || ""),
    };
  }

  const allArtists = [...a.artists, ...b.artists];
  const titleA = normalizeTitle(stripLeadingArtist(a.title, allArtists));
  const titleB = normalizeTitle(stripLeadingArtist(b.title, allArtists));
  const artistA = normalizeArtist(a.artists[0] || "");
  const artistB = normalizeArtist(b.artists[0] || "");
  const artistsA = normalizedArtistSet(a.artists);
  const artistsB = normalizedArtistSet(b.artists);

  const titleScore = textScore(titleA, titleB);
  const primaryArtistScore = textScore(artistA, artistB);
  const artistOverlap = Math.max(
    setOverlap(artistsA, artistsB),
    fuzzyArtistOverlap(artistsA, artistsB),
  );
  const artistScore = Math.max(primaryArtistScore, artistOverlap);
  const { score: durScore, penalty: durPenalty } = durationScore(a.durationMs, b.durationMs);
  const albumScore = a.album && b.album ? dice(normalizeTitle(a.album), normalizeTitle(b.album)) : 0;
  const vPenalty = variantPenalty(a, b);

  const weighted = titleScore * 0.52 + artistScore * 0.26 + durScore * 0.12 + albumScore * 0.10;
  const exactTitleArtistContained = titleA === titleB && titleA.length > 2 && artistOverlap >= 0.6 ? 0.93 : 0;
  const strongTitleArtistContained = titleScore >= 0.92 && artistOverlap >= 0.75 ? 0.9 : 0;

  const raw = Math.max(weighted, exactTitleArtistContained, strongTitleArtistContained) - vPenalty - durPenalty;
  return {
    score: Math.max(0, Math.min(1, raw)),
    titleScore,
    artistScore,
    primaryArtistScore,
    artistOverlap,
    durationScore: durScore,
    albumScore,
    variantPenalty: vPenalty,
    durationPenalty: durPenalty,
    exactTitleArtistBoost: exactTitleArtistContained,
    strongTitleArtistBoost: strongTitleArtistContained,
    titleA,
    titleB,
    artistA,
    artistB,
  };
}

export function calculateSimilarity(a: NormalizedTrack, b: NormalizedTrack) {
  return calculateSimilarityWithBreakdown(a, b).score;
}
