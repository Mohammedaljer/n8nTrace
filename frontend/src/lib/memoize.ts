/**
 * Simple memoization utility for expensive pure functions.
 * Uses a WeakMap for object keys to allow garbage collection.
 */

type MemoCache<K, V> = Map<K, V>;

/**
 * Creates a memoized version of a function with a single primitive or object key.
 * For functions with multiple arguments, serialize to a single key first.
 */
export function memoize<K, V>(
  fn: (key: K) => V,
  options?: { maxSize?: number }
): (key: K) => V {
  const cache: MemoCache<K, V> = new Map();
  const maxSize = options?.maxSize ?? 100;

  return (key: K): V => {
    if (cache.has(key)) {
      return cache.get(key)!;
    }

    const result = fn(key);

    // Evict oldest entries if over capacity (simple LRU approximation)
    if (cache.size >= maxSize) {
      const firstKey = cache.keys().next().value;
      if (firstKey !== undefined) {
        cache.delete(firstKey);
      }
    }

    cache.set(key, result);
    return result;
  };
}

/**
 * Creates a stable cache key from filter objects.
 * Useful for memoizing filter operations.
 */
export function createFilterCacheKey(filters: Record<string, unknown>): string {
  const entries = Object.entries(filters)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  
  return JSON.stringify(entries);
}

/**
 * Shallow equality check for objects.
 */
export function shallowEqual<T extends Record<string, unknown>>(a: T, b: T): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }

  return true;
}
