import { afterEach, describe, expect, it, vi } from "vitest";
import { pollBrowserJob } from "@/components/browserJobClient";

describe("pollBrowserJob", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stops polling when its caller aborts", async () => {
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const controller = new AbortController();

    const polling = pollBrowserJob("job-1", () => {}, controller.signal);
    controller.abort();

    await expect(polling).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("closes an active event stream when its caller aborts", async () => {
    class FakeEventSource {
      static instance: FakeEventSource | null = null;
      closed = false;

      constructor() {
        FakeEventSource.instance = this;
      }

      addEventListener() {}

      close() {
        this.closed = true;
      }
    }

    vi.stubGlobal("window", {
      EventSource: FakeEventSource,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    vi.stubGlobal("EventSource", FakeEventSource);
    const controller = new AbortController();

    const streaming = pollBrowserJob("job-2", () => {}, controller.signal);
    controller.abort();

    await expect(streaming).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeEventSource.instance?.closed).toBe(true);
  });
});
