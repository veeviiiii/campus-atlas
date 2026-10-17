"use client";

// Small localStorage-backed store shared by every part of the page (planet explorer, study tools),
// so studying a topic in one place clears its fog everywhere. Values live only on this device.

import { useCallback, useMemo, useSyncExternalStore } from "react";

const cache = new Map<string, unknown>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key) cache.delete(e.key);
    listener();
  };
  addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    removeEventListener("storage", onStorage);
  };
}

export function readLocal<T>(key: string, fallback: T): T {
  if (!cache.has(key)) {
    let value = fallback;
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) value = JSON.parse(raw) as T;
    } catch {}
    cache.set(key, value);
  }
  return cache.get(key) as T;
}

export function writeLocal<T>(key: string, value: T | null): void {
  if (value === null) {
    cache.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {}
  } else {
    cache.set(key, value);
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }
  listeners.forEach((l) => l());
}

/** A stored value plus its setter. `fallback` must be a stable (module-level) value. */
export function useLocal<T>(key: string, fallback: T): [T, (value: T) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readLocal(key, fallback),
    () => fallback,
  );
  const set = useCallback((v: T) => writeLocal(key, v), [key]);
  return [value, set];
}

// ---- studied topics (same key the planet explorer has always used) ----

const NONE: string[] = [];
const studiedKey = (datasetKey: string) => `atlas:studied:${datasetKey}`;

export function useStudied(datasetKey: string | null): Set<string> {
  const [ids] = useLocal(datasetKey ? studiedKey(datasetKey) : "atlas:studied:none", NONE);
  return useMemo(() => new Set(ids), [ids]);
}

export function setStudied(datasetKey: string | null, topicId: string, value: boolean): void {
  if (!datasetKey) return;
  const ids = readLocal(studiedKey(datasetKey), NONE).filter((id) => id !== topicId);
  writeLocal(studiedKey(datasetKey), value ? [...ids, topicId] : ids);
}

export function clearStudied(datasetKey: string | null): void {
  if (datasetKey) writeLocal(studiedKey(datasetKey), null);
}
