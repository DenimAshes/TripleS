"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type ManualMatchLock = {
  locked: boolean;
  acquire: () => boolean;
  release: () => void;
};

const ManualMatchLockContext = createContext<ManualMatchLock | null>(null);

export function ManualMatchLockProvider({ children }: { children: ReactNode }) {
  const lockedRef = useRef(false);
  const [locked, setLocked] = useState(false);
  const acquire = useCallback(() => {
    if (lockedRef.current) return false;
    lockedRef.current = true;
    setLocked(true);
    return true;
  }, []);
  const release = useCallback(() => {
    lockedRef.current = false;
    setLocked(false);
  }, []);
  const value = useMemo(() => ({ locked, acquire, release }), [locked, acquire, release]);
  return <ManualMatchLockContext.Provider value={value}>{children}</ManualMatchLockContext.Provider>;
}

export function useManualMatchLock() {
  const lock = useContext(ManualMatchLockContext);
  if (!lock) throw new Error("Manual match actions must be inside ManualMatchLockProvider.");
  return lock;
}
