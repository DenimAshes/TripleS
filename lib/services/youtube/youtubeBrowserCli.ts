import type { NormalizedTrack } from "@/lib/sync/syncTypes";
import { runBrowserRunnerCli } from "../browserRunnerCli";
import { isDuplicateYouTubeTrack } from "./youtubeDuplicate";

export type YtPlaylist = {
  id: string;
  name: string;
  trackCount: number;
  imageUrl?: string;
};

function runnerTimeoutMs(): number {
  return Math.max(1, Number(process.env.YOUTUBE_CLI_TIMEOUT_MS ?? 600_000));
}

async function runYt(args: string[]) {
  const timeoutMs = runnerTimeoutMs();
  try {
    return await runBrowserRunnerCli({
      serviceName: "YouTube",
      script: "worker/runners/youtube.ts",
      args,
      timeoutMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "YouTube browser runner failed";
    if (/timed out|ETIMEDOUT|SIGTERM|killed/i.test(message)) {
      throw new Error(`YouTube browser runner timed out after ${timeoutMs}ms`);
    }
    throw new Error(message);
  }
}

function parseJsonArray<T>(stdout: string): T[] {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error(`Could not parse YouTube runner output: ${stdout.slice(0, 500)}`);
  return JSON.parse(stdout.slice(start, end + 1)) as T[];
}

function parseJsonObject<T>(stdout: string): T {
  for (const line of stdout.split(/\r?\n/).reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
    try {
      return JSON.parse(trimmed) as T;
    } catch {}
  }
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`Could not parse YouTube runner output: ${stdout.slice(0, 500)}`);
  return JSON.parse(stdout.slice(start, end + 1)) as T;
}

export async function listYouTubePlaylistsCli(): Promise<YtPlaylist[]> {
  return parseJsonArray<YtPlaylist>(await runYt(["list"]));
}

export async function listYouTubePlaylistTracksCli(playlistId: string): Promise<NormalizedTrack[]> {
  return parseJsonArray<NormalizedTrack>(await runYt(["tracks", playlistId]));
}

export async function searchYouTubeTracksCli(query: string): Promise<NormalizedTrack[]> {
  return parseJsonArray<NormalizedTrack>(await runYt(["search", query]));
}

export async function createYouTubePlaylistCli(name: string, description?: string): Promise<YtPlaylist> {
  const encoded = Buffer.from(JSON.stringify({ name, description }), "utf8").toString("base64");
  return parseJsonObject<YtPlaylist>(await runYt(["create-b64", encoded]));
}

export async function deleteYouTubePlaylistCli(playlistId: string): Promise<{ deleted: boolean }> {
  return parseJsonObject<{ deleted: boolean }>(await runYt(["delete", playlistId]));
}

export async function findYouTubeDuplicateInPlaylistCli(playlistId: string, track: NormalizedTrack, query?: string): Promise<NormalizedTrack | null> {
  const playlistTracks = await listYouTubePlaylistTracksCli(playlistId);
  return playlistTracks.find((playlistTrack) => isDuplicateYouTubeTrack(track, playlistTrack, query)) || null;
}

export async function addFirstSearchResultToPlaylistCli(playlistId: string, query: string): Promise<{ added: boolean; duplicate?: NormalizedTrack }> {
  const candidates = await searchYouTubeTracksCli(query);
  const candidate = candidates[0];
  if (!candidate) throw new Error(`No YouTube Music search result for "${query}"`);

  const duplicate = await findYouTubeDuplicateInPlaylistCli(playlistId, candidate, query);
  if (duplicate) return { added: false, duplicate };

  return parseJsonObject<{ added: boolean; duplicate?: NormalizedTrack }>(await runYt(["add", playlistId, query]));
}

export async function removeTrackFromPlaylistCli(playlistId: string, trackText: string): Promise<void> {
  await runYt(["remove", playlistId, trackText]);
}
