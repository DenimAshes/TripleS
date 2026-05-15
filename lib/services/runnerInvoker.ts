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

export type BrowserRunnerService = "youtube" | "soundcloud";

export function browserRunnerMode(service: BrowserRunnerService): "cli" {
  const configured = process.env[`${service.toUpperCase()}_ADAPTER_MODE`] || process.env.WORKER_ADAPTER_MODE || "cli";
  if (configured !== "cli") {
    console.warn(`[runner-invoker] Unsupported ${service} adapter mode "${configured}", falling back to cli`);
  }
  return "cli";
}

export async function invokeYouTubeListPlaylists(): Promise<NormalizedPlaylist[]> {
  browserRunnerMode("youtube");
  const playlists = await listYouTubePlaylistsCli();
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
  return listYouTubePlaylistTracksCli(playlistId);
}

export async function invokeYouTubeSearchTracks(query: string): Promise<NormalizedTrack[]> {
  browserRunnerMode("youtube");
  return searchYouTubeTracksCli(query);
}

export async function invokeYouTubeAddTrack(playlistId: string, query: string): Promise<void> {
  browserRunnerMode("youtube");
  await addFirstSearchResultToPlaylistCli(playlistId, query);
}

export async function invokeYouTubeRemoveTrack(playlistId: string, trackText: string): Promise<void> {
  browserRunnerMode("youtube");
  await removeTrackFromPlaylistCli(playlistId, trackText);
}

export async function invokeSoundCloudListPlaylists(): Promise<NormalizedPlaylist[]> {
  browserRunnerMode("soundcloud");
  const playlists = await listSoundCloudPlaylistsCli();
  return playlists.map(soundCloudPlaylistToNormalized);
}

export async function invokeSoundCloudCreatePlaylist(name: string): Promise<NormalizedPlaylist> {
  browserRunnerMode("soundcloud");
  return soundCloudPlaylistToNormalized(await createSoundCloudPlaylistCli(name));
}

export async function invokeSoundCloudListPlaylistTracks(playlistId: string): Promise<NormalizedTrack[]> {
  browserRunnerMode("soundcloud");
  return listSoundCloudPlaylistTracksCli(playlistId);
}

export async function invokeSoundCloudSearchTracks(query: string): Promise<NormalizedTrack[]> {
  browserRunnerMode("soundcloud");
  return searchSoundCloudTracksCli(query);
}

export async function invokeSoundCloudAddTrack(playlistId: string, trackId: string): Promise<void> {
  browserRunnerMode("soundcloud");
  await addSoundCloudTrackToPlaylistCli(playlistId, trackId);
}

export async function invokeSoundCloudRemoveTrack(playlistId: string, trackId: string): Promise<void> {
  browserRunnerMode("soundcloud");
  await removeSoundCloudTrackFromPlaylistCli(playlistId, trackId);
}

export async function invokeSoundCloudDeletePlaylist(playlistId: string): Promise<{ deleted: boolean }> {
  browserRunnerMode("soundcloud");
  return deleteSoundCloudPlaylistCli(playlistId);
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
