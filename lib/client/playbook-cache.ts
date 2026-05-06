"use client";

type CacheEntry<T> = { expiresAt: number; value: T };

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const playbookBaseCache = new Map<string, CacheEntry<any>>();

function now() {
  return Date.now();
}

export function getCachedPlaybookBase(key: string) {
  const hit = playbookBaseCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now()) {
    playbookBaseCache.delete(key);
    return null;
  }
  return hit.value;
}

export function setCachedPlaybookBase(key: string, value: any, ttlMs = DEFAULT_TTL_MS) {
  playbookBaseCache.set(key, { expiresAt: now() + ttlMs, value });
}

