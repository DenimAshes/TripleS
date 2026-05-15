const VARIANT_PATTERNS_ANYWHERE: { tag: string; regex: RegExp }[] = [
  { tag: "remix", regex: /\b(?:[\w'.-]+\s+)?remix\b/i },
  { tag: "edit", regex: /\b(?:[\w'.-]+\s+)?edit\b/i },
  { tag: "mix", regex: /\b(?:club|extended|radio|original|dub|vip|rework)\s*mix\b/i },
  { tag: "version", regex: /\b(?:acoustic|piano|orchestral|instrumental|karaoke|stripped|demo|alternate|extended|radio|clean|explicit|deluxe)\s*(?:version|cut)?\b/i },
  { tag: "live", regex: /\blive\s+(?:at|in|from)\s+[^)\]]+/i },
  { tag: "sped_up", regex: /\b(?:sped\s*up|speed\s*up|spedup)\b/i },
  { tag: "slowed", regex: /\b(?:slowed(?:\s*(?:down|reverb|&\s*reverb))?|reverb)\b/i },
  { tag: "nightcore", regex: /\b(?:anti\s*nightcore|nightcore)\b/i },
  { tag: "8d", regex: /\b8d\s*audio\b/i },
  { tag: "phonk", regex: /\bphonk\s+remix\b/i },
  { tag: "tiktok", regex: /\btik\s*tok\s+edit\b/i },
  { tag: "bass_boost", regex: /\bbass\s*boost(?:ed)?\b/i },
  { tag: "mashup", regex: /\bmashup\b/i },
];

const VARIANT_PATTERNS_BRACKET_ONLY: { tag: string; regex: RegExp }[] = [
  { tag: "live", regex: /\blive\b/i },
  { tag: "cover", regex: /\bcover\b/i },
];

const DECORATIONS_RE = /\b(official|video|audio|lyrics?|lyric|remaster(?:ed)?|visualizer|music|clip|hd|hq|4k|8k|mv|m\/v|topic|free\s*download|out\s*now|premiere)\b/gi;
const TRAILING_VARIANT_RE = /\s*[-–—]\s*[^\-–—()\[\]{}]*\b(sped\s*up|speed\s*up|spedup|slowed(?:\s*(?:down|reverb|&\s*reverb))?|reverb|nightcore|bass\s*boost(?:ed)?|remix|edit|mashup|cover|acoustic|instrumental|karaoke|stripped|demo|extended\s+(?:mix|version|edit)|radio\s+(?:mix|version|edit)|club\s+mix|original\s+mix|dub\s+mix|vip\s+mix|rework|piano\s+version|orchestral\s+version|alternate\s+version)\b[^()\[\]{}]*$/i;
const CREDIT_RE = /\b(prod\.?|produced|by|feat\.?|ft\.?|featuring|with|w\/)\b/gi;
const BRACKETS_RE = /\((?:[^)]*)\)|\[(?:[^\]]*)\]|\{(?:[^}]*)\}/g;
const PUNCT_RE = /[^\p{L}\p{N}\s]/gu;
const WS_RE = /\s+/g;

export function extractVariantTag(title: string): string | undefined {
  const lower = title.toLowerCase();
  const bracketBodies = Array.from(lower.matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)).map(
    (m) => m[1] || m[2] || "",
  );
  const tags = new Set<string>();
  for (const { tag, regex } of VARIANT_PATTERNS_ANYWHERE) {
    if (regex.test(lower)) tags.add(tag);
  }
  for (const body of bracketBodies) {
    for (const { tag, regex } of VARIANT_PATTERNS_BRACKET_ONLY) {
      if (regex.test(body)) tags.add(tag);
    }
    for (const { tag, regex } of VARIANT_PATTERNS_ANYWHERE) {
      if (regex.test(body)) tags.add(tag);
    }
  }
  if (!tags.size) return undefined;
  return Array.from(tags).sort().join("+");
}

const LEADING_ARTIST_RE = /^([^-–—|~]+?)\s*(?:[-–—|~]|::)\s*/;

