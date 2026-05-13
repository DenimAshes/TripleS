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

const translit: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
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
  return value
    .toLowerCase()
    .replace(/[а-яёьъ]/g, (char) => translit[char] ?? char)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
