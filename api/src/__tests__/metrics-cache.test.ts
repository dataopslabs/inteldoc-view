import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { MetricsCache } from '../lib/metrics-cache';

describe('MetricsCache Property Tests', () => {
  let cache: MetricsCache;

  beforeEach(() => {
    cache = new MetricsCache();
    vi.useFakeTimers();
  });

  /**
   * Property 10: Cache returns identical results within TTL
   *
   * For any cache key and data stored with a TTL, calling get before the TTL
   * expires should return data identical to what was stored. Calling get after
   * the TTL expires should return null.
   *
   * **Validates: Requirements 10.1, 10.3, 10.4**
   */
  it('Property 10: get returns identical data before TTL and null after TTL', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.jsonValue(),
        fc.integer({ min: 100, max: 300_000 }),
        (key, data, ttlMs) => {
          cache.clear();

          cache.set(key, data, ttlMs);

          // Before TTL: get should return identical data
          const beforeExpiry = cache.get(key);
          expect(beforeExpiry).toEqual(data);

          // Advance time just before TTL — still valid
          vi.advanceTimersByTime(ttlMs - 1);
          const justBefore = cache.get(key);
          expect(justBefore).toEqual(data);

          // Advance past TTL — should return null
          vi.advanceTimersByTime(2);
          const afterExpiry = cache.get(key);
          expect(afterExpiry).toBeNull();
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * Property 11: Cache evicts oldest entry when at capacity
   *
   * For any sequence of set operations that exceeds the max entries limit,
   * the cache size should never exceed the limit. The evicted entry should
   * be the one that was inserted earliest.
   *
   * **Validates: Requirements 10.5, 10.6**
   */
  it('Property 11: cache size never exceeds maxEntries and oldest entry is evicted', () => {
    const maxEntries = 5;

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            key: fc.string({ minLength: 1, maxLength: 30 }),
            value: fc.jsonValue(),
          }),
          { minLength: maxEntries + 1, maxLength: maxEntries * 4 }
        ),
        (entries) => {
          const smallCache = new MetricsCache(maxEntries, 60_000);

          // Use unique keys by appending index to avoid collisions
          const uniqueEntries = entries.map((e, i) => ({
            key: `${i}-${e.key}`,
            value: e.value,
          }));

          for (const entry of uniqueEntries) {
            smallCache.set(entry.key, entry.value);
            // Size should never exceed maxEntries
            expect(smallCache.size).toBeLessThanOrEqual(maxEntries);
          }

          // After inserting more than maxEntries unique keys,
          // the first key should have been evicted
          if (uniqueEntries.length > maxEntries) {
            const firstKey = uniqueEntries[0].key;
            expect(smallCache.get(firstKey)).toBeNull();
          }

          // The last maxEntries keys should still be present
          const lastKeys = uniqueEntries.slice(-maxEntries);
          for (const entry of lastKeys) {
            expect(smallCache.get(entry.key)).toEqual(entry.value);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('MetricsCache Unit Tests', () => {
  // 1. Cache hit returns stored data
  it('returns stored data on cache hit', () => {
    const cache = new MetricsCache();
    const data = { total: 42, items: ['a', 'b'] };
    cache.set('my-key', data);
    expect(cache.get('my-key')).toEqual(data);
  });

  // 2. Cache miss after TTL expiry
  it('returns null after TTL expires', () => {
    vi.useFakeTimers();
    const cache = new MetricsCache(100, 5000);
    cache.set('ttl-key', { value: 'hello' });

    // Still valid before TTL
    expect(cache.get('ttl-key')).toEqual({ value: 'hello' });

    // Advance past TTL
    vi.advanceTimersByTime(5001);
    expect(cache.get('ttl-key')).toBeNull();

    vi.useRealTimers();
  });

  // 3. Cache at capacity evicts oldest entry
  it('evicts the oldest entry when at capacity', () => {
    const cache = new MetricsCache(3, 60_000);
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');
    cache.set('k3', 'v3');
    expect(cache.size).toBe(3);

    // Adding a 4th entry should evict k1
    cache.set('k4', 'v4');
    expect(cache.size).toBe(3);
    expect(cache.get('k1')).toBeNull();
    expect(cache.get('k2')).toBe('v2');
    expect(cache.get('k3')).toBe('v3');
    expect(cache.get('k4')).toBe('v4');
  });

  // 4. buildKey produces deterministic sorted keys
  it('buildKey produces the same key regardless of param order', () => {
    const cache = new MetricsCache();
    const key1 = cache.buildKey('t1', '/path', { b: '2', a: '1' });
    const key2 = cache.buildKey('t1', '/path', { a: '1', b: '2' });
    expect(key1).toBe(key2);
    expect(key1).toBe('t1:/path:a=1&b=2');
  });

  // 5. clear empties the cache
  it('clear removes all entries from the cache', () => {
    const cache = new MetricsCache();
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.size).toBe(3);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBeNull();
    expect(cache.get('c')).toBeNull();
  });
});