export function stripLeadingArtist(title: string, artists: string[]): string {
  const known = new Set<string>();
  for (const artist of splitArtists(artists)) {
    const norm = normalizeArtist(artist);
    if (norm) known.add(norm);
    const translit = transliterateCyrillic(norm);
    if (translit) known.add(translit);
  }
  let remaining = title;
  while (true) {
    const match = remaining.match(LEADING_ARTIST_RE);
    if (!match) return remaining;
    const prefix = normalizeArtist(match[1]);
    if (!prefix) return remaining;
    const prefixTranslit = transliterateCyrillic(prefix);
    let matched = false;
    for (const candidate of known) {
      if (
        candidate === prefix ||
        candidate === prefixTranslit ||
        prefix.includes(candidate) ||
        candidate.includes(prefix)
      ) {
        matched = true;
        break;
      }
    }
    if (!matched) return remaining;
    remaining = remaining.slice(match[0].length);
  }
}

export function inferArtistTitleFromDecoratedTitle(track: { title: string; artists: string[] }) {
  const match = track.title.match(LEADING_ARTIST_RE);
  if (!match) return null;
  const artist = match[1].trim();
  const title = track.title.slice(match[0].length).trim();
  if (!artist || !title) return null;
  const firstArtist = normalizeArtist(splitArtists(track.artists)[0] || "");
  const prefix = normalizeArtist(artist);
  const canUsePrefix =
    !firstArtist ||
    firstArtist === prefix ||
    /\b(topic|official|records?|music|channel|vevo|youtube)\b/i.test(firstArtist);
  return canUsePrefix ? { artist, title } : null;
}

const TITLE_CACHE = new Map<string, string>();
const ARTIST_CACHE = new Map<string, string>();
const TRANSLIT_CACHE = new Map<string, string>();
const CACHE_MAX = 4096;

function cacheGetSet(cache: Map<string, string>, key: string, compute: () => string): string {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = compute();
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
  return value;
}

export function normalizeTitle(title: string) {
  return cacheGetSet(TITLE_CACHE, title, () =>
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(BRACKETS_RE, " ")
      .replace(TRAILING_VARIANT_RE, " ")
      .replace(DECORATIONS_RE, " ")
      .replace(CREDIT_RE, " ")
      .replace(PUNCT_RE, " ")
      .replace(WS_RE, " ")
      .trim(),
  );
}

const ARTIST_SPLIT_RE = /\s*(?:,|;|\/|\\|&|\bx\b|\bvs\.?\b|\band\b|\bfeat\.?\b|\bft\.?\b|\bwith\b|\bft\b|\bfeaturing\b)\s*/gi;

export function splitArtists(value: string | string[]): string[] {
  const raw = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const entry of raw) {
    if (!entry) continue;
    for (const piece of entry.split(ARTIST_SPLIT_RE)) {
      const trimmed = piece.trim();
      if (trimmed) out.push(trimmed);
    }
  }
  return out;
}

export function normalizeArtist(artist: string) {
  return cacheGetSet(ARTIST_CACHE, artist, () =>
    artist
      .toLowerCase()
      .trim()
      .replace(/^the\s+/, "")
      .replace(PUNCT_RE, " ")
      .replace(WS_RE, " ")
      .trim(),
  );
}

export function normalizedArtistSet(artists: string[]): Set<string> {
  const out = new Set<string>();
  for (const artist of splitArtists(artists)) {
    const norm = normalizeArtist(artist);
    if (norm) out.add(norm);
    const translit = transliterateCyrillic(norm);
    if (translit && translit !== norm) out.add(translit);
  }
  return out;
}

const translit: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  ґ: "g",
  д: "d",
  е: "e",
  є: "ye",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  і: "i",
  ї: "yi",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ы: "y",
  э: "e",
  ю: "yu",
  я: "ya",
  ь: "",
  ъ: "",
};

export function transliterateCyrillic(value: string) {
  return cacheGetSet(TRANSLIT_CACHE, value, () =>
    value
      .toLowerCase()
      .replace(/[а-яёіїєґьъ]/g, (char) => translit[char] ?? char)
      .replace(PUNCT_RE, " ")
      .replace(WS_RE, " ")
      .trim(),
  );
}
