/**
 * Matching stored SoundCloud playlist ids against the account's current
 * playlists. A stored id looks like `user/sets/slug` or, for private sets,
 * `user/sets/slug/s-secretToken`. Renaming the account changes the `user`
 * segment on every stored id, and `/resolve` then 404s — which used to read as
 * "the playlist is gone" and triggered a pointless re-create. The slug and the
 * secret token survive a rename, so match on those instead.
 */

export type SoundCloudPlaylistRef = {
  user?: string;
  slug?: string;
  secret?: string;
};

export function soundCloudPathFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).pathname.replace(/^\/+|\/+$/g, "");
  } catch {
    return undefined;
  }
}

/** `user/sets/slug/s-token` -> `{ user, slug, secret }` */
export function parsePlaylistRef(pathOrUrl?: string): SoundCloudPlaylistRef {
  if (!pathOrUrl) return {};
  const path = pathOrUrl.startsWith("http") ? soundCloudPathFromUrl(pathOrUrl) : pathOrUrl.replace(/^\/+|\/+$/g, "");
  if (!path) return {};

  const segments = path.split("/").filter(Boolean);
  const setsIndex = segments.indexOf("sets");
  if (setsIndex < 0) return { user: segments[0] };

  const secretSegment = segments.find((segment) => segment.startsWith("s-"));
  return {
    user: segments[0],
    slug: segments[setsIndex + 1],
    secret: secretSegment ? secretSegment.slice(2) : undefined,
  };
}

/**
 * True when both refs point at the same playlist. The account handle is
 * deliberately ignored: it is the one part that a rename changes. Secret tokens
 * must agree when both sides carry one, so two same-slug private sets can never
 * be confused.
 */
export function playlistRefsMatch(a: SoundCloudPlaylistRef, b: SoundCloudPlaylistRef): boolean {
  if (!a.slug || !b.slug) return false;
  if (a.slug !== b.slug) return false;
  if (a.secret && b.secret) return a.secret === b.secret;
  return true;
}

export function playlistPathsMatch(storedIdOrUrl?: string, candidateUrl?: string): boolean {
  return playlistRefsMatch(parsePlaylistRef(storedIdOrUrl), parsePlaylistRef(candidateUrl));
}
