import { useEffect, useState } from 'react';

export const QUERY_CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const dataCache = new Map<string, CacheEntry<unknown>>();
const inflightCache = new Map<string, Promise<unknown>>();

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as { name?: string; message?: string; code?: string };
  if (anyErr.name === 'AbortError') return true;
  if (anyErr.code === 'ABORT_ERR') return true;
  const msg = String(anyErr.message || '').toLowerCase();
  return msg.includes('aborted') || msg.includes('abort');
}

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

function createAbortError(): Error {
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}

const inflightMeta = new Map<string, { waiters: number; controller: AbortController }>();

export async function cachedQuery<T>(
  key: string,
  fetcher: (signal?: AbortSignal) => Promise<T>,
  opts?: { ttlMs?: number; force?: boolean; signal?: AbortSignal }
): Promise<T> {
  const signal = opts?.signal;
  if (signal?.aborted) {
    throw createAbortError();
  }

  const ttlMs = opts?.ttlMs ?? QUERY_CACHE_TTL_MS;
  if (!opts?.force) {
    const cached = getCachedQueryValue<T>(key);
    if (cached !== undefined) return cached;
  }

  let basePromise = (!opts?.force ? inflightCache.get(key) : undefined) as Promise<T> | undefined;
  let meta = (!opts?.force ? inflightMeta.get(key) : undefined);

  if (!basePromise || !meta) {
    const internalController = new AbortController();
    meta = { waiters: 0, controller: internalController };
    inflightMeta.set(key, meta);

    basePromise = fetcher(internalController.signal)
      .then((result) => {
        if (!internalController.signal.aborted) {
          setCachedQueryValue(key, result, ttlMs);
        }
        inflightCache.delete(key);
        inflightMeta.delete(key);
        return result;
      })
      .catch((err) => {
        inflightCache.delete(key);
        inflightMeta.delete(key);
        throw err;
      });

    inflightCache.set(key, basePromise);
  }

  if (!signal) {
    meta.waiters += 1;
    try {
      return await basePromise;
    } finally {
      meta.waiters = Math.max(0, meta.waiters - 1);
    }
  }

  meta.waiters += 1;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      meta!.waiters = Math.max(0, meta!.waiters - 1);
      if (meta!.waiters === 0) meta!.controller.abort();
      reject(createAbortError());
      return;
    }
    const onAbort = () => {
      meta!.waiters = Math.max(0, meta!.waiters - 1);
      if (meta!.waiters === 0) {
        meta!.controller.abort();
      }
      reject(createAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    basePromise!.then(
      (res) => {
        signal.removeEventListener('abort', onAbort);
        meta!.waiters = Math.max(0, meta!.waiters - 1);
        resolve(res);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        meta!.waiters = Math.max(0, meta!.waiters - 1);
        reject(err);
      }
    );
  });
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
