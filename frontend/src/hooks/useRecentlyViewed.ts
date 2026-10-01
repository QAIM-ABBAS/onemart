import { useCallback, useEffect, useState } from "react";

const KEY = "onemart:recently-viewed";
const LIMIT = 10;

export interface RecentProduct {
  id: number;
  slug: string;
  name: string;
  thumbnail: string | null;
  price: number;
}

function read(): RecentProduct[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentProduct[]) : [];
  } catch {
    return [];
  }
}

function write(items: RecentProduct[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items.slice(0, LIMIT)));
  } catch {
    /* storage unavailable */
  }
}

let snapshot: RecentProduct[] = read();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function pushRecent(product: RecentProduct): void {
  const next = [product, ...snapshot.filter((item) => item.id !== product.id)].slice(0, LIMIT);
  snapshot = next;
  write(next);
  emit();
}

export function useRecentlyViewed(): RecentProduct[] {
  const [, force] = useState(0);

  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return snapshot;
}

export function useClearRecentlyViewed(): () => void {
  return useCallback(() => {
    snapshot = [];
    write([]);
    emit();
  }, []);
}
