import { useEffect, useState } from 'react';

export const QUERY_CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const dataCache = new Map<string, CacheEntry<unknown>>();
const inflightCache = new Map<string, Promise<unknown>>();

export function getCachedQueryValue<T>(key: string): T | undefined {
  const entry = dataCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    dataCache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function setCachedQueryValue<T>(key: string, value: T, ttlMs = QUERY_CACHE_TTL_MS): void {
  dataCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

export async function cachedQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts?: { ttlMs?: number; force?: boolean }
): Promise<T> {
  const ttlMs = opts?.ttlMs ?? QUERY_CACHE_TTL_MS;
  if (!opts?.force) {
    const cached = getCachedQueryValue<T>(key);
    if (cached !== undefined) return cached;
  }

  const inflight = inflightCache.get(key);
  if (inflight) {
    return inflight as Promise<T>;
  }

  const promise = fetcher()
    .then((result) => {
      setCachedQueryValue(key, result, ttlMs);
      inflightCache.delete(key);
      return result;
    })
    .catch((err) => {
      inflightCache.delete(key);
      throw err;
    });

  inflightCache.set(key, promise);
  return promise;
}

export function invalidateCache(prefixOrKey: string): void {
  for (const key of Array.from(dataCache.keys())) {
    if (key === prefixOrKey || key.startsWith(prefixOrKey)) {
      dataCache.delete(key);
    }
  }
  for (const key of Array.from(inflightCache.keys())) {
    if (key === prefixOrKey || key.startsWith(prefixOrKey)) {
      inflightCache.delete(key);
    }
  }
}

export function clearAllQueryCache(): void {
  dataCache.clear();
  inflightCache.clear();
}

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
