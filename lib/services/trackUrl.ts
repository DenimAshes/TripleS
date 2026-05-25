const SERVICE_FROM_HOST: Array<[RegExp, string]> = [
  [/(^|\.)spotify\.com$/i, "SPOTIFY"],
  [/^music\.youtube\.com$/i, "YOUTUBE"],
  [/(^|\.)youtube\.com$/i, "YOUTUBE"],
  [/^youtu\.be$/i, "YOUTUBE"],
  [/(^|\.)soundcloud\.com$/i, "SOUNDCLOUD"],
];

export function serviceFromTrackUrl(url: URL): string | null {
  return SERVICE_FROM_HOST.find(([pattern]) => pattern.test(url.hostname))?.[1] || null;
}

export function trackIdFromUrl(url: URL, service: string): string {
  if (service === "SPOTIFY") {
    const match = url.pathname.match(/\/track\/([^/?#]+)/);
    return match?.[1] || url.toString();
  }
  if (service === "YOUTUBE") {
    return url.searchParams.get("v") || url.pathname.replace(/^\/+/, "") || url.toString();
  }
  return url.pathname.replace(/^\/+|\/+$/g, "") || url.toString();
}

export function parseTrackUrl(rawUrl: unknown, expectedService?: string): { url: URL; service: string; trackId: string } {
  const value = String(rawUrl || "").trim();
  if (!value) {
    throw new Error("Song link is required.");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Paste a valid song link.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Song link must start with http:// or https://.");
  }

  const service = serviceFromTrackUrl(url);
  if (!service) {
    throw new Error("This song link is from an unsupported platform.");
  }
  if (expectedService && service !== expectedService) {
    throw new Error(`Paste a ${expectedService} song link.`);
  }

  return { url, service, trackId: trackIdFromUrl(url, expectedService || service) };
}
