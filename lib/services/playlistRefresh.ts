import { prisma } from "@/lib/db/prisma";
import { getAdapter, serviceEnum } from "./adapterFactory";
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

  if (!account || (account.isMock && !usesBrowser)) {
    return 0;
  }

  const adapter = getAdapter(service, userId);
  let items;
  try {
    items = await adapter.getPlaylists();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: { connectionStatus: "LIMITED", lastError: message },
    });
    throw error;
  }

  for (const item of items) {
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

  await prisma.playlist.deleteMany({
    where: {
      userId,
      service: serviceName,
      servicePlaylistId: { notIn: items.map((item) => item.id) },
    },
  });
  await prisma.playlist.deleteMany({
    where: {
      userId,
      service: service,
    },
  });

  if (account.isMock || account.connectionStatus !== "CONNECTED" || account.lastError) {
    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: {
        serviceUserId: usesYouTubeBrowser ? "youtube_browser_user" : usesSoundCloudBrowser ? "soundcloud_browser_user" : account.serviceUserId,
        serviceUsername: usesYouTubeBrowser ? "YouTube Music" : usesSoundCloudBrowser ? "SoundCloud" : account.serviceUsername,
        isMock: usesBrowser ? false : account.isMock,
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
