import type { NormalizedTrack } from "@/lib/sync/syncTypes";
import { runBrowserRunnerCli } from "../browserRunnerCli";
import { classifyError, isHardBlockError, isRetryableError, recommendedActionForFailure } from "@/lib/sync/failureClassifier";
import { setServiceCooldown } from "@/lib/sync/serviceCooldown";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("triples:soundcloud-cli");

const MAX_RETRIES = Math.max(0, Number(process.env.SOUNDCLOUD_CLI_MAX_RETRIES ?? 0));
const RETRY_BASE_MS = Math.max(0, Number(process.env.SOUNDCLOUD_CLI_RETRY_BASE_MS ?? 5_000));
const RETRY_MAX_MS = Math.max(RETRY_BASE_MS, Number(process.env.SOUNDCLOUD_CLI_RETRY_MAX_MS ?? 30_000));

function backoffMs(attempt: number): number {
  const exp = RETRY_BASE_MS * 2 ** attempt;
  const jitter = Math.floor(Math.random() * RETRY_BASE_MS);
  return Math.min(RETRY_MAX_MS, exp) + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type SoundCloudPlaylist = {
  id: string;
  name: string;
  trackCount: number;
  imageUrl?: string;
  url: string;
  isWritable?: boolean;
  apiId?: string;
  permalink?: string;
};

function runnerTimeoutMs(): number {
  return Math.max(1, Number(process.env.SOUNDCLOUD_CLI_TIMEOUT_MS ?? 600_000));
}

async function runSoundCloud(args: string[]) {
  const timeoutMs = runnerTimeoutMs();
  let lastError: unknown = null;
  const command = args[0] || "unknown";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await runBrowserRunnerCli({
        serviceName: "SoundCloud",
        script: "worker/runners/soundcloud.ts",
        args,
        timeoutMs,
      });
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : "SoundCloud browser runner failed";
      const kind = classifyError(error);
      log.warn("retry attempt", {
        attempt: attempt + 1,
        max: MAX_RETRIES + 1,
        kind,
        command: args[0],
        message: message.slice(0, 200),
      });

      if (/captcha-delivery|SoundCloud API 403/i.test(message)) {
        const reason = `SoundCloud ${command} blocked by captcha/403`;
        await setServiceCooldown("soundcloud", reason).catch(() => {});
        throw new Error(
          `${reason}. ${recommendedActionForFailure(error)}`,
        );
      }

      if (isHardBlockError(error)) {
        const reason = `SoundCloud ${command} hard-block (${kind})`;
        await setServiceCooldown("soundcloud", `${reason}: ${message.slice(0, 200)}`).catch(() => {});
        throw new Error(`${reason}. ${recommendedActionForFailure(error)} Original error: ${message}`);
      }

      if (isRetryableError(error) && attempt < MAX_RETRIES) {
        const wait = backoffMs(attempt);
        log.info("retrying", { delayMs: wait, kind });
        await sleep(wait);
        continue;
      }

      if (kind === "timeout") {
        await setServiceCooldown("soundcloud", `SoundCloud ${command} timed out repeatedly after ${timeoutMs}ms`).catch(() => {});
        throw new Error(`SoundCloud browser runner (${command}) timed out after ${timeoutMs}ms. ${recommendedActionForFailure(error)}`);
      }
      throw error instanceof Error ? error : new Error(message);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("SoundCloud browser runner failed");
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
  const encoded = Buffer.from(name, "utf8").toString("base64");
  return parseJsonObject<SoundCloudPlaylist>(await runSoundCloud(["create-b64", encoded]));
}

export async function removeSoundCloudTrackFromPlaylistCli(playlistId: string, trackId: string): Promise<{ removed: boolean }> {
  return parseJsonObject<{ removed: boolean }>(await runSoundCloud(["remove", playlistId, trackId]));
}

export async function deleteSoundCloudPlaylistCli(playlistId: string): Promise<{ deleted: boolean }> {
  return parseJsonObject<{ deleted: boolean }>(await runSoundCloud(["delete", playlistId]));
}
