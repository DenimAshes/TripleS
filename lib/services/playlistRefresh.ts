import { prisma } from "@/lib/db/prisma";
import { getAdapter, serviceEnum } from "./adapterFactory";
import { classifyError } from "@/lib/sync/failureClassifier";
import type { ServiceKey } from "@/lib/sync/syncTypes";

export async function refreshServicePlaylists(userId: string, service: ServiceKey) {
  const serviceName = serviceEnum(service);
  const usesYouTubeBrowser = service === "youtube" && process.env.YOUTUBE_BROWSER_AUTOMATION === "true";
  const usesSoundCloudBrowser = service === "soundcloud" && process.env.SOUNDCLOUD_BROWSER_AUTOMATION === "true";
  const usesBrowser = usesYouTubeBrowser || usesSoundCloudBrowser;
  let account = await prisma.connectedAccount.findUnique({
    where: { userId_service: { userId, service: serviceName } },
  });

  if (!account && usesBrowser) {
    account = await prisma.connectedAccount.create({
      data: {
        userId,
        service: serviceName,
        accessTokenEncrypted: "browser-session",
        refreshTokenEncrypted: "browser-session",
        expiresAt: new Date(Date.now() + 24 * 3600_000),
        serviceUserId: usesYouTubeBrowser ? "youtube_browser_user" : "soundcloud_browser_user",
        serviceUsername: usesYouTubeBrowser ? "YouTube Music" : "SoundCloud",
        isMock: false,
        connectionStatus: "CONNECTED",
        lastError: null,
      },
    });
  }

  // Spotify uses the sp_dc web cookie instead of OAuth. If the cookie is
  // saved we must let the adapter run even if the row is still flagged as
  // mock from earlier — the early-return below would otherwise lock the
  // user into mock mode forever the first time they pasted a cookie
  // before the isMock-flip fix shipped.
  const hasSpotifyCookie = service === "spotify" && Boolean(account?.webCookieEncrypted);

  if (!account || (account.isMock && !usesBrowser && !hasSpotifyCookie)) {
    return 0;
  }

  const adapter = getAdapter(service, userId);
  let items;
  try {
    items = await adapter.getPlaylists();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Distinguish "session expired / not signed in" from other adapter
    // failures so the UI can offer a re-login flow instead of a vague
    // "LIMITED" badge that the user can't act on.
    const status = classifyError(error) === "auth" ? "NEEDS_LOGIN" : "LIMITED";
    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: { connectionStatus: status, lastError: message },
    });
    throw error;
  }

  for (const item of items) {
    // Note: we deliberately do not touch `hidden` on update. The user (or a
    // backfill migration) sets it manually, and a refresh shouldn't undo
    // their decision to keep an upstream playlist out of the picker.
    await prisma.playlist.upsert({
      where: { service_servicePlaylistId: { service: serviceName, servicePlaylistId: item.id } },
      update: {
        userId,
        name: item.name,
        description: item.description,
        imageUrl: item.imageUrl,
        trackCount: item.trackCount,
        isWritable: item.isWritable,
        apiId: item.apiId ?? null,
        permalink: item.permalink ?? null,
        lastFetchedAt: new Date(),
      },
      create: {
        userId,
        service: serviceName,
        servicePlaylistId: item.id,
        apiId: item.apiId ?? null,
        permalink: item.permalink ?? null,
        name: item.name,
        description: item.description,
        imageUrl: item.imageUrl,
        trackCount: item.trackCount,
        isWritable: item.isWritable,
        lastFetchedAt: new Date(),
      },
    });
  }

  // Drop cached rows that the service no longer reports as ours. After
  // tightening the YT/SC adapters to return only owned playlists, this
  // sweep is what actually removes "saved playlists I just liked" and
  // similar non-owned entries that leaked into the cache earlier.
  //
  // Important guard: never delete a Playlist row that is still part of a
  // PlaylistGroup — that would silently break the user's sync rules. If
  // a connected playlist disappears from the upstream service, we leave
  // the row in place and let the user resolve the rule manually.
  const referencedSyncDestinationIds = await prisma.syncDestination.findMany({
    where: { service: serviceName },
    select: { playlistId: true },
  });
  const protectedPlaylistIds = new Set(referencedSyncDestinationIds.map((destination) => destination.playlistId));

  await prisma.playlist.deleteMany({
    where: {
      userId,
      service: serviceName,
      servicePlaylistId: { notIn: [...items.map((item) => item.id), ...protectedPlaylistIds] },
      groupMembers: { none: {} },
    },
  });

  // Reaching this point means a real upstream fetch succeeded, so the row
  // is definitively not mock. Heal isMock for everyone (browser services
  // AND Spotify cookie mode) — the previous version only cleared the flag
  // for browser services, leaving Spotify cookie users stuck in mock mode
  // forever after their first successful refresh.
  if (account.isMock || account.connectionStatus !== "CONNECTED" || account.lastError) {
    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: {
        serviceUserId: usesYouTubeBrowser ? "youtube_browser_user" : usesSoundCloudBrowser ? "soundcloud_browser_user" : account.serviceUserId,
        serviceUsername: usesYouTubeBrowser ? "YouTube Music" : usesSoundCloudBrowser ? "SoundCloud" : account.serviceUsername,
        isMock: false,
        connectionStatus: "CONNECTED",
        lastError: null,
      },
    });
  }

  return items.length;
}

export async function refreshAllPlaylists(userId: string) {
  const result: Record<ServiceKey, number> = {
    spotify: 0,
    youtube: 0,
    soundcloud: 0,
  };

  const services: ServiceKey[] = ["spotify", "youtube", "soundcloud"];
  const settled = await Promise.allSettled(services.map((service) => refreshServicePlaylists(userId, service)));

  for (const [index, item] of settled.entries()) {
    const service = services[index];
    if (item.status === "fulfilled") {
      result[service] = item.value;
    } else {
      result[service] = 0;
    }
  }

  return result;
}
