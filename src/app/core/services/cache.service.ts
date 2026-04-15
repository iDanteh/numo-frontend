import { Injectable } from '@angular/core';

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

@Injectable({ providedIn: 'root' })
export class CacheService {
  private store = new Map<string, CacheEntry>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      this.store.forEach((entry, key) => {
        if (now > entry.expiresAt) this.store.delete(key);
      });
    }, 60_000);
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set(key: string, data: unknown, ttlSeconds = 60): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  invalidatePattern(pattern: string): void {
    this.store.forEach((_, k) => { if (k.includes(pattern)) this.store.delete(k); });
  }
}
