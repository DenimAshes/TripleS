import { AsyncLocalStorage } from "node:async_hooks";

export type ActiveJobContext = {
  jobId: string;
  abortController: AbortController;
};

export class CancelledError extends Error {
  constructor(message = "Operation cancelled") {
    super(message);
    this.name = "CancelledError";
  }
}

const storage = new AsyncLocalStorage<ActiveJobContext>();

export function runInActiveJob<T>(context: ActiveJobContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn);
}

export function getActiveJob(): ActiveJobContext | undefined {
  return storage.getStore();
}

export function getActiveJobAbortSignal(): AbortSignal | undefined {
  return storage.getStore()?.abortController.signal;
}

export function throwIfActiveJobAborted(): void {
  const signal = getActiveJobAbortSignal();
  if (signal?.aborted) throw new CancelledError();
}
