import { api } from "@/lib/api";
import type { WishlistToggle } from "@/lib/types";

/**
 * Guest wishlist intent.
 *
 * A guest taps a heart → nothing is written to the server (there is no
 * account yet) → the tap is parked here. The moment a session appears
 * (login, register, or a restored refresh cookie) it is replayed, so the
 * item really is saved "after login" instead of silently vanishing.
 *
 * The key is the same one Phase 1 used for the localStorage wishlist, so
 * existing guests get their old saved items migrated on their next login.
 */
const KEY = "onemart:wishlist";
const MAX_PENDING = 20;

export interface PendingSave {
  id: number;
  name: string;
}

export function readPendingSaves(): PendingSave[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry): PendingSave | null => {
        if (typeof entry === "number") return { id: entry, name: "this item" }; // legacy shape
        if (entry && typeof entry === "object" && "id" in entry) {
          const record = entry as { id: unknown; name?: unknown };
          const id = Number(record.id);
          if (!Number.isFinite(id)) return null;
          return { id, name: typeof record.name === "string" ? record.name : "this item" };
        }
        return null;
      })
      .filter((entry): entry is PendingSave => entry !== null);
  } catch {
    return [];
  }
}

export function rememberSave(item: PendingSave): void {
  try {
    const list = readPendingSaves().filter((entry) => entry.id !== item.id);
    list.unshift(item);
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_PENDING)));
  } catch {
    /* storage unavailable — the guest just has to sign in first */
  }
}

export function forgetSave(id: number): void {
  try {
    const list = readPendingSaves().filter((entry) => entry.id !== id);
    if (list.length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

/** Replay one parked tap. Resolves false when the server refused it. */
export async function replaySave(item: PendingSave): Promise<boolean> {
  try {
    await api.post<WishlistToggle>(`/wishlist/${item.id}`);
    return true;
  } catch {
    return false;
  }
}
