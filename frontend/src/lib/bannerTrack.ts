/* Banner analytics — batched, best-effort, never in the render path.
 *
 * Impressions fire once per banner per browser session (the server dedupes
 * again per IP, so a refresh storm still counts once); clicks always flush
 * immediately with `keepalive` so the navigation that follows a CTA tap
 * cannot swallow the event. A dropped batch is simply dropped — analytics
 * must never break the storefront.
 */

type TrackEvent = { id: number; type: "impression" | "click" };

const SEEN_KEY = "om.banners.seen";
const FLUSH_DELAY_MS = 3000;
const MAX_BATCH = 50;

let queue: TrackEvent[] = [];
let timer: number | null = null;

function seenIds(): Set<number> {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((n) => typeof n === "number") : []);
  } catch {
    return new Set();
  }
}

function markSeen(id: number): void {
  try {
    const ids = seenIds();
    ids.add(id);
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...ids]));
  } catch {
    // storage unavailable (private mode) — fall back to counting every view
  }
}

function alreadySeen(id: number): boolean {
  try {
    return seenIds().has(id);
  } catch {
    return false;
  }
}

function enqueue(event: TrackEvent): void {
  queue.push(event);
  if (queue.length >= MAX_BATCH) {
    void flush();
    return;
  }
  if (timer === null) {
    timer = window.setTimeout(() => {
      timer = null;
      void flush();
    }, FLUSH_DELAY_MS);
  }
}

async function flush(keepalive = false): Promise<void> {
  if (queue.length === 0) return;
  const events = queue.splice(0, MAX_BATCH);
  try {
    await fetch("/api/banners/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      keepalive,
      credentials: "include",
    });
    // Non-OK (validation, 429 rate limit) is ignored on purpose: the server
    // has already decided these events don't count.
  } catch {
    // network hiccup — the batch is gone; the next page view starts fresh
  }
}

/** Fire an impression at most once per banner per session. */
export function trackImpression(id: number): void {
  if (alreadySeen(id)) return;
  markSeen(id);
  enqueue({ id, type: "impression" });
}

/** Fire a click (never deduped) and flush right away before navigation. */
export function trackClick(id: number): void {
  enqueue({ id, type: "click" });
  void flush(true);
}
