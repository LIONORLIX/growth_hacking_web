"use client";

import type { ArticleApiData } from "@/app/article/[slug]/article-types";

type CacheEntry<T> = { expiresAt: number; value: T };

const DEFAULT_TTL_MS = 5 * 60 * 1000;

const articleByRecordId = new Map<string, CacheEntry<ArticleApiData>>();
const playbookRecordByKey = new Map<string, CacheEntry<any>>();

function now() {
  return Date.now();
}

function readCache<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const hit = map.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now()) {
    map.delete(key);
    return null;
  }
  return hit.value;
}

function writeCache<T>(
  map: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs = DEFAULT_TTL_MS
) {
  map.set(key, { expiresAt: now() + ttlMs, value });
}

export function getCachedArticle(recordId: string): ArticleApiData | null {
  return readCache(articleByRecordId, recordId);
}

export function setCachedArticle(recordId: string, data: ArticleApiData, ttlMs?: number) {
  writeCache(articleByRecordId, recordId, data, ttlMs);
}

export function getCachedPlaybookRecord(cacheKey: string) {
  return readCache(playbookRecordByKey, cacheKey);
}

export function setCachedPlaybookRecord(cacheKey: string, record: any, ttlMs?: number) {
  writeCache(playbookRecordByKey, cacheKey, record, ttlMs);
}

