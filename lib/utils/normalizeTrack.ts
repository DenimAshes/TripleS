export function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\b(official|video|audio|lyrics?|lyric|remaster(?:ed)?|live|visualizer|music|clip|hd|4k)\b/gi, " ")
    .replace(/\b(sped\s*up|speed\s*up|slowed|reverb|nightcore|bass\s*boost(?:ed)?|remix|edit|version)\b/gi, " ")
    .replace(/\b(prod\.?|by|feat\.?|ft\.?|with|w\/)\b/gi, " ")
    .replace(/\((?:[^)]*)\)|\[(?:[^\]]*)\]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeArtist(artist: string) {
  return artist
    .toLowerCase()
    .trim()
    .replace(/^the\s+/, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
