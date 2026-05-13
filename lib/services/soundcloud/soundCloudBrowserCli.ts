import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { NormalizedTrack } from "@/lib/sync/syncTypes";

export type SoundCloudPlaylist = {
  id: string;
  name: string;
  trackCount: number;
  imageUrl?: string;
  url: string;
  isWritable?: boolean;
};

const execFileAsync = promisify(execFile);

async function runSoundCloud(args: string[]) {
  const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  try {
    const { stdout } = await execFileAsync(process.execPath, [tsxCli, "worker/runners/soundcloud.ts", ...args], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 180_000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    const details = error && typeof error === "object" && "stderr" in error ? String(error.stderr || "") : "";
    const message = error instanceof Error ? error.message : "SoundCloud browser runner failed";
    if (/captcha-delivery|SoundCloud API 403/i.test(details)) {
      throw new Error(
        "SoundCloud blocked the write request with captcha. Reading still works; open SoundCloud in the saved Chrome profile and try again later.",
      );
    }
    throw new Error(details.trim() ? `${message}: ${details.trim()}` : message);
  }
}

function parseJsonArray<T>(stdout: string): T[] {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error(`Could not parse SoundCloud runner output: ${stdout.slice(0, 500)}`);
  return JSON.parse(stdout.slice(start, end + 1)) as T[];
}

export async function listSoundCloudPlaylistsCli(): Promise<SoundCloudPlaylist[]> {
  return parseJsonArray<SoundCloudPlaylist>(await runSoundCloud(["list"]));
}

export async function listSoundCloudPlaylistTracksCli(playlistId: string): Promise<NormalizedTrack[]> {
  return parseJsonArray<NormalizedTrack>(await runSoundCloud(["tracks", playlistId]));
}

export async function searchSoundCloudTracksCli(query: string): Promise<NormalizedTrack[]> {
  return parseJsonArray<NormalizedTrack>(await runSoundCloud(["search", query]));
}

function parseJsonObject<T>(stdout: string): T {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`Could not parse SoundCloud runner output: ${stdout.slice(0, 500)}`);
  return JSON.parse(stdout.slice(start, end + 1)) as T;
}

export async function addSoundCloudTrackToPlaylistCli(playlistId: string, trackId: string): Promise<{ added: boolean }> {
  return parseJsonObject<{ added: boolean }>(await runSoundCloud(["add", playlistId, trackId]));
}

export async function createSoundCloudPlaylistCli(name: string): Promise<SoundCloudPlaylist> {
  return parseJsonObject<SoundCloudPlaylist>(await runSoundCloud(["create", name]));
}

export async function removeSoundCloudTrackFromPlaylistCli(playlistId: string, trackId: string): Promise<{ removed: boolean }> {
  return parseJsonObject<{ removed: boolean }>(await runSoundCloud(["remove", playlistId, trackId]));
}
