import { afterEach, describe, expect, test, vi } from "vitest";
import { browserRunnerMode } from "../lib/services/runnerInvoker";

describe("runnerInvoker", () => {
  afterEach(() => {
    delete process.env.WORKER_ADAPTER_MODE;
    delete process.env.YOUTUBE_ADAPTER_MODE;
    vi.restoreAllMocks();
  });

  test("defaults browser runner adapters to cli mode", () => {
    expect(browserRunnerMode("youtube")).toBe("cli");
  });

  test("falls back to cli for unsupported adapter modes", () => {
    process.env.YOUTUBE_ADAPTER_MODE = "direct";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(browserRunnerMode("youtube")).toBe("cli");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("falling back to cli"));
  });
});
