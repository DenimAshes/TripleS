import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { NormalizedTrack } from "@/lib/sync/syncTypes";
import { normalizeArtist, normalizeTitle } from "@/lib/utils/normalizeTrack";

export type YtPlaylist = {
  id: string;
  name: string;
  trackCount: number;
  imageUrl?: string;
};

const execFileAsync = promisify(execFile);

async function runYt(args: string[]) {
  const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  try {
    const { stdout } = await execFileAsync(process.execPath, [tsxCli, "worker/runners/youtube.ts", ...args], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 180_000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    const details = error && typeof error === "object" && "stderr" in error ? String(error.stderr || "") : "";
    const message = error instanceof Error ? error.message : "YouTube browser runner failed";
    throw new Error(details.trim() ? `${message}: ${details.trim()}` : message);
  }
}

function parseJsonArray<T>(stdout: string): T[] {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error(`Could not parse YouTube runner output: ${stdout.slice(0, 500)}`);
  return JSON.parse(stdout.slice(start, end + 1)) as T[];
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

function words(value: string) {
  return value.split(/\s+/).filter((word) => word.length > 2);
}

function isDuplicateTrack(candidate: NormalizedTrack, playlistTrack: NormalizedTrack, query?: string) {
  if (candidate.sourceTrackId && candidate.sourceTrackId === playlistTrack.sourceTrackId) return true;
  if (candidate.isrc && candidate.isrc === playlistTrack.isrc) return true;

  const candidateTitle = normalizeTitle(candidate.title);
  const playlistTitle = normalizeTitle(playlistTrack.title);
  const candidateArtist = normalizeArtist(candidate.artists[0] || "");
  const playlistArtist = normalizeArtist(playlistTrack.artists[0] || "");
  const normalizedQuery = normalizeTitle(query || "");

  if (playlistTitle && candidateTitle.includes(playlistTitle)) return true;
  if (playlistTitle && normalizedQuery.includes(playlistTitle)) return true;
  if (playlistTitle && words(playlistTitle).length >= 2 && words(playlistTitle).every((word) => normalizedQuery.includes(word))) return true;

  return Boolean(candidateTitle && playlistTitle && candidateTitle === playlistTitle && candidateArtist && playlistArtist && candidateArtist === playlistArtist);
}

export async function findYouTubeDuplicateInPlaylistCli(playlistId: string, track: NormalizedTrack, query?: string): Promise<NormalizedTrack | null> {
  const playlistTracks = await listYouTubePlaylistTracksCli(playlistId);
  return playlistTracks.find((playlistTrack) => isDuplicateTrack(track, playlistTrack, query)) || null;
}

export async function addFirstSearchResultToPlaylistCli(playlistId: string, query: string): Promise<{ added: boolean; duplicate?: NormalizedTrack }> {
  const candidates = await searchYouTubeTracksCli(query);
  const candidate = candidates[0];
  if (!candidate) throw new Error(`No YouTube Music search result for "${query}"`);

  const duplicate = await findYouTubeDuplicateInPlaylistCli(playlistId, candidate, query);
  if (duplicate) return { added: false, duplicate };

  await runYt(["add", playlistId, query]);
  return { added: true };
}

export async function removeTrackFromPlaylistCli(playlistId: string, trackText: string): Promise<void> {
  await runYt(["remove", playlistId, trackText]);
}
