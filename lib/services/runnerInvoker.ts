import type { NormalizedPlaylist, NormalizedTrack } from "@/lib/sync/syncTypes";
import {
  addFirstSearchResultToPlaylistCli,
  listYouTubePlaylistTracksCli,
  listYouTubePlaylistsCli,
  removeTrackFromPlaylistCli,
  searchYouTubeTracksCli,
} from "@/lib/services/youtube/youtubeBrowserCli";
import {
  addSoundCloudTrackToPlaylistCli,
  createSoundCloudPlaylistCli,
  deleteSoundCloudPlaylistCli,
  listSoundCloudPlaylistTracksCli,
  listSoundCloudPlaylistsCli,
  removeSoundCloudTrackFromPlaylistCli,
  searchSoundCloudTracksCli,
  type SoundCloudPlaylist,
} from "@/lib/services/soundcloud/soundCloudBrowserCli";
import { getPersistentRunner } from "@/lib/services/persistentRunnerRegistry";
import type { PersistentRunnerService } from "@/lib/services/persistentRunner";

export type BrowserRunnerService = "youtube" | "soundcloud";

export function browserRunnerMode(service: BrowserRunnerService): "cli" {
  const configured = process.env[`${service.toUpperCase()}_ADAPTER_MODE`] || process.env.WORKER_ADAPTER_MODE || "cli";
  if (configured !== "cli") {
    console.warn(`[runner-invoker] Unsupported ${service} adapter mode "${configured}", falling back to cli`);
  }
  return "cli";
}

// Route through a persistent runner if one has been registered for this
// service (see persistentRunnerRegistry / syncEngine setup). Otherwise fall
// back to the one-shot CLI path. The persistent path skips ~15-20s of
// cloak browser cold start per command.
async function viaPersistent<T>(
  service: PersistentRunnerService,
  command: string,
  args: unknown[],
): Promise<T | undefined> {
  const runner = getPersistentRunner(service);
  if (!runner) return undefined;
  return runner.invoke<T>(command, args);
}

export async function invokeYouTubeListPlaylists(): Promise<NormalizedPlaylist[]> {
  browserRunnerMode("youtube");
  const persistent = await viaPersistent<Array<{ id: string; name: string; imageUrl?: string; trackCount: number }>>(
    "youtube",
    "list",
    [],
  );
  const playlists = persistent ?? (await listYouTubePlaylistsCli());
  return playlists.map((playlist) => ({
    id: playlist.id,
    name: playlist.name,
    imageUrl: playlist.imageUrl,
    trackCount: playlist.trackCount,
    isWritable: true,
  }));
}

export async function invokeYouTubeListPlaylistTracks(playlistId: string): Promise<NormalizedTrack[]> {
  browserRunnerMode("youtube");
  return (await viaPersistent<NormalizedTrack[]>("youtube", "tracks", [playlistId])) ?? listYouTubePlaylistTracksCli(playlistId);
}

export async function invokeYouTubeSearchTracks(query: string): Promise<NormalizedTrack[]> {
  browserRunnerMode("youtube");
  return (await viaPersistent<NormalizedTrack[]>("youtube", "search", [query])) ?? searchYouTubeTracksCli(query);
}

export async function invokeYouTubeAddTrack(playlistId: string, query: string): Promise<void> {
  browserRunnerMode("youtube");
  const persistent = await viaPersistent<unknown>("youtube", "add", [playlistId, query]);
  if (persistent === undefined) await addFirstSearchResultToPlaylistCli(playlistId, query);
}

export async function invokeYouTubeRemoveTrack(playlistId: string, trackText: string): Promise<void> {
  browserRunnerMode("youtube");
  const persistent = await viaPersistent<unknown>("youtube", "remove", [playlistId, trackText]);
  if (persistent === undefined) await removeTrackFromPlaylistCli(playlistId, trackText);
}

export async function invokeSoundCloudListPlaylists(): Promise<NormalizedPlaylist[]> {
  browserRunnerMode("soundcloud");
  const persistent = await viaPersistent<SoundCloudPlaylist[]>("soundcloud", "list", []);
  const playlists = persistent ?? (await listSoundCloudPlaylistsCli());
  return playlists.map(soundCloudPlaylistToNormalized);
}

export async function invokeSoundCloudCreatePlaylist(name: string): Promise<NormalizedPlaylist> {
  browserRunnerMode("soundcloud");
  const persistent = await viaPersistent<SoundCloudPlaylist>("soundcloud", "create", [name]);
  return soundCloudPlaylistToNormalized(persistent ?? (await createSoundCloudPlaylistCli(name)));
}

export async function invokeSoundCloudListPlaylistTracks(playlistId: string): Promise<NormalizedTrack[]> {
  browserRunnerMode("soundcloud");
  return (await viaPersistent<NormalizedTrack[]>("soundcloud", "tracks", [playlistId])) ?? listSoundCloudPlaylistTracksCli(playlistId);
}

export async function invokeSoundCloudSearchTracks(query: string): Promise<NormalizedTrack[]> {
  browserRunnerMode("soundcloud");
  return (await viaPersistent<NormalizedTrack[]>("soundcloud", "search", [query])) ?? searchSoundCloudTracksCli(query);
}

export async function invokeSoundCloudAddTrack(playlistId: string, trackId: string): Promise<void> {
  browserRunnerMode("soundcloud");
  const persistent = await viaPersistent<unknown>("soundcloud", "add", [playlistId, trackId]);
  if (persistent === undefined) await addSoundCloudTrackToPlaylistCli(playlistId, trackId);
}

export async function invokeSoundCloudRemoveTrack(playlistId: string, trackId: string): Promise<void> {
  browserRunnerMode("soundcloud");
  const persistent = await viaPersistent<unknown>("soundcloud", "remove", [playlistId, trackId]);
  if (persistent === undefined) await removeSoundCloudTrackFromPlaylistCli(playlistId, trackId);
}

export async function invokeSoundCloudDeletePlaylist(playlistId: string): Promise<{ deleted: boolean }> {
  browserRunnerMode("soundcloud");
  return (await viaPersistent<{ deleted: boolean }>("soundcloud", "delete", [playlistId])) ?? deleteSoundCloudPlaylistCli(playlistId);
}

function soundCloudPlaylistToNormalized(playlist: SoundCloudPlaylist): NormalizedPlaylist {
  return {
    id: playlist.id,
    name: playlist.name,
    imageUrl: playlist.imageUrl,
    trackCount: playlist.trackCount,
    isWritable: playlist.isWritable === true,
    apiId: playlist.apiId,
    permalink: playlist.permalink,
  };
}
