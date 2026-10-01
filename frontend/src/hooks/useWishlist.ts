import { useCallback, useEffect, useState } from "react";

const KEY = "onemart:wishlist";

function read(): number[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as number[]) : [];
  } catch {
    return [];
  }
}

function write(ids: number[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable */
  }
}

let snapshot: number[] = read();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function useWishlist() {
  const [, force] = useState(0);

  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const toggle = useCallback((productId: number): boolean => {
    const has = snapshot.includes(productId);
    snapshot = has
      ? snapshot.filter((id) => id !== productId)
      : [...snapshot, productId];
    write(snapshot);
    emit();
    return !has;
  }, []);

  return { ids: snapshot, count: snapshot.length, has: (id: number) => snapshot.includes(id), toggle };
}
